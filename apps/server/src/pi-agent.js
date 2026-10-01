import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireSuccess, shellCommand, shellQuote } from "@artifact-editor/sdk/server";
import { PI_SESSION_DIR, isValidSessionId } from "./pi-sessions.js";

const serverRoot = path.dirname(fileURLToPath(import.meta.url));
const envCandidates = [path.resolve(serverRoot, "../.env"), path.resolve(serverRoot, "../../../.env")];
const PROVIDER_ID = "dotenv-provider";

export function loadPiConfig() {
  const envFile = envCandidates.find(candidate => fs.existsSync(candidate));
  if (!envFile) throw new Error("找不到 Agent 的 .env 文件");
  const values = {};
  for (let line of fs.readFileSync(envFile, "utf8").replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    line = line.trim().replace(/^export\s+/u, "");
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue;
    let value = line.slice(separator + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/gu, "\n").replace(/\\r/gu, "\r")
        .replace(/\\t/gu, "\t").replace(/\\"/gu, '"').replace(/\\\\/gu, "\\");
    } else value = value.replace(/\s+#.*$/u, "").trimEnd();
    values[key] = value;
  }
  for (const key of ["API_KEY", "BASE_URL", "MODEL"]) {
    if (!values[key]) throw new Error(`.env 缺少必填项 ${key}`);
  }
  try { new URL(values.BASE_URL); } catch { throw new Error(".env 中的 BASE_URL 不是有效网址"); }
  return values;
}

// Pi configuration and session storage are host concerns, outside the SDK.
export async function withPiEnvironment({ sandbox, cwd }, config, operation) {
  const directory = `/tmp/pi-agent-launcher-${randomUUID()}`;
  const env = { ...config, PI_CODING_AGENT_DIR: directory, PI_SKIP_VERSION_CHECK: "1" };
  const models = { providers: { [PROVIDER_ID]: {
    baseUrl: config.BASE_URL, api: config.PI_API || "openai-completions", apiKey: "$API_KEY",
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    models: [{ id: config.MODEL }],
  } } };
  try {
    requireSuccess(await sandbox.bash(
      `umask 077; mkdir -p -- ${shellQuote(directory)} ${shellQuote(PI_SESSION_DIR)} && cat > ${shellQuote(`${directory}/models.json`)}`,
      { cwd, stdin: JSON.stringify(models) },
    ));
    return await operation({ env, args: ["pi", "--provider", PROVIDER_ID, "--model", config.MODEL,
      "--session-dir", PI_SESSION_DIR, "--approve"] });
  } finally {
    // A generated path is the only cleanup target. Cleanup must not hide the Agent result.
    await sandbox.bash(`rm -rf -- ${shellQuote(directory)}`, { cwd, timeoutMs: 3000 }).catch(() => undefined);
  }
}

export async function askPiAgent(message, { sandbox, cwd, sessionId, sessionName, signal, onOutput }) {
  if (sessionId && !isValidSessionId(sessionId)) throw new Error("无效的 session ID");
  return withPiEnvironment({ sandbox, cwd }, loadPiConfig(), async ({ env, args }) => {
    const result = requireSuccess(await sandbox.bash(shellCommand([
      ...args, ...(sessionId ? ["--session-id", sessionId] : []),
      ...(sessionName ? ["--name", sessionName] : []), "--print", "--", message,
    ]), { cwd, env, signal, onOutput, maxOutputBytes: 2 * 1024 * 1024 }));
    if (!result.stdout.trim()) throw new Error("pi Agent 没有返回内容");
    return result.stdout.trim();
  });
}
