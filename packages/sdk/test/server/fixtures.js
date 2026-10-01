import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Sandbox, shellQuote, requireSuccess } from "../../dist/server/index.js";
import { DockerSandbox } from "../../dist/server/docker-sandbox.js";

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";

class TestSandbox extends Sandbox {
  bash(command, options = {}) {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) { reject(options.signal.reason); return; }
      const script = options.cwd ? `cd ${shellQuote(options.cwd)} && ${command}` : command;
      const child = spawn(bash, ["-c", script], {
        windowsHide: true, env: { ...process.env, GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "core.autocrlf", GIT_CONFIG_VALUE_0: "false", ...options.env }, stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "", stderr = "", size = 0, truncated = false, failure;
      const cancel = () => { failure = options.signal.reason; child.kill(); };
      options.signal?.addEventListener("abort", cancel, { once: true });
      const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
        failure = new Error("命令执行超时"); child.kill();
      }, options.timeoutMs);
      for (const stream of ["stdout", "stderr"]) child[stream].on("data", chunk => {
        const remaining = Math.max(0, (options.maxOutputBytes ?? 4 * 1024 * 1024) - size);
        if (chunk.length > remaining) truncated = true;
        const content = chunk.subarray(0, remaining).toString("utf8");
        size += Math.min(chunk.length, remaining);
        if (stream === "stdout") stdout += content; else stderr += content;
        options.onOutput?.(stream, chunk.toString("utf8"));
      });
      child.stdin.on("error", () => {});
      child.stdin.end(options.stdin);
      child.once("error", error => { failure = error; });
      child.once("close", exitCode => {
        clearTimeout(timer); options.signal?.removeEventListener("abort", cancel);
        if (failure) reject(failure);
        else resolve({ stdout, stderr, exitCode: exitCode ?? 1, truncated });
      });
    });
  }
}

export async function fixture(context) {
  const containerId = process.env.SDK_DOCKER_CONTAINER;
  const sandbox = containerId ? new DockerSandbox({ containerId }) : new TestSandbox();
  let root, localRoot;
  if (containerId) {
    root = `/tmp/artifact-sdk-test-${randomUUID()}`;
    requireSuccess(await sandbox.bash(`mkdir -- ${shellQuote(root)}`));
    context.after(async () => {
      if (!/^\/tmp\/artifact-sdk-test-[0-9a-f-]+$/u.test(root)) throw new Error("测试清理路径无效");
      requireSuccess(await sandbox.bash(`rm -rf -- ${shellQuote(root)}`));
    });
  } else {
    localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-sdk-test-"));
    root = process.platform === "win32"
      ? localRoot.replaceAll("\\", "/").replace(/^([A-Za-z]):/u, (_, drive) => `/${drive.toLowerCase()}`)
      : localRoot;
    context.after(() => fs.rm(localRoot, { recursive: true, force: true }));
  }
  const execute = (command, options) => sandbox.bash(command, { ...options, cwd: root });
  const readFile = (file, options) => sandbox.read(file, { ...options, cwd: root });
  return { sandbox, root, execute, readFile, localRoot };
}

export function faultSandbox(sandbox, shouldFail) {
  return new class extends Sandbox {
    async bash(command, options) {
      if (shouldFail(command)) return { stdout: "", stderr: "injected failure", exitCode: 1, truncated: false };
      return sandbox.bash(command, options);
    }
  }();
}
