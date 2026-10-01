import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { BashOptions, BashResult } from "./sandbox.ts";

/** Shared transport for Docker and local command execution. Truncation drains, never stops, output. */
export function runProcess(command: string, args: readonly string[], options: BashOptions = {}): Promise<BashResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(options.signal.reason ?? new Error("命令已取消")); return; }
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const limit = options.maxOutputBytes ?? 4 * 1024 * 1024;
    const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
    const eventDecoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
    const output = { stdout: "", stderr: "" };
    let size = 0;
    let truncated = false;
    let failure: unknown;
    let failed = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const stop = (error: unknown) => {
      if (failed) return;
      failed = true;
      failure = error;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
      killTimer.unref();
    };
    const cancel = () => stop(options.signal?.reason ?? new Error("命令已取消"));
    options.signal?.addEventListener("abort", cancel, { once: true });
    const timeout = options.timeoutMs === undefined ? undefined
      : setTimeout(() => stop(new Error(`命令执行超时：${options.timeoutMs} ms`)), options.timeoutMs);
    // Handle an abort that arrived between the initial check and listener registration.
    if (options.signal?.aborted) cancel();

    for (const stream of ["stdout", "stderr"] as const) {
      child[stream].on("data", (chunk: Buffer) => {
        const remaining = Math.max(0, limit - size);
        if (chunk.length > remaining) truncated = true;
        const accepted = chunk.subarray(0, remaining);
        size += accepted.length;
        output[stream] += decoders[stream].write(accepted);
        const text = eventDecoders[stream].write(chunk);
        try { if (text) options.onOutput?.(stream, text); }
        catch (error) { stop(error); }
      });
    }
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") stop(error);
    });
    child.stdin.end(options.stdin);
    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", cancel);
    };
    child.once("error", (error) => { failed = true; failure = error; });
    child.once("close", (exitCode, signal) => {
      cleanup();
      if (failed) { reject(failure); return; }
      if (signal) { reject(new Error(`命令被信号 ${signal} 终止`)); return; }
      try {
        for (const stream of ["stdout", "stderr"] as const) {
          const text = eventDecoders[stream].end();
          if (text) options.onOutput?.(stream, text);
        }
      } catch (error) { reject(error); return; }
      resolve({ stdout: output.stdout + decoders.stdout.end(), stderr: output.stderr + decoders.stderr.end(),
        exitCode: exitCode ?? 1, truncated });
    });
  });
}
