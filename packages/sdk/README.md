# @artifact-editor/sdk

SDK 分为浏览器端 `web` 和程序端 `server`。

- `/web`：无头元素检查、属性编辑及可选 overlay。
- `/web/react`：React hook；`/web/vite`：React/Vue 源码定位适配器。
- `/server`：一个 Bash 执行接口，以及基于它的文件和 Git 辅助操作。
- `/server/docker`：可选的已有 Docker 容器适配器。

旧浏览器根入口及 `/react`、`/vite` 等继续兼容。server 不加载 React，React peer dependency 可选。

## 执行接口

只需继承 `Sandbox`，实现一个方法：

```ts
import { Sandbox } from "@artifact-editor/sdk/server";
import type { BashOptions, BashResult } from "@artifact-editor/sdk/server";

class ExistingSandbox extends Sandbox {
  bash(command: string, options?: BashOptions): Promise<BashResult> {
    // 将已有系统的命令执行接口适配到这里。
    return existingSystem.bash(command, options);
  }
}
```

`command` 是要执行的 Bash 命令。`options` 可指定 `cwd`、文本 `stdin`、环境变量 `env`、超时 `timeoutMs`、取消 `signal`、输出上限 `maxOutputBytes` 和输出回调 `onOutput(stream, text)`。适配器应按调用参数支持这些执行行为。

结果为 `{ stdout, stderr, exitCode, truncated }`：非零退出码作为结果返回，连接故障、超时和取消拒绝 Promise。输出超限后继续排空输出并等待命令结束，返回 `truncated: true`。需要成功且完整的输出时，调用 `requireSuccess(result)`。

目录通过 `cwd` 传入，SDK 不要求创建 Workspace 对象，也不管理用户绑定、沙箱生命周期、产物持久化、任务队列或会话。

## 辅助操作

```ts
import { requireSuccess, runGit } from "@artifact-editor/sdk/server";
import { DockerSandbox } from "@artifact-editor/sdk/server/docker";

const sandbox = new DockerSandbox({ containerId: "existing-container" });
const options = { cwd: "/workspace/my-site" };

await sandbox.read("src/App.tsx", options);
await sandbox.write("src/title.txt", "新标题", options);
await sandbox.edit("src/title.txt", "新标题", "修改后的标题", options);
await sandbox.list(".", options);
await sandbox.search("标题", options);

const status = requireSuccess(await runGit(sandbox, ["status", "--short"], options));
const build = requireSuccess(await sandbox.bash("npm run build", options));
```

`bash` 是唯一的抽象方法。预定义的 `read`、`write`、`edit`、`list`、`search` 在 SDK 内组合 Bash 命令：读取使用 `cat`，写入使用 `mkdir` 和 `cat`，列目录使用 `find`，搜索使用 `grep`。文本替换和命令结果解析在 SDK 所在程序中完成，文件内容通过 stdin 写入。

默认文件方法需要沙箱已有的 GNU `realpath`、`cat`、`wc`、`mkdir`、`find` 和 `grep`，不依赖沙箱内的 Node.js 或 Python，不安装或发送额外的程序脚本。

读取默认上限 1 MiB；编辑要求唯一匹配，显式 `replaceAll: true` 可替换多处。编辑是读取后写回，不提供并发控制。列表返回 `{ tree, truncated }`，搜索单行字面文本并返回 `{ matches, truncated }`。遍历默认忽略 `node_modules`、`.git`、`dist`、`.vite`，可配置 `ignore`、`maxEntries`、`maxDepth` 等限制；这些限制控制返回结果，输出大小另由 `maxOutputBytes` 控制。

文件路径以 `cwd` 为边界，检查路径及符号链接是否越出目录；列表不跟随符号链接。Bash 执行本身不受此文件辅助操作的边界限制。

`runGit` 仅对参数进行 shell 引用并调用 `bash`，返回原始执行结果。构建直接调用 `bash`，构建工具和失败处理由使用方决定。

`DockerSandbox` 连接已有 Linux 容器，需要 Bash、`setsid --wait` 及常见 Unix 命令。取消会终止远端进程组；主动脱离该组的后台程序由宿主管理。

## 版本管理

`GitVersions` 是独立、可选的 Git 命令封装，只依赖 `sandbox.bash` 和一个仓库目录：

```ts
import { GitVersions } from "@artifact-editor/sdk/server";

const versions = new GitVersions(sandbox, "/workspace/my-site");
await versions.initialize();                  // 已有仓库可省略
await versions.commit("完成第一版");
await versions.publish("v1", "第一版发布");
// 修改文件后，提交与发布分别按业务流程调用。
await versions.commit("调整首页");
await versions.publish("v2", "第二版发布");
const history = await versions.list();
await versions.checkout("v1");
```

它只提供五个方法：

- `initialize(branch?)`：执行 `git init`，可指定初始分支名。
- `list()`：列出已发布标签的版本名、提交 SHA、时间和发布说明摘要；普通提交不会出现在版本列表中。
- `checkout(version)`：以 detached HEAD 切换到指定标签，沿用 Git 对未提交修改的处理。
- `commit(message)`：执行 `git add -A` 和 `git commit`，返回新提交 SHA。没有修改时按 Git 的行为失败，不创建版本标签。
- `publish(version, message?)`：仅为当前 HEAD 的提交创建版本标签，返回该提交 SHA。发布说明默认使用版本名，已有标签不会被覆盖。它不暂存或提交工作目录，未提交的修改不包含在发布版本中。

这里的发布是给本地仓库的最终提交打版本标签。版本名、提交者配置、忽略文件、调用时机、远端推送和部署都由业务方决定。在历史版本上修改并提交可以产生多个中间提交，最终发布为一个新版本，原分支保持原位置。

Agent 可以先提交修改，宿主再进行业务校验、修正受保护数据并提交修正。只有宿主确认通过后才调用 `publish`，版本标签指向最终确认的提交，多个中间提交不会自动变成多个发布版本。沙箱内 Agent 也可以直接使用自己的 Git 工具提交，SDK 的发布不依赖是谁创建了提交。

该封装不提供队列、状态机或自动回滚。Git 执行失败直接抛错；发布失败保留已创建的提交，重试发布不会产生额外提交。其他 Git 操作继续使用 `runGit`。

## 接入已有 Agent

外部 Agent 可以将普通函数包装成自己框架的工具：

```ts
const read = (path: string) => sandbox.read(path, options);
const bash = (command: string) => sandbox.bash(command, options);
// 工具 schema、Agent 输入、事件及会话使用业务方已有协议。
```

沙箱内的 Agent 通过命令启动即可：

```ts
import { shellCommand } from "@artifact-editor/sdk/server";

const result = await sandbox.bash(
  shellCommand(["my-agent", "--print", "--", prompt]),
  { ...options, signal, onOutput },
);
```

SDK 不定义 Agent runtime、统一消息格式或工具注册机制。动态参数使用 `shellCommand` / `shellQuote`；文件内容通过 `stdin` 传输。

本仓库示例宿主的版本历史、编辑队列和 Pi 对话适配位于 `apps/server`，可作为业务封装示例，不属于 SDK 接口。

## 验证

`npm run test:server --workspace @artifact-editor/sdk` 验证文件和 Git 辅助操作。在 Windows 上需要 Git Bash；其他平台使用 Bash。

设置 `SDK_DOCKER_CONTAINER` 为已有测试容器后，同一套测试在独立的 `/tmp/artifact-sdk-test-*` 目录执行，并验证取消、超时、输出截断等行为。宿主版本工作流通过 `npm run test:checkpoints` 单独验证。
