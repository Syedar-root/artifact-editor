import { Injectable } from "@nestjs/common";
import type {
  ToolDefinition,
  ParameterSchemaSpec,
} from "@deepseek-ai/dsh-tools";
import type { WorkspaceExecution } from "../../artifacts/models/artifact-workspace.model.js";
import type { Artifact } from "../../artifacts/models/artifact.model.js";
import path from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";

@Injectable()
export class AgentToolsService {
  prompt(root: string) {
    return `你是产物编辑助手，请用中文回答。源码目录是 ${root}，所有文件与命令操作必须调用沙箱工具。可用 inspect_artifact 检查当前产物信息，完成修改后调用 build 检查构建。依赖存放在独立的快速存储中，修改 package.json 后使用 install_dependencies；禁止在源码目录运行 npm install/ci、pnpm、yarn 或 bun 安装。不要修改 .git、.artifact 或 node_modules，也不要自行管理 checkpoint。`;
  }

  private text(value: unknown, name: string) {
    if (typeof value !== "string" || !value.trim())
      throw new Error(`${name} 不能为空`);
    return value;
  }

  private sourcePath(value: unknown, root: string) {
    const input = this.text(value, "路径");
    const relative = path.posix.isAbsolute(input)
      ? path.posix.relative(root, input)
      : path.posix.normalize(input);
    if (
      relative === ".." ||
      relative.startsWith("../") ||
      relative.includes("\\") ||
      relative.includes("\0") ||
      relative
        .split("/")
        .some((part) => [".git", ".artifact", "node_modules"].includes(part))
    ) {
      throw new Error(
        "请操作产物内的源码文件；依赖请使用 install_dependencies",
      );
    }
    return relative;
  }

  forWorkspace(
    workspace: WorkspaceExecution,
    {
      inspect,
    }: { inspect?: (signal: AbortSignal) => Promise<Artifact | null> } = {},
  ): ToolDefinition[] {
    const definition = (
      name: string,
      description: string,
      parameters: ParameterSchemaSpec,
      execute: (
        args: Record<string, unknown>,
        signal: AbortSignal,
      ) => Promise<any>,
    ) =>
      defineTool({
        name,
        description,
        parameters,
        output: {
          schema: { type: "json" },
          render: (_args, value) => [
            { type: "text", text: JSON.stringify(value) },
          ],
        },
        execute: async (args, exec) => {
          if (!args || typeof args !== "object" || Array.isArray(args))
            throw new Error("工具参数应为对象");
          exec.signal.throwIfAborted();
          return execute(args, exec.signal);
        },
      });
    const string = { type: "string" as const, required: true as const };
    return [
      definition(
        "read",
        "读取当前产物的源码文件",
        { path: string },
        (args, signal) =>
          workspace.files.read(this.sourcePath(args.path, workspace.root), {
            signal,
          }),
      ),
      definition(
        "write",
        "写入当前产物的源码文件",
        { path: string, content: string },
        (args, signal) => {
          if (typeof args.content !== "string")
            throw new Error("content 应为字符串");
          return workspace.files.write(
            this.sourcePath(args.path, workspace.root),
            args.content,
            { signal },
          );
        },
      ),
      definition(
        "edit",
        "唯一匹配并替换源码片段",
        { path: string, old_text: string, new_text: string },
        (args, signal) => {
          if (typeof args.new_text !== "string")
            throw new Error("new_text 应为字符串");
          return workspace.files.edit(
            this.sourcePath(args.path, workspace.root),
            this.text(args.old_text, "old_text"),
            args.new_text,
            { signal },
          );
        },
      ),
      definition(
        "list",
        "列出当前产物的源码目录",
        { path: { type: "string" } },
        (args, signal) =>
          workspace.files.list(
            this.sourcePath(args.path || ".", workspace.root),
            { signal },
          ),
      ),
      definition(
        "search",
        "在当前产物源码中搜索文本",
        { query: string },
        (args, signal) =>
          workspace.files.search(this.text(args.query, "query"), { signal }),
      ),
      definition(
        "bash",
        "在沙箱的产物目录执行构建或检查命令。安装依赖必须使用 install_dependencies",
        { command: string },
        (args, signal) => {
          const command = this.text(args.command, "command");
          if (
            /\b(?:npm|pnpm|yarn|bun)\s+(?:[^;&|\n]*\s)?(?:install|ci|add|update|upgrade|remove|uninstall)\b/u.test(
              command,
            )
          ) {
            throw new Error(
              "请编辑 package.json 后调用 install_dependencies，避免将依赖安装到 NAS",
            );
          }
          return workspace.execute(command, {
            signal,
            timeoutMs: 120_000,
            maxOutputBytes: 256 * 1024,
            env: { PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false" },
          });
        },
      ),
      definition(
        "install_dependencies",
        "根据 package.json、packageManager 和 npm/pnpm lockfile 将依赖安装到快速存储，再链接 node_modules",
        {},
        (_args, signal) => workspace.prepareDependencies({ signal }),
      ),
      definition(
        "build",
        "安装或复用外部依赖并构建当前产物；返回构建日志，构建失败时返回错误",
        {},
        (_args, signal) =>
          workspace.build({
            signal,
            timeoutMs: 120_000,
            maxOutputBytes: 256 * 1024,
            env: { PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false" },
          }),
      ),
      ...(inspect
        ? [
            definition(
              "inspect_artifact",
              "检查当前产物的名称、技术栈、预览地址和定位模式",
              {},
              (_args, signal) => inspect(signal),
            ),
          ]
        : []),
    ];
  }
}
