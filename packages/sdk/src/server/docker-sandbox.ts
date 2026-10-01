import { randomUUID } from "node:crypto";
import { Sandbox, type BashOptions, type BashResult } from "./sandbox.ts";
import { runProcess } from "./process.ts";
import { shellQuote } from "./shell.ts";

export interface DockerSandboxOptions {
  containerId: string;
  dockerCommand?: string;
}

/** Connects to an existing Linux container. Creation, ownership and persistence belong to the host. */
export class DockerSandbox extends Sandbox {
  readonly containerId: string;
  private readonly dockerCommand: string;

  constructor({ containerId, dockerCommand = "docker" }: DockerSandboxOptions) {
    super();
    if (!containerId || containerId.startsWith("-")) throw new TypeError("容器 ID 无效");
    this.containerId = containerId;
    this.dockerCommand = dockerCommand;
  }

  async bash(command: string, options: BashOptions = {}): Promise<BashResult> {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error("命令已取消");
    const args = ["exec", "-i"];
    if (options.cwd) args.push("-w", options.cwd);
    for (const [name, value] of Object.entries(options.env ?? {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new TypeError("环境变量名称无效");
      args.push("-e", `${name}=${value}`);
    }
    // setsid gives cancellation a remote process group, not just a local docker client.
    const pidFile = `/tmp/artifact-exec-${randomUUID()}.pid`;
    const script = `echo $$ > ${shellQuote(pidFile)}; trap ${shellQuote(`rm -f -- ${shellQuote(pidFile)}`)} EXIT; ${command}`;
    args.push(this.containerId, "setsid", "--wait", "bash", "-c", script);
    try {
      return await runProcess(this.dockerCommand, args, options);
    } catch (error) {
      const stop = `if test -f ${shellQuote(pidFile)}; then pid=$(cat ${shellQuote(pidFile)}); `
        + `case "$pid" in ''|*[!0-9]*) ;; *) kill -TERM -- "-$pid" 2>/dev/null; sleep 0.2; kill -KILL -- "-$pid" 2>/dev/null ;; esac; `
        + `rm -f -- ${shellQuote(pidFile)}; fi`;
      await runProcess(this.dockerCommand, ["exec", this.containerId, "bash", "-c", stop], { timeoutMs: 3000 })
        .catch(() => undefined);
      throw error;
    }
  }
}
