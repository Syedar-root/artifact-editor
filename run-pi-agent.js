#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CONTAINER_ID =
  "3d676529c2ce5d5967767a8b3fcb32b2b5faac60a86ec7aa13fce04400c308b4";
const ENV_FILE = path.join(__dirname, ".env");
const PROVIDER_ID = "dotenv-provider";

function parseEnvFile(filePath) {
  const values = {};
  const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");

  for (const originalLine of content.split(/\r?\n/u)) {
    let line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trimStart();

    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue;

    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value
          .replace(/\\n/gu, "\n")
          .replace(/\\r/gu, "\r")
          .replace(/\\t/gu, "\t")
          .replace(/\\"/gu, '"')
          .replace(/\\\\/gu, "\\");
      }
    } else {
      value = value.replace(/\s+#.*$/u, "").trimEnd();
    }

    values[key] = value;
  }

  return values;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      ...options,
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} 被信号 ${signal} 终止`));
      } else {
        resolve(code ?? 1);
      }
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    }
  });
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function containerIsRunning() {
  let output = "";
  const child = spawn(
    "docker",
    ["inspect", "--format", "{{.State.Running}}", CONTAINER_ID],
    { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
  );
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });

  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  return code === 0 && output.trim() === "true";
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`用法：
  node run-pi-agent.js "你的任务"
  "你的任务" | node run-pi-agent.js
  node run-pi-agent.js                 # 启动交互界面`);
    return;
  }

  if (!fs.existsSync(ENV_FILE)) {
    throw new Error(`找不到环境文件：${ENV_FILE}`);
  }

  const env = parseEnvFile(ENV_FILE);
  for (const name of ["API_KEY", "BASE_URL", "MODEL"]) {
    if (!env[name]) throw new Error(`.env 缺少必填项 ${name}`);
  }
  try {
    new URL(env.BASE_URL);
  } catch {
    throw new Error(".env 中的 BASE_URL 不是有效网址");
  }

  if (!(await containerIsRunning())) {
    throw new Error(`容器不存在或未运行：${CONTAINER_ID}`);
  }

  const promptFromArgs = process.argv.slice(2).join(" ").trim();
  const prompt = promptFromArgs || (!process.stdin.isTTY ? await readStdin() : "");
  const interactive = !prompt;
  const agentDir = `/tmp/pi-agent-launcher-${process.pid}-${randomBytes(6).toString("hex")}`;
  const workdir = env.PI_WORKDIR || "/";

  const modelConfig = {
    providers: {
      [PROVIDER_ID]: {
        baseUrl: env.BASE_URL,
        api: env.PI_API || "openai-completions",
        apiKey: "$API_KEY",
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
        models: [{ id: env.MODEL }],
      },
    },
  };

  const commonExecArgs = [
    "exec",
    "--env-file",
    ENV_FILE,
    "-e",
    `PI_CODING_AGENT_DIR=${agentDir}`,
    "-e",
    "PI_SKIP_VERSION_CHECK=1",
  ];

  const setupScript =
    'umask 077; mkdir -p "$1"; cat > "$1/models.json"';
  const setupCode = await run(
    "docker",
    [...commonExecArgs, "-i", CONTAINER_ID, "sh", "-c", setupScript, "sh", agentDir],
    {
      stdio: ["pipe", "inherit", "inherit"],
      input: JSON.stringify(modelConfig),
    },
  );
  if (setupCode !== 0) throw new Error("无法在容器内创建 pi 模型配置");

  try {
    const piArgs = [
      ...commonExecArgs,
      ...(interactive ? ["-i", "-t"] : []),
      "-w",
      workdir,
      CONTAINER_ID,
      "pi",
      "--provider",
      PROVIDER_ID,
      "--model",
      env.MODEL,
      "--no-session",
      "--approve",
      ...(interactive ? [] : ["--print", "--", prompt]),
    ];

    const exitCode = await run("docker", piArgs, { stdio: "inherit" });
    if (exitCode !== 0) process.exitCode = exitCode;
  } finally {
    if (/^\/tmp\/pi-agent-launcher-[A-Za-z0-9-]+$/u.test(agentDir)) {
      await run(
        "docker",
        [
          "exec",
          CONTAINER_ID,
          "sh",
          "-c",
          'rm -rf -- "$1"',
          "sh",
          agentDir,
        ],
        { stdio: "ignore" },
      ).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(`启动 pi Agent 失败：${error.message}`);
  process.exitCode = 1;
});
