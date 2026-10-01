import type { BashOptions, BashResult, Sandbox } from "./sandbox.ts";
import { shellCommand } from "./shell.ts";

/** 仅封装 Git 参数引用；目录、分支、提交和失败策略由调用方选择。 */
export function runGit(sandbox: Pick<Sandbox, "bash">, args: readonly string[], options?: BashOptions): Promise<BashResult> {
  return sandbox.bash(shellCommand(["git", ...args]), options);
}
