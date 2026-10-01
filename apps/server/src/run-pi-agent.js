#!/usr/bin/env node
import { spawn } from "node:child_process";
import { askPiAgent, loadPiConfig, withPiEnvironment } from "./pi-agent.js";
import { sandbox, PI_CONTAINER_ID } from "./sandbox.js";
import { isValidSessionId } from "./pi-sessions.js";

function parseArguments(args) {
  const prompt = [];
  const input = { sessionId: "", sessionName: "", workdir: "" };
  const names = { "--session-id": "sessionId", "--session-name": "sessionName", "--workdir": "workdir" };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") { prompt.push(...args.slice(index + 1)); break; }
    if (names[arg]) input[names[arg]] = args[++index] || "";
    else prompt.push(arg);
  }
  return { ...input, message: prompt.join(" ").trim() };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`用法：
  node run-pi-agent.js "你的任务"
  node run-pi-agent.js --session-id <UUID> -- "继续这个任务"
  node run-pi-agent.js --workdir /workspace/my-artifact -- "修改首页"
  "你的任务" | node run-pi-agent.js
  node run-pi-agent.js                 # 启动交互界面`);
    return;
  }
  const input = parseArguments(process.argv.slice(2));
  if (input.sessionId && !isValidSessionId(input.sessionId)) throw new Error("session ID 格式无效");
  const config = loadPiConfig();
  const root = input.workdir || config.PI_WORKDIR || "/";
  if (root !== "/" && !/^\/workspace\/[a-z0-9][a-z0-9-]{0,63}$/u.test(root)) {
    throw new Error("Agent 工作目录必须是 /workspace 下的 artifact 目录");
  }
  if (!input.message && !process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    input.message = Buffer.concat(chunks).toString("utf8").trim();
  }
  if (input.message) {
    const controller = new AbortController();
    const cancel = () => controller.abort(new Error("Agent 已取消"));
    process.once("SIGINT", cancel);
    try {
      const reply = await askPiAgent(input.message, { ...input, sandbox, cwd: root, signal: controller.signal });
      console.log(reply);
    } finally { process.removeListener("SIGINT", cancel); }
    return;
  }
  // An interactive terminal is a host-only transport; SDK execute is a programmatic command.
  await withPiEnvironment({ sandbox, cwd: root }, config, ({ env, args }) => new Promise((resolve, reject) => {
    const execArgs = ["exec", "-it", "-w", root];
    for (const [name, value] of Object.entries(env)) execArgs.push("-e", `${name}=${value}`);
    execArgs.push(PI_CONTAINER_ID, ...args,
      ...(input.sessionId ? ["--session-id", input.sessionId] : []),
      ...(input.sessionName ? ["--name", input.sessionName] : []));
    const child = spawn("docker", execArgs, { windowsHide: true, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`pi Agent 退出码：${code}`));
    });
  }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
