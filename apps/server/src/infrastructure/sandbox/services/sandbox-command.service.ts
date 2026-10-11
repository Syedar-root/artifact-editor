import { Inject, Injectable } from "@nestjs/common";
import {
  SandboxClient,
  type SandboxApi as Sandbox,
} from "@agent-infra/sandbox";
import type { BashOptions, BashResult } from "@artifact-editor/sdk/server";
import { SandboxResponse } from "../models/sandbox-response.model.js";

/** SDK exec 返回后命令可能仍在运行；这里只负责等待、输出限制和取消清理。 */
@Injectable()
export class SandboxCommandService {
  constructor(@Inject(SandboxClient) private readonly client: SandboxClient) {}

  async run(command: string, options: BashOptions = {}): Promise<BashResult> {
    if (options.stdin !== undefined)
      throw new Error("请通过文件接口传递内容，命令接口不接收脚本 stdin");
    const deadline = AbortSignal.timeout(options.timeoutMs ?? 120_000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, deadline])
      : deadline;
    let session: string | undefined;
    let stdout = "",
      stderr = "",
      bytes = 0,
      truncated = false;
    const append = (stream: "stdout" | "stderr", content?: string | null) => {
      const buffer = Buffer.from(content ?? "");
      const remaining = Math.max(
        0,
        (options.maxOutputBytes ?? 4 * 1024 * 1024) - bytes,
      );
      if (buffer.length > remaining) truncated = true;
      // 截断时不输出半个 UTF-8 字符，避免替代字符使字节数超过上限。
      const text = new TextDecoder().decode(buffer.subarray(0, remaining), {
        stream: true,
      });
      bytes += Math.min(buffer.length, remaining);
      if (stream === "stdout") stdout += text;
      else stderr += text;
      if (text) options.onOutput?.(stream, text);
    };
    try {
      // 先创建 session，exec 中途取消也能找到并终止远端进程。
      session = SandboxResponse.data<Sandbox.BashSessionInfo>(
        await this.client.bash.createSession(
          { exec_dir: options.cwd },
          { abortSignal: signal },
        ),
      ).session_id;
      const started = SandboxResponse.data<Sandbox.BashExecResult>(
        await this.client.bash.exec(
          {
            session_id: session,
            command,
            exec_dir: options.cwd,
            env: options.env,
            async_mode: true,
            hard_timeout: Math.max(
              1,
              Math.ceil((options.timeoutMs ?? 120_000) / 1000),
            ),
            max_output_length: 0,
          },
          { abortSignal: signal },
        ),
      );
      let status = started.status,
        exitCode = started.exit_code;
      append("stdout", started.stdout);
      append("stderr", started.stderr);
      let offset = started.offset ?? 0,
        stderrOffset = started.stderr_offset ?? 0;
      while (status === "running" || status === "pending") {
        signal.throwIfAborted();
        const output = SandboxResponse.data<Sandbox.BashOutputResult>(
          await this.client.bash.output(
            {
              session_id: session,
              command_id: started.command_id,
              offset,
              stderr_offset: stderrOffset,
              wait: true,
              wait_timeout: 10,
            },
            { abortSignal: signal },
          ),
        );
        append("stdout", output.stdout);
        append("stderr", output.stderr);
        offset = output.offset ?? offset;
        stderrOffset = output.stderr_offset ?? stderrOffset;
        if (!output.command) throw new Error("沙箱未返回命令状态");
        status = output.command.status;
        exitCode = output.command.exit_code;
      }
      if (status !== "completed") throw new Error(`沙箱命令未完成：${status}`);
      if (exitCode === undefined) throw new Error("沙箱未返回命令退出码");
      return { stdout, stderr, exitCode, truncated };
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    } finally {
      if (session)
        SandboxResponse.data(
          await this.client.bash.closeSession(session, {
            timeoutInSeconds: 10,
          }),
        );
    }
  }
}
