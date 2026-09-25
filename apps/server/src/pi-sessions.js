import { spawn } from "node:child_process";

export const PI_CONTAINER_ID =
  "3d676529c2ce5d5967767a8b3fcb32b2b5faac60a86ec7aa13fce04400c308b4";
export const PI_SESSION_DIR = "/workspace/.artifact-pi-sessions";

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_SESSION_OUTPUT = 10 * 1024 * 1024;

const READ_SESSIONS_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");

const directory = process.argv[1];
const requestedId = process.argv[2] || "";
const workspaceRoot = path.resolve(process.argv[3]);
const requestedArtifactId = process.argv[4] || "";

function textFromContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function readSession(filePath) {
  const entries = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });

  const header = entries.find((entry) => entry.type === "session");
  if (!header || typeof header.id !== "string") return null;

  const treeEntries = entries.filter((entry) => entry && typeof entry.id === "string");
  const byId = new Map(treeEntries.map((entry) => [entry.id, entry]));
  const branch = [];
  let cursor = treeEntries.at(-1) || null;
  const visited = new Set();
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    branch.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
  }
  branch.reverse();

  const messages = branch.flatMap((entry) => {
    if (entry.type !== "message" || !entry.message) return [];
    const role = entry.message.role;
    if (role !== "user" && role !== "assistant") return [];
    const text = textFromContent(entry.message.content) || entry.message.errorMessage || "";
    if (!text) return [];
    return [{
      id: entry.id,
      role: role === "assistant" ? "agent" : "user",
      text,
      error: role === "assistant" && entry.message.stopReason === "error",
      timestamp: new Date(entry.message.timestamp || entry.timestamp).toISOString(),
    }];
  });

  const latestName = entries
    .filter((entry) => entry.type === "session_info" && typeof entry.name === "string")
    .at(-1)?.name?.trim();
  const firstUser = messages.find((message) => message.role === "user")?.text || "新对话";
  const lastMessage = messages.at(-1);
  const lastEntry = entries.at(-1);
  const cwd = typeof header.cwd === "string" ? path.resolve(header.cwd) : "";
  const relativeCwd = cwd ? path.relative(workspaceRoot, cwd) : "";
  const artifactId = relativeCwd && !relativeCwd.startsWith("..") && !path.isAbsolute(relativeCwd)
    ? relativeCwd.split(path.sep)[0]
    : "";

  return {
    id: header.id,
    artifactId,
    title: latestName || firstUser.slice(0, 48),
    preview: lastMessage?.text.slice(0, 88) || "暂无消息",
    createdAt: new Date(header.timestamp).toISOString(),
    updatedAt: new Date(lastEntry?.timestamp || header.timestamp).toISOString(),
    messageCount: messages.length,
    cwd,
    messages,
  };
}

let sessions = [];
if (fs.existsSync(directory)) {
  sessions = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => readSession(path.join(directory, entry.name)))
    .filter(Boolean)
    .filter((session) => !requestedArtifactId || session.artifactId === requestedArtifactId)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

if (requestedId) {
  const session = sessions.find((item) => item.id === requestedId) || null;
  process.stdout.write(JSON.stringify({ session }));
} else {
  process.stdout.write(JSON.stringify({
    sessions: sessions.map(({ messages, ...summary }) => summary),
  }));
}
`;

function runDocker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let size = 0;

    const collect = (chunk, current) => {
      size += chunk.length;
      if (size > MAX_SESSION_OUTPUT) {
        child.kill();
        reject(new Error("pi Agent 会话数据过大"));
        return current;
      }
      return current + chunk.toString("utf8");
    };

    child.stdout.on("data", (chunk) => {
      stdout = collect(chunk, stdout);
    });
    child.stderr.on("data", (chunk) => {
      stderr = collect(chunk, stderr);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `读取 pi Agent 会话失败：${code}`));
    });
  });
}

export function isValidSessionId(value) {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

export async function readPiSessions(sessionId = "", artifactId = "") {
  if (sessionId && !isValidSessionId(sessionId)) {
    throw new Error("无效的 session ID");
  }

  const output = await runDocker([
    "exec",
    PI_CONTAINER_ID,
    "node",
    "-e",
    READ_SESSIONS_SCRIPT,
    PI_SESSION_DIR,
    sessionId,
    "/workspace",
    artifactId,
  ]);

  return JSON.parse(output);
}
