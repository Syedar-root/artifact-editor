# AIO Sandbox 实用指南

> 面向需要在真实环境里跑 AI Agent 的开发者。基于官方文档 <https://sandbox.agent-infra.com/zh/> 整理，关键事实已在一台运行中的容器上实测核对（镜像 `ghcr.io/agent-infra/sandbox:latest`，版本 **1.11.0**，Ubuntu 22.04.5，用户 `gem`）。

---

## 目录

1. [它解决什么问题](#1-它解决什么问题)
2. [五分钟跑起来](#2-五分钟跑起来)
3. [服务地图：一个端口后面的所有东西](#3-服务地图一个端口后面的所有东西)
4. [核心心智模型：一个共享文件系统](#4-核心心智模型一个共享文件系统)
5. [四类能力怎么调](#5-四类能力怎么调)
6. [MCP：让现成的 Agent 客户端直接接上](#6-mcp让现成的-agent-客户端直接接上)
7. [SDK：Python / TypeScript / Go](#7-sdkpython--typescript--go)
8. [在沙箱里跑编码 Agent](#8-在沙箱里跑编码-agent)
9. [鉴权与安全](#9-鉴权与安全)
10. [环境变量与定制](#10-环境变量与定制)
11. [部署到服务器](#11-部署到服务器)
12. [版本演进：1.x 与 daemon（aiod）两条线](#12-版本演进1x-与-daemonaiod两条线)
13. [排错速查](#13-排错速查)
14. [参考链接](#14-参考链接)

---

## 1. 它解决什么问题

大多数沙箱是**单一用途**的：E2B 这类只管代码执行，Browserbase 这类只管浏览器。把两个拼起来用，就得靠 NAS 或对象存储在中间来回搬运文件——一个任务动辄产生几十个中间产物，Agent 的大部分时间花在"把文件从 A 挪到 B"上。

AIO Sandbox 的做法是把**浏览器、终端、文件系统、代码运行时、VSCode、Jupyter、MCP** 塞进**同一个 Docker 容器**，共享同一个文件系统。于是浏览器下载的文件立刻能在终端里 `ls` 到、在 VSCode 里打开、被 Python 脚本读取，不需要任何拷贝。

官方的一句话表述：

> 大多数沙盒都是单一用途（浏览器、代码或 Shell），这使得文件共享和功能协调变得极其困难。

这个"统一环境"是整个产品的价值主张，也是理解后面所有 API 设计的钥匙：**所有能力操作的是同一个文件系统，只是入口不同**。

另外两个实用特性值得一提：

- **人工接管**。任务跑到一半卡住时，你可以通过 VNC 直接接管浏览器，或者打开 Web 终端敲命令，或者进 VSCode 改代码。这对调试 Agent 行为极其有用。
- **预览代理**。Agent 在沙箱里起的 Web 服务（比如 `npm run dev`），可以通过 `${端口}-${域名}` 的泛域名或 `/proxy/{端口}/` 路径直接暴露出来看。

---

## 2. 五分钟跑起来

### 2.1 启动

需要 Docker，建议至少给容器 2GB 内存。

```bash
docker run --security-opt seccomp=unconfined --rm -it \
  -p 127.0.0.1:8080:8080 \
  ghcr.io/agent-infra/sandbox:latest
```

中国大陆可以用火山引擎的镜像源：

```bash
docker run --security-opt seccomp=unconfined --rm -it \
  -p 127.0.0.1:8080:8080 \
  enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:1.11.0
```

关于这两个参数，别省略：

- `--security-opt seccomp=unconfined` —— 官方每个示例都带它。容器内的 Chromium 需要一些被默认 seccomp 白名单拦掉的系统调用，不加的话浏览器起不来。
- `-p 127.0.0.1:8080:8080` —— **绑回环**。容器内服务监听 `0.0.0.0`，如果不写 `127.0.0.1:` 前缀就相当于把整个沙箱（包括无鉴权的终端和浏览器）暴露给局域网。云上部署时这一点更容易出事，见[第 11 节](#11-部署到服务器)。

如果 8080 被占用，换成别的宿主端口即可，比如 `-p 127.0.0.1:3000:8080`，然后把所有配置里的地址改成 `http://localhost:3000`。

如果想让工作目录持久化（容器删了文件还在）：

```bash
docker run --security-opt seccomp=unconfined --rm -it \
  -p 127.0.0.1:8080:8080 \
  -e WORKSPACE=/workspace \
  -v "$PWD:/workspace" \
  ghcr.io/agent-infra/sandbox:latest
```

### 2.2 启动后有什么

启动 banner 会打印入口地址：

```
🚀 AIO(All-In-One) 代理沙盒环境
📦 镜像版本：1.0.0.93
🌈 仪表板：http://localhost:8080/index.html
🔌 MCP：http://localhost:8080/mcp
📚 文档：http://localhost:8080/v1/docs
```

> 注意 banner 里的版本号（`1.0.0.93`）和镜像 tag（`1.11.0`）不是一回事，以 `/v1/sandbox` 返回的字段为准。

最快的验证方式是问它要环境信息：

```bash
curl -s http://localhost:8080/v1/sandbox | jq '.data'
```

实测输出（节选）：

```
## System Environment (v1.11.0):
- Ubuntu 22.04.5 LTS 22.04.5 (x86_64)
- User: gem, use `sudo` to switch to root
- Home directory: /home/gem
- Workspace: /home/gem
- Timezone: Asia/Singapore
- Occupied Ports: 5900,6080,8080,8091,8100,8200,8888,9222

## Development Environment:
Python:
- Python 3.10.12(path: /usr/bin/python3.10)
- Python 3.11.13(path: /opt/python3.11/bin/python3.11)
- Python 3.12.11(path: /opt/python3.12/bin/python3.12)
Node.js:
- v22.23.0
```

镜像里**已经预装**了不少东西，不用自己装：`git`、`gh`（GitHub CLI）、`uv`、`rg`、`jq`、`nmap`、`htop`、`imagemagick`、`yt-dlp`，以及 `aio` CLI、`codex`、`opencode`、`agent-browser`。

---

## 3. 服务地图：一个端口后面的所有东西

对外只需要记住**一个端口 8080**，其余服务都在容器内网，通过反向代理挂在同一个端口的不同路径上。

### 3.1 浏览器里能打开的页面

| 用途 | 地址 |
| --- | --- |
| 仪表板（代码/浏览器/终端/Jupyter 四个 Tab） | `http://localhost:8080/index.html` |
| API 文档（OpenAPI/Swagger） | `http://localhost:8080/v1/docs` |
| VNC 可视化浏览器 | `http://localhost:8080/vnc/index.html?autoconnect=true` |
| Web 终端 | `http://localhost:8080/terminal` |
| VSCode Server | `http://localhost:8080/code-server/` |
| JupyterLab | `http://localhost:8080/jupyter` |
| MCP 聚合入口 | `http://localhost:8080/mcp` |
| 给 Agent 看的使用手册 | `http://localhost:8080/llms.txt` |
| Codex CLI（跳转到内置终端并启动） | `http://localhost:8080/codex` |
| OpenCode（同上） | `http://localhost:8080/opencode` |

### 3.2 容器内部的端口拓扑

这些端口**不映射到宿主机**，只在容器内监听，统一经 8080 网关访问。知道它们的存在有助于排错（比如"某个服务是不是没起来"）：

| 端口 | 用途 |
| --- | --- |
| 8080 | 对外统一入口（nginx 网关） |
| 8079 | MCP Hub |
| 8081 | 鉴权后端 |
| 8088 | gem server |
| 8091 | Sandbox 主服务 |
| 8100 / 8101 / 8102 | browser / markitdown / chrome-devtools 三个 MCP server |
| 8118 | TinyProxy（出站正向代理） |
| 8200 | code-server |
| 8888 | JupyterLab |
| 9222 | Chromium CDP 调试端口 |
| 5900 / 6080 | VNC (RFB) / websockify 代理 |
| 4096 | OpenCode |

### 3.3 预览代理：把沙箱里的服务暴露出来

Agent 在沙箱里启动的 Web 服务有三种暴露方式：

```bash
# 子域代理（推荐，官方首选）
# 任何 ${端口}-${域名} 形式的域名都会被转发到沙箱内对应端口
http://3000-sandbox.example.com

# 子路径代理：后端服务（相对路径，适合 API server）
http://localhost:8080/proxy/4000/api/users

# 子路径代理：前端应用（绝对路径，适合 React/Vue 之类带资源打包的 dev server）
http://localhost:8080/absproxy/3000/

# 请求头路由（网关不方便用泛域名时）
curl -H 'x-aio-proxy-port: 19877' https://<sandbox-host>/some/path
```

子域方式的兼容性最好——子路径方式容易让那些对路由敏感的应用（自带绝对路径资源的框架）返回 404。`x-aio-proxy-port` 头只接受纯数字，且**必须由可信网关覆盖注入**，不要直接信任终端用户传进来的同名头，否则等于让人指定沙箱内的任意本地端口。

---

## 4. 核心心智模型：一个共享文件系统

所有能力共享同一个文件系统，这是用对 AIO Sandbox 的关键。记住三条路径就够：

| 路径 | 含义 |
| --- | --- |
| `/home/gem` | 用户 `gem` 的家目录，也是默认 `WORKSPACE`（实测默认存在） |
| `/home/gem/Downloads` | Chromium 的默认下载目录（实测默认存在） |
| `/home/gem/workspace` | 官方文档**约定**的工作区根目录 |

推荐的项目布局（官方给的结构）：

```
/home/gem/
├── projects/     # 你的开发项目
├── Downloads/    # 浏览器下载
├── .config/      # 工具配置
└── workspace/    # 当前工作目录
```

> 注意 `workspace/` 只是一个**约定**，镜像默认不会创建它——实测容器里 `/home/gem` 下只有 `Downloads`、`.config`、`.npm` 等目录。要用就自己 `mkdir -p`，或者启动时用 `-e WORKSPACE=/home/gem/workspace` 显式指定。

三条实践规则：

1. **Agent 生成的产物写进工作目录**，不要写 `/tmp`。写进工作目录的东西立刻能被浏览器、Shell、文件 API、VSCode 同时看到；`/tmp` 里的东西不享受"统一文件系统"的便利，而且容器一删就没了。
2. **浏览器下载的文件不用手动搬**。下载完成后直接 `curl` 文件 API 或者 `ls /home/gem/Downloads` 就能拿到。
3. **想让产物持久化到宿主机，挂 `WORKSPACE`**（见 2.1）。容器本身是无状态的，`docker run --rm` 一退什么都没了。

各服务默认使用的目录都由 `WORKSPACE` 控制，且大多支持请求级覆盖：

| 服务 | 默认目录 | 单次请求覆盖 |
| --- | --- | --- |
| Shell | `$WORKSPACE` | `exec_dir` |
| Bash | `$WORKSPACE` | `exec_dir` |
| Jupyter | `$WORKSPACE` | 请求参数 |
| Node.js | `$WORKSPACE` | 请求参数 |
| code-server | `$WORKSPACE` | 打开的目录 |

> 一个容易踩的坑：挂载宿主机目录后可能出现权限不匹配（容器内 `gem` 对宿主目录无写权限）。官方文档**没有**给出 `PUID/PGID` 之类的解决方案，实践中通常是提前 `chown` 宿主目录，或者用 `sudo` 参数调用文件 API（文件 API 的 `read`/`write`/`replace`/`search` 支持 `sudo`）。

---

## 5. 四类能力怎么调

### 5.1 命令执行：先搞清 `bash` 和 `shell` 的区别

这是最容易用错的地方。容器同时提供两套命令执行接口，**用途完全不同**：

| | `/v1/bash/*` | `/v1/shell/*` |
| --- | --- | --- |
| 后端 | subprocess + pipe | PTY（伪终端） |
| 输出 | `stdout` / `stderr` 分开 | 单一 `output` 流（合并） |
| 读取方式 | 按 `offset` 增量读 | 全量快照 / WebSocket |
| stdin | pipe | 终端输入流 |
| 适合 | **Agent 工具调用**、短命令、长任务轮询 | **人工接管**、交互式程序、REPL、Web 终端 UI |

**给 Agent 用的一律选 `/v1/bash/exec`。**

```bash
curl -X POST http://localhost:8080/v1/bash/exec \
  -H "Content-Type: application/json" \
  -d '{"command": "pwd && ls -la"}'
```

返回：

```json
{
  "success": true,
  "data": {
    "session_id": "SESSION_ID",
    "command_id": "COMMAND_ID",
    "command": "pwd && ls -la",
    "status": "completed",
    "stdout": "/home/gem\n...",
    "stderr": null,
    "exit_code": 0,
    "offset": 128,
    "stderr_offset": 0
  }
}
```

关键参数：

| 参数 | 说明 |
| --- | --- |
| `session_id` | 目标会话；不传自动创建 |
| `exec_dir` | 工作目录，**必须是绝对路径** |
| `env` | 仅对本次命令生效的环境变量 |
| `async_mode` | `true` 时立即返回 `running`，用于长任务 |
| `timeout` | **软超时**：超时后返回 `running`，命令继续在后台跑 |
| `hard_timeout` | **硬超时**：到期杀掉进程，状态变 `timed_out` |
| `max_output_length` | 同步响应里输出的最大长度，**默认 50000**，设 `0` 关闭截断 |

**会话的一个重要限制**：每次 `exec` 都是**新进程**，同一 `session_id` 只保留 API 层面的状态（比如默认工作目录）。命令内部的 `cd`、`export` **不会**影响后续调用——要跨命令保持目录，每次显式传 `exec_dir`。

长任务用异步 + 轮询：

```bash
# 1. 异步启动
SESSION_ID=$(curl -s -X POST http://localhost:8080/v1/bash/exec \
  -H "Content-Type: application/json" \
  -d '{"command": "sleep 3; echo done", "async_mode": true}' | jq -r ".data.session_id")

# 2. 长轮询等待（wait=true 会阻塞到有新输出或命令结束）
curl -X POST http://localhost:8080/v1/bash/output \
  -H "Content-Type: application/json" \
  -d '{"session_id": "'"${SESSION_ID}"'", "wait": true, "wait_timeout": 30}'
```

常驻进程（比如 dev server）用 `async_mode: true` 启动，读启动日志，用完调 `/v1/bash/kill`（可指定 `SIGTERM`/`SIGKILL`）收尾。给 stdin 喂数据用 `/v1/bash/write`，面向行缓冲的程序记得**在末尾带上 `\n`**。

> 有个细节值得留意：有些程序把提示符写到 `stderr`（部分 REPL 和交互式命令）。接 Agent 时要同时读 `stdout` 和 `stderr`，只看 stdout 会以为程序卡住了。

Web 终端走 WebSocket `ws://localhost:8080/v1/shell/ws`。消息协议很简单：客户端发 `{"type":"input"|"resize"|"pong"}`，服务端发 `{"type":"session_id"|"ready"|"output"|"ping"}`。`input` 是**终端原始输入流**，执行命令必须带换行符。**连接异常时建议新建会话，不要指望重连能恢复完整历史输出。**

### 5.2 文件操作

文件 API 是一套完整的工具集，不是简单的读写：

| 端点 | 用途 |
| --- | --- |
| `POST /v1/file/read` | 读文本文件，支持行范围 |
| `POST /v1/file/write` | 写文本或 base64 二进制 |
| `POST /v1/file/replace` | 文本替换（`old_str` 必须**逐字匹配**，含空白和换行） |
| `POST /v1/file/search` | 单文件内正则搜索 |
| `POST /v1/file/find` | 简单 glob 找文件 |
| `POST /v1/file/grep` | 文件树内搜索，支持 include/exclude |
| `POST /v1/file/glob` | 高级 glob 列文件 |
| `POST /v1/file/list` | 列目录 |
| `POST /v1/file/upload` | multipart/form-data 上传 |
| `GET /v1/file/download` | 下载文件流 |
| `POST /v1/file/watch` 等 | 文件监听（见下） |

写文件时 `encoding` 支持三种：`utf-8`（文本）、`base64`（二进制）、`raw`（拉丁字节）。`read` 的 `start_line` 是 **0 起始**，且 `end_line` **不包含**在返回结果里——这点和很多人的直觉相反，容易少读一行。

**文件监听**在做"等构建完成"这类同步时非常有用：

```bash
# 创建 watcher
curl -X POST http://localhost:8080/v1/file/watch \
  -H "Content-Type: application/json" \
  -d '{"path": "/home/gem/workspace"}'

# 长轮询事件（推荐 create + poll + delete 三步）
curl -X POST http://localhost:8080/v1/file/watch/{watcher_id}/poll \
  -H "Content-Type: application/json" \
  -d '{"cursor": 0, "timeout": 30}'
```

两个坑：

- `cursor` 表示"已消费到的最后一条 `seq`"。**下次请求直接传回响应里的 `cursor`，不要自己加一。**
- 如果文件在调用 `wait` 时**已经存在**，而 `event_types` 里包含 `create`，它会立刻返回一个 `create` 事件。只关心后续变化时，不要把 `create` 放进 `event_types`。
- 响应里出现 `overflow: true` 说明增量历史不完整，需要做一次全量刷新再继续。

### 5.3 代码执行

三个入口，按需要选：

| 接口 | 用途 |
| --- | --- |
| `POST /v1/code/execute` | **统一入口**，按 `language` 自动路由（Python → Jupyter kernel，JavaScript → Node.js） |
| `POST /v1/jupyter/execute` | Python 专用，需要会话状态或富输出（DataFrame、图表） |
| `POST /v1/nodejs/execute` | JavaScript 专用，带 `session_id` 即变为有状态 |

```bash
curl -X POST http://localhost:8080/v1/code/execute \
  -H "Content-Type: application/json" \
  -d '{"language": "python", "code": "print(sum([1, 2, 3]))"}'
```

选择规则：

- 只是想跑段代码、动态选语言 → `/v1/code/execute`
- Python 需要**跨请求保留变量**或要**富输出**（图表、DataFrame HTML）→ Jupyter
- 要执行 `npm install` 这类 shell 命令 → **`/v1/bash/exec`**，不是任何 JS 执行端点

Jupyter 的会话靠 `session_id` 维持：

```bash
curl -X POST http://localhost:8080/v1/jupyter/execute \
  -H "Content-Type: application/json" \
  -d '{"code": "x = 40 + 2\nprint(x)", "session_id": "analysis"}'
```

> 用 Python SDK 调 Jupyter 时注意默认超时是 60 秒，而 kernel 冷启动可能更慢——建议显式把超时调到 120 秒。

### 5.4 浏览器

四种控制面，按"你需要多细的控制"来选：

| 控制面 | 特点 | 适合 |
| --- | --- | --- |
| **CDP** | 低级、灵活，拿到 `browser`/`page` 实例 | Playwright/Puppeteer 自动化 |
| **REST API** | `/v1/browser/*`，高层封装 | 截图、导航、简单交互 |
| **VNC** | 完整桌面，人能直接操作 | 人工接管、调试 |
| **GUI actions** | 纯视觉模拟鼠标键盘，不碰 DOM | 强风控、反自动化场景 |
| **MCP** | 所有 `browser_*` 工具 | 已用 MCP 客户端的 Agent |

拿 CDP 地址有两种等价的写法：

```bash
curl -s http://localhost:8080/v1/browser/info | jq '.data.cdp_url'
curl -s http://localhost:8080/json/version | jq '.webSocketDebuggerUrl'
```

接到 Playwright：

```python
from playwright.sync_api import sync_playwright
from agent_sandbox import Sandbox

client = Sandbox(base_url="http://localhost:8080")
cdp_url = client.browser.get_info().data.cdp_url

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(cdp_url)
    page = browser.new_page()
    page.goto("https://example.com")
    print(page.title())
```

**关键实践：拿到 `cdp_url` 后请复用现有的 context 和 page，不要重新启动浏览器。** 那个 Chromium 属于沙箱，和 REST 工具共享同一个实例——你自己 `new_context()` 出来的页面，`/v1/browser/screenshot` 是看不到的。

**Cookie 与登录状态**：

```bash
# 注入 Cookie
curl -X POST "http://localhost:8080/v1/browser/cookies" \
  -H "Content-Type: application/json" \
  -d '{"cookies": [{"name": "session", "value": "example", "domain": ".example.com", "path": "/", "secure": true, "httpOnly": true}]}'

# 保存 / 恢复完整浏览器状态（需要跨任务复用登录时优先用这个）
curl -X POST http://localhost:8080/v1/browser/state/save \
  -H "Content-Type: application/json" -d '{"path": "/home/gem/browser-state.json"}'
curl -X POST http://localhost:8080/v1/browser/state/load \
  -H "Content-Type: application/json" -d '{"path": "/home/gem/browser-state.json"}'
```

官方明确建议**通过 API 管理 Cookie，不要直接改浏览器 profile 文件**。

**下载**：Chromium 把文件存到 `/home/gem/Downloads`，然后它就只是一个普通文件——`ls` 能看到、文件 API 能读、VSCode 能打开、`/v1/file/download` 能取回宿主机。这正是"统一文件系统"最直观的收益。

```bash
curl -L "http://localhost:8080/v1/file/download?path=/home/gem/Downloads/report.pdf" \
  --output report.pdf
```

如果文件可能还在被后台进程写入，加 `change_policy=abort`，服务端检测到文件变化会中断传输（返回 `409`）。

---

## 6. MCP：让现成的 Agent 客户端直接接上

**不需要单独启动 MCP server。** 沙箱已经在 `/mcp` 暴露了聚合入口，任何兼容 MCP 的客户端填一个 URL 就能连。

```json
{
  "mcpServers": {
    "aio-sandbox": {
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

传输方式是 **streamable HTTP**。设置 API Key 后要带 Bearer header。

实测该端点提供 **32 个工具**，分三组：

**沙箱核心工具（11 个）**

```
sandbox_execute_bash          sandbox_execute_code
sandbox_file_operations       sandbox_str_replace_editor
sandbox_get_context           sandbox_get_packages
sandbox_load_skill            sandbox_convert_to_markdown
browser_get_info              browser_gui_screenshot
browser_gui_execute_action
```

**浏览器工具（21 个）**

```
browser_navigate      browser_go_back        browser_go_forward
browser_click         browser_hover          browser_select
browser_form_input_fill                      browser_scroll
browser_get_text      browser_get_markdown   browser_read_links
browser_get_clickable_elements
browser_evaluate      browser_screenshot     browser_press_key
browser_new_tab       browser_tab_list       browser_switch_tab
browser_close_tab     browser_close          browser_get_download_list
```

以 `browser_` 为前缀的都是浏览器相关工具。可以直接用 JSON-RPC 风格调用：

```bash
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "browser_navigate",
      "arguments": {"url": "https://example.com"}
    }
  }'
```

**两个容易困惑的点：**

- **为什么我看不到底层的浏览器工具？** 默认入口优先暴露常用工具。除非确实需要底层 CDP 行为，用文档里的浏览器 API 或高层 MCP 工具就够了。
- **MCP 和 CDP 该用哪个？** MCP 是高层、开箱即用的抽象，**连接更稳定**（沙箱的 MCP server 包装了 CDP 并暴露 HTTP 接口）；CDP 更灵活，连上之后能拿到 `browser`/`page` 做细粒度控制。追求稳定选 MCP，追求控制力选 CDP。

---

## 7. SDK：Python / TypeScript / Go

| 语言 | 安装 | 主要类型 |
| --- | --- | --- |
| Python | `pip install agent-sandbox` | `Sandbox` / `AsyncSandbox` |
| TypeScript | `npm install @agent-infra/sandbox` | `SandboxApiClient` |
| Go | `go get github.com/agent-infra/sandbox-sdk-go` | `client.NewClient()` |

Python：

```python
from agent_sandbox import Sandbox

client = Sandbox(base_url="http://localhost:8080")

ctx = client.sandbox.get_context()
print(ctx)

result = client.shell.exec_command(command="ls -la")
print(result.data.output)

client.file.write_file(
    file="/home/gem/workspace/task.txt",
    content="Build a small demo app",
)
```

异步版本换个类名，接口一致：

```python
from agent_sandbox import AsyncSandbox
import asyncio

async def main():
    client = AsyncSandbox(base_url="http://localhost:8080")
    ctx = await client.sandbox.get_context()
    result = await client.shell.exec_command(command="ls -la")

asyncio.run(main())
```

TypeScript：

```typescript
import { SandboxApiClient } from '@agent-infra/sandbox';

const client = new SandboxApiClient({
  environment: 'http://localhost:8080',
  timeout: 30000,                          // 可选
  headers: { 'X-AIO-API-Key': 'your-key' } // 需要鉴权时
});

const result = await client.file.read({ path: '/home/gem/task.txt' });
```

可用模块：`client.shell`、`client.file`、`client.browser`、`client.code`、`client.jupyter`、`client.nodejs`、`client.mcp`。

> **文档里有个已知的不一致**：`zh/examples/index.md` 写的是 `pip install aio-sandbox` + `from aio_sandbox import AioClient`，TypeScript 写的是 `AioClient` + `client.shellExec(...)`。这些是**错的/过时的**。以 SDK 自身 README 为准：Python 用 `agent-sandbox` / `from agent_sandbox import Sandbox`，TypeScript 用 `SandboxApiClient` + 模块化调用 `client.shell.exec(...)`。多来源交叉验证后，选后者。

还有一个 **Provider** 概念，容易和 API 客户端搞混：

- **API 客户端**（`Sandbox` 等）面向**已经跑起来的沙箱**发 HTTP 调用，解决"沙箱做什么"。
- **Provider** 是**云平台侧的沙箱生命周期适配层**，负责创建/查询/列出/删除沙箱实例，解决"沙箱从哪来"。

目前内置的 Provider 只有火山引擎（`VolcengineProvider`，对应 VEFAAS）：

```python
from agent_sandbox.providers import VolcengineProvider

provider = VolcengineProvider(
    access_key="your-access-key",
    secret_key="your-secret-key",
    region="cn-beijing",
)

sandbox_id = provider.create_sandbox("function-id", timeout=30)
sandbox = provider.get_sandbox("function-id", sandbox_id)
provider.delete_sandbox("function-id", sandbox_id)
```

如果你不用火山引擎，这部分可以完全忽略——直接用 Docker 自己管容器生命周期就行。

---

## 8. 在沙箱里跑编码 Agent

这是 AIO Sandbox 很有价值的一个用法。官方文档把集成模式分成两类：

| | Agent 调用沙箱 | Agent 跑在沙箱里 |
| --- | --- | --- |
| Agent 位置 | 宿主机、本地服务、远端 | **沙箱容器内部** |
| 交互方式 | REST API / SDK / MCP | 本地命令 / `localhost` API / `aio` CLI |
| 典型场景 | SaaS Agent、多沙箱编排 | **Coding Agent、CI/CD、隔离执行** |
| 网络要求 | 能访问沙箱入口端口 | 直连 `127.0.0.1:8080` |
| 状态共享 | 通过 File/Shell/Browser API | **直接共享容器文件系统和进程环境** |

选哪种的决策树（官方给的）：

```
你的 Agent 需要...

├── 访问外部服务、数据库或控制面
│   └── Agent 调用沙箱
├── 同时操作多个沙箱
│   └── Agent 调用沙箱
├── 通过 MCP 接入现有客户端
│   └── Agent 调用沙箱 + MCP
├── Agent 自身也需要隔离
│   └── Agent 跑在沙箱里
├── 在容器内直接编码、构建、测试
│   └── Agent 跑在沙箱里
└── 外部服务调度、沙箱内子 Agent 执行
    └── 混合
```

### 8.1 三种启动方式

```bash
# 方式一：容器启动时就把 agent 脚本带进去
docker run --rm -it -p 127.0.0.1:8080:8080 \
  -v "$PWD/agent.py:/home/gem/agent.py" \
  ghcr.io/agent-infra/sandbox:latest \
  bash -lc "/entrypoint.sh & sleep 5 && python /home/gem/agent.py"

# 方式二：通过 Shell API 启动
curl -X POST http://localhost:8080/v1/shell/exec \
  -H "Content-Type: application/json" \
  -d '{"command": "pip install my-agent && my-agent start"}'

# 方式三（推荐）：进容器直接跑
docker exec -it <container> bash
python -m pip install my-agent
my-agent start
```

### 8.2 预装的编码 Agent

镜像里已经装好了几个，直接可用：

| Agent | 位置 | 启动方式 |
| --- | --- | --- |
| Codex CLI | `/usr/local/bin/codex` | 终端里 `codex`，或浏览器打开 `/codex` |
| OpenCode | 预装，端口 4096 | 终端里 `opencode`，或浏览器打开 `/opencode` |
| `aio` CLI | `/usr/local/bin/aio` | 见下 |

**Codex** 通过环境变量配置模型接入，三种优先级：

| 变量 | 说明 |
| --- | --- |
| `CODEX_CONFIG_TOML` | 完整 `config.toml` 内容，**优先级最高** |
| `CODEX_API_KEY` | 通用 API key，推荐用于 Responses 兼容网关 |
| `CODEX_MODEL` / `CODEX_BASE_URL` | 模型 ID / endpoint |
| `ARK_API_KEY`、`OPENAI_API_KEY` | 兼容已有配置 |

接一个第三方 Responses 兼容端点：

```bash
docker run --security-opt seccomp=unconfined --rm -it \
  -p 127.0.0.1:8080:8080 \
  -e CODEX_API_KEY="your-api-key" \
  -e CODEX_MODEL="your-model-id" \
  -e CODEX_BASE_URL="https://example.com/api/v3" \
  ghcr.io/agent-infra/sandbox:latest
```

**OpenCode** 用 `OPENCODE_*` 系列：

```bash
docker run --security-opt seccomp=unconfined --rm -it \
  -p 127.0.0.1:8080:8080 \
  -e OPENCODE_API_KEY="your-api-key" \
  -e OPENCODE_MODEL="your-model-id" \
  -e OPENCODE_PROVIDER="openai" \
  -e OPENCODE_BASE_URL="https://api.openai.com/v1" \
  ghcr.io/agent-infra/sandbox:latest
```

> **重要行为**：只要传了这些环境变量，**容器每次启动都会重新生成配置文件**（Codex 是 `~/.codex/config.toml`，OpenCode 是 `~/.config/opencode/config.json`）。手工改过的配置会在下次重启时被覆盖。想保留手改内容，就别传这些变量；想固化配置，就用 `CODEX_CONFIG_TOML` / `OPENCODE_JSON` 传完整内容。

### 8.3 通用做法：把任意 Agent 塞进容器

`pi`、Claude Code 这类没有内建支持的 Agent，模式是一样的：**把模型配置写进容器，然后 `docker exec` 进去跑**。核心是三点：

1. 用 `--env-file` 把密钥传进容器，**不要写进镜像层**；
2. 在容器内生成 Agent 自己的模型配置文件（通常是 JSON/TOML），让它指向你的 `BASE_URL` / `API_KEY` / `MODEL`；
3. `docker exec -w <工作目录>` 启动，交互式加 `-i -t`，一次性任务用 `--print`。

用你自己的 `run-pi-agent.js` 举例，它做的就是这件事：

```javascript
// 1. 在容器内写 pi 的模型配置（不落进镜像，用完删除）
const modelConfig = {
  providers: {
    [PROVIDER_ID]: {
      baseUrl: env.BASE_URL,
      api: env.PI_API || "openai-completions",
      apiKey: "$API_KEY",           // 引用环境变量，避免密钥进配置文件
      models: [{ id: env.MODEL }],
    },
  },
};

// 2. docker exec 把配置写进容器的临时目录
await run("docker", [
  ...commonExecArgs, "-i", CONTAINER_ID, "sh", "-c",
  'umask 077; mkdir -p "$1"; cat > "$1/models.json"', "sh", agentDir,
], { input: JSON.stringify(modelConfig) });

// 3. 启动 agent
await run("docker", [
  ...commonExecArgs,
  ...(interactive ? ["-i", "-t"] : []),
  "-w", workdir, CONTAINER_ID,
  "pi", "--provider", PROVIDER_ID, "--model", env.MODEL,
  "--no-session", "--approve",
  ...(interactive ? [] : ["--print", "--", prompt]),
], { stdio: "inherit" });
```

几个值得借鉴的细节：`umask 077` 保证配置目录只有 owner 可读；`apiKey: "$API_KEY"` 是引用环境变量而不是内联明文；`finally` 块里清理临时目录，且清理前用正则校验路径，防止变量异常时误删。

`aio` CLI 是另一种更轻的做法——它封装了常用 API，在容器内自动指向本地沙箱服务：

```bash
aio browser navigate https://example.com
aio browser screenshot -o /home/gem/page.png
aio gui screenshot -o /home/gem/desktop.png
aio shell 'ls -la'          # pipe 模式命令执行
aio tty                     # 交互式 TTY 会话（基于 tmux）
aio file <subcommand>       # 文件操作
aio sandbox info            # 沙箱环境信息
aio mcp list                # 查看 MCP server
aio skills list             # 查看已注册 Skills
```

调远端沙箱时加 `--api-url`；脚本里用 `--output json` 拿结构化输出。实测子命令分组为：`shell`（pipe）、`tty`（tmux 交互式）、`file`、`gui`、`browser`（Playwright SDK）、`sandbox`、`mcp`、`skills`。

---

## 9. 鉴权与安全

**默认是不设防的。** 官方对本地沙箱的定位是"面向可信本地开发使用"。容器内服务监听 `0.0.0.0`，所以默认配置下它靠 `-p 127.0.0.1:8080:8080` 这一层绑定来保护。一旦要暴露给网络或其他服务，必须加鉴权。

两套鉴权机制：

### 9.1 JWT（RS256）

业务侧用私钥签发 token，沙箱用公钥验证。

```bash
# 1. 生成密钥对
openssl genrsa -out private_key.pem 2048
openssl rsa -in private_key.pem -pubout -out public_key.pem

# 2. 启动时传入 base64 后的公钥
docker run --security-opt seccomp=unconfined --rm -it \
  -p 127.0.0.1:8080:8080 \
  -e JWT_PUBLIC_KEY="$(base64 -w 0 public_key.pem)" \
  ghcr.io/agent-infra/sandbox:latest

# 3. 请求时带 Bearer token
curl "http://localhost:8080/v1/sandbox" \
  -H "Authorization: Bearer $SANDBOX_TOKEN"
```

### 9.2 短时票据

给**没法带 header 的场景**用，主要是浏览器访问：

```bash
# 用 JWT 换一次性票据
ticket=$(curl -s -X POST "http://localhost:8080/tickets" \
  -H "Authorization: Bearer ${jwt}" | jq -r .ticket)

# 票据拼进 URL
http://localhost:8080/vnc/index.html?ticket=${ticket}&path=websockify%3Fticket%3D${ticket}
```

**票据默认只活 30 秒**，由 `TICKET_TTL_SECONDS` 控制。这个默认值对长会话太短了，接 VNC 时经常需要调大。

### 9.3 API Key

有些部署用 `SANDBOX_API_KEY` 这一套，支持三种携带方式：

```bash
curl -H "X-AIO-API-Key: your-secret-key" http://localhost:8080/v1/sandbox
curl -H "Authorization: Bearer your-secret-key" http://localhost:8080/v1/sandbox
curl "http://localhost:8080/v1/sandbox?api_key=your-secret-key"
```

不设置该变量时服务保持开放（向后兼容）。`?api_key=` 会出现在访问日志和浏览器历史里，只在实在没法带 header 时用。

### 9.4 安全清单

官方安全文档的核心建议，加上实践中的补充：

- **不需要远程访问时只绑 localhost**。
- **不要把未鉴权的沙箱 API 暴露到公网**。云上部署尤其注意不要把容器的 8080 直接发布到公网网卡——见第 11 节。
- **共享环境在沙箱前放带 TLS 的反向代理**，并在边界层加鉴权（企业 SSO / IP 白名单）。
- **密钥通过运行时环境变量或密钥管理系统传入**，不要写进自定义镜像，也不要写进 Skills、Hooks、Notebook 或生成文件。
- **任务级优先用短时凭据**。
- **把下载的文件当作不可信输入**处理。
- 给用户提供的路径要做归一化和目录范围校验，并对上传/下载做大小限制——文件 API 默认以沙箱内普通用户权限运行，只有确实需要时才用 `sudo`。

> 关于 `--security-opt seccomp=unconfined`：它放宽了容器的系统调用限制，是 Chromium 能跑起来的必要条件。这是**为了功能而做的妥协**——如果你的威胁模型要求强隔离，应该给沙箱再套一层（独立 VM、专用节点、网络策略），而不是指望容器本身的隔离。官方文档同样明确：沙箱的隔离、资源限制和生命周期由容器、VM 或外部平台负责，沙箱本身不提供按请求隔离的 jail 或路径白名单。

---

## 10. 环境变量与定制

### 10.1 完整变量表

**工作目录**

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `WORKSPACE` | `/home/gem` | Shell、代码执行、Jupyter、code-server 的默认工作目录 |
| `USER` | `gem` | 容器内运行用户 |

**网络与代理**

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PROXY_SERVER` | 空 | 浏览器和网络流量用的上游 HTTP/HTTPS 代理 |
| `PROXY_EXCLUDE` | 空 | 不经过代理的主机列表 |
| `PROXY_INCLUDE` | 空 | 白名单模式下需要走代理的主机 |
| `PROXY_MAP` | 空 | 静态主机映射规则 |
| `DNS_OVER_HTTPS_TEMPLATES` | Cloudflare DoH | 容器内 DNS 解析 |

带账密的出站代理：

```bash
docker run --security-opt seccomp=unconfined --rm -it \
  -p 127.0.0.1:8080:8080 \
  -e PROXY_SERVER=http://proxy.example.com:3128 \
  -e PROXY_EXCLUDE=localhost,127.0.0.1,.example.org \
  ghcr.io/agent-infra/sandbox:latest
```

> 官方选 TinyProxy 做正向代理是有原因的：Chromium **不会使用** `http://user:pass@host:port` 这种内嵌凭据，走质询弹窗又会打断 Browser Use 之类的自动化流程。

**浏览器**

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOMEPAGE` | 空 | 启动时打开的页面 |
| `BROWSER_LANG` | `en-US` | 浏览器语言与 `Accept-Language` |
| `CHROME_UI_LANG` | 空 | Chromium UI 语言 |
| `BROWSER_USER_AGENT` | 默认 UA | 自定义 User-Agent |
| `BROWSER_EXTRA_ARGS` | 空 | 追加启动参数 |
| `BROWSER_ALLOW_FILE_SELECTION_DIALOGS` | 空 | 设 `false` 禁止网页唤起文件选择器 |
| `DISPLAY_WIDTH` / `DISPLAY_HEIGHT` | `1280` / `1024` | 虚拟显示分辨率（**影响 GUI 截图的坐标系**） |

改启动参数要谨慎——删掉默认的安全或进程相关参数可能让自动化变得不稳定。运行时也能调：

```bash
curl -X POST http://127.0.0.1:8080/v1/browser/config \
  -H 'Content-Type: application/json' \
  -d '{"resolution": {"width": 1280, "height": 720}}'

curl -X POST http://127.0.0.1:8080/v1/browser/restart
```

**服务开关**

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `DISABLE_CODE_SERVER` | `false` | 关掉 code-server 省资源 |
| `DISABLE_JUPYTER` | `false` | 关掉 JupyterLab |
| `CODE_SERVER_PORT` | `8200` | code-server 内部端口 |
| `SANDBOX_SRV_PORT` | `8080` | 主 API 服务端口 |
| `TZ` | `Asia/Singapore` | 时区 |

纯 API 部署建议关掉 code-server 和 Jupyter，能省下可观的内存。

**包源**（国内环境很实用）

| 变量 | 默认值 |
| --- | --- |
| `PIP_INDEX_URL` | `https://pypi.org/simple` |
| `UV_DEFAULT_INDEX` | `https://pypi.org/simple` |
| `NPM_CONFIG_REGISTRY` | `https://registry.npmjs.org` |

**生命周期 Hooks**

容器启动的三个阶段可以插 hook：

```
容器启动
  -> RUN_HOOK_INIT           # 最早，服务准备前
  -> 准备运行用户和工作目录
  -> RUN_HOOK_PRE_SERVICES   # 服务启动前，适合装工具、写配置
  -> 托管服务启动
  -> 就绪检查通过
  -> RUN_HOOK_POST_READY     # 服务就绪后，适合预热
```

```bash
docker run --security-opt seccomp=unconfined --rm -it \
  -p 127.0.0.1:8080:8080 \
  -e RUN_HOOK_PRE_SERVICES="code-server --install-extension ms-python.python" \
  ghcr.io/agent-infra/sandbox:latest
```

Hook 命令请保持幂等，不要把密钥写进 hook 值，大依赖用自定义镜像预装更划算。

### 10.2 三种定制程度

按投入递增：

1. **开箱即用** —— 直接连 `/mcp` 或调 API，适合快速验证。
2. **扩展工具集（Skills）** —— 不改镜像，通过 API/SDK 增加或编排工具。
3. **定制镜像** —— `FROM ghcr.io/agent-infra/sandbox:latest`，在 Dockerfile 里装依赖。

自定义镜像的约定目录：服务进程配置放 `/opt/gem/supervisord/*.conf`，Nginx 路由放 `/opt/gem/nginx/*.conf`。装依赖直接在 Dockerfile 里 `RUN pip install` / `RUN npm i -g` 即可。

**Skills** 是可注册到沙箱的自包含指令包，结构如下：

```
my-skill/
  SKILL.md          # 入口，含 frontmatter 元数据 + Markdown 指令
  scripts/
  templates/
  requirements.txt
```

```markdown
---
name: report-writer
description: Create structured reports from source material.
---

# Report Writer

Use this skill when a task requires a structured report.
```

```bash
# 注册沙箱内已存在的 skill 目录
curl -X POST "http://localhost:8080/v1/skills/register" \
  -F "path=/home/gem/skills/report-writer"

# 或上传 zip
curl -X POST "http://localhost:8080/v1/skills/register" \
  -F "file=@report-writer.zip" -F "path=/home/gem/skills" -F "name=report-writer"

curl "http://localhost:8080/v1/skills/metadatas"
```

写 Skill 的建议：`description` 简短并说明触发场景；大段代码放脚本里而不是塞进 Markdown；依赖声明要明确可复现；**不要把密钥写进 skill 文件**。

---

## 11. 部署到服务器

官方的核心警告：

> AIO Sandbox 在容器内部监听 `0.0.0.0`。部署到云主机时，不要把容器的 `8080` 端口直接发布到公网网卡上。

推荐拓扑：单机 VM 绑 `127.0.0.1:8080`，K8s 用 `ClusterIP`；TLS 在 Nginx / 负载均衡 / Ingress 层终止；鉴权加在边界层或启用沙箱自身的 JWT；安全组只放 `80/443`，**不要放 `8080`**。

### 11.1 云主机 + Docker + Nginx

```bash
docker run \
  --security-opt seccomp=unconfined \
  --restart unless-stopped \
  --name aio-sandbox \
  -d \
  -p 127.0.0.1:8080:8080 \
  ghcr.io/agent-infra/sandbox:latest
```

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name sandbox.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name sandbox.example.com;

    ssl_certificate     /etc/letsencrypt/live/sandbox.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sandbox.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

WebSocket 相关的那几行（`Upgrade` / `Connection`）不能少，否则 Web 终端和 VNC 会连不上。

### 11.2 Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aio-sandbox
spec:
  replicas: 1
  selector:
    matchLabels:
      app: aio-sandbox
  template:
    metadata:
      labels:
        app: aio-sandbox
    spec:
      containers:
        - name: aio-sandbox
          image: ghcr.io/agent-infra/sandbox:latest
          ports:
            - containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: aio-sandbox
spec:
  selector:
    app: aio-sandbox
  ports:
    - name: http
      port: 80
      targetPort: 8080
  type: ClusterIP
```

然后用 Ingress 对外发布（记得加 `nginx.ingress.kubernetes.io/proxy-body-size: "50m"` 之类的注解，文件上传会超默认限制）。

**跑 Chromium 的额外要求**：`securityContext.seccompProfile` 用 `Unconfined` 或节点上的 `Localhost` profile；给 `/dev/shm` 约 **4 GiB**（用 `emptyDir: {medium: Memory, sizeLimit: 4Gi}` 挂到 `/dev/shm`），否则浏览器容易崩。这不是沙箱额外加的要求，是 Chromium 自己的需要。

### 11.3 docker-compose

仓库根目录的 `docker-compose.yaml` 是一份比较完整的参考，关键部分：

```yaml
services:
  sandbox:
    container_name: aio-sandbox
    image: ghcr.io/agent-infra/sandbox:latest
    security_opt:
      - seccomp:unconfined
    shm_size: "2gb"
    mem_limit: "8g"
    cpus: "4"
    ports:
      - "127.0.0.1:${HOST_PORT:-8080}:8080"
    environment:
      PROXY_SERVER: ${PROXY_SERVER:-}
      JWT_PUBLIC_KEY: ${JWT_PUBLIC_KEY:-}
      WORKSPACE: ${WORKSPACE:-"/home/gem"}
      TZ: ${TZ:-Asia/Singapore}
      DISABLE_JUPYTER: ${DISABLE_JUPYTER:-false}
      DISABLE_CODE_SERVER: ${DISABLE_CODE_SERVER:-false}
```

注意这份 compose **没有声明 `volumes`**，也就是说默认不持久化。要持久化自己加：

```yaml
    volumes:
      - sandbox_data:/home/gem/workspace
volumes:
  sandbox_data:
```

---

## 12. 版本演进：1.x 与 daemon（aiod）两条线

这是最容易踩坑的地方，值得单独讲清楚。

AIO Sandbox 目前有**两代服务端实现**：

| | 1.x（`/guide`） | daemon（`/daemon`） |
| --- | --- | --- |
| 服务进程 | Python 服务 | **Rust 实现的 `aiod`**，静态 musl 单二进制 |
| API 面 | `/v1/*` | `/v1/*` 兼容 + **`/v2/*` 现代端点** |
| 镜像 | `ghcr.io/agent-infra/sandbox:latest` | `.../vefaas-public/aio-daemon:1.0.1`、`aio-computer:1.0.1` |
| 默认端口 | 8080 | 18091（预构建镜像经 nginx 网关暴露 8091） |

daemon 的性能数字（同主机 0.5 CPU / 0.5 GiB 对比）：

| 指标 | aiod | 1.x Python 服务 |
| --- | --- | --- |
| API 进程空闲内存 | 14.6 MB | 120 MB |
| 混合压测吞吐 | 112 ops/s | 33 ops/s |
| 启动到 API 就绪 | 0.8 s | 2.6 s |
| 命令执行 p50 | 2.3 ms | 12.6 ms |

### 12.1 迁移的破坏性变更

换镜像之后，v1 路由仍然在，所以多数客户端不用改代码。但有这些必须检查：

- **JWT 和 ticket 机制整体移除**。以前只配了 `JWT_PUBLIC_KEY` 的部署**现在等于没开鉴权**，启动时会告警。改配 `AIO_API_KEY`（`SANDBOX_API_KEY` 是这个变量的别名）。
- **整体删除的路由**：`/v1/skills/*`（Skills CRUD）、`/v1/sandbox/hooks`、`/v1/util/convert_to_markdown`、运行时代理映射 API（改用静态 `PROXY_MAP`）、`/v1/browser/state/*`、`/v1/browser/captcha/*`、`/v1/browser/restart`、`POST /tickets`。
- **默认值变了**：`DISABLE_CODE_SERVER=true`、`DISABLE_JUPYTER=true`（Lab 界面关，`/v1/jupyter` API 仍可用）、不预热 kernel、`AIO_SHELL_BACKEND=native` / `AIO_CODE_BACKEND=native` 固定不做探测。
- **SDK 只覆盖 v1**，要调 v2 得直接发 HTTP（运行中的 daemon 在 `/v2/openapi.json` 提供 spec）。已验证的三个必然失败的调用：`nodejs.update_session`、`browser_tabs.activate`（SDK 发 PUT，路由只收 POST）、`browser_tabs.close`（参数语义不匹配）。
- **状态全在内存**：command/PTY/代码会话、输出保留、文件 watcher、编辑撤销历史重启即丢。**已写入磁盘的文件不受影响。**

### 12.2 新架构的设计边界

daemon 有个刻意的定位需要理解：**它不做沙箱生命周期管理**。没有 create/list/pause/resume/destroy 沙箱的 API，没有 TTL，没有资源配额。

> 隔离、资源限制和生命周期仍由容器、VM 或外部平台负责。

它提供的是**会话级**的回收和上限：

| 资源 | 上限 | 空闲超时 | 环境变量 |
| --- | --- | --- | --- |
| Bash 命令会话 | 50 | 3600 s | `AIO_BASH_MAX_SESSIONS` / `AIO_BASH_SESSION_TIMEOUT_SECS` |
| PTY 终端 | 20 | 3600 s | `AIO_SHELL_MAX_SESSIONS` / `AIO_SHELL_SESSION_TIMEOUT_SECS` |
| 原生代码会话 | 20 | 1800 s | `AIO_CODE_MAX_SESSIONS` / `AIO_CODE_SESSION_TIMEOUT_SECS` |
| Kernel 会话 | 5 | 300 s | `AIO_KERNEL_MAX_SESSIONS` / `AIO_KERNEL_SESSION_TIMEOUT_SECS` |
| 文件 watcher | 128 | — | — |

daemon 的一个实用特性是**能力探测与降级**：它在运行时探测 shell、解释器、浏览器、桌面后端，缺什么就只让对应路由返回 `503`，其余功能照常。`GET /v1/capabilities` 返回当前能力快照（缓存 5 秒，`?refresh=true` 强制重测）。

另一个卖点是**可注入现有镜像**——把 `aiod` 二进制拷进你已有的容器/VM/桌面镜像，就获得统一的 Agent 工具接口，不用换基础镜像：

```dockerfile
FROM your/base-image
COPY aiod /usr/local/bin/aiod
CMD ["aiod", "start"]
```

**给新项目的建议**：从 1.x 镜像起步（生态成熟、SDK 完整、文档齐），但要清楚它和 daemon 的差异；如果对资源占用、启动速度敏感，或者需要把工具层注入已有镜像，直接上 daemon。注意 daemon 的鉴权模型不同（`AIO_API_KEY` 一把钥匙，支持 `Authorization: Bearer` / `x-api-key` / `?api_key=` 三种携带方式），迁移时别漏了。

---

## 13. 排错速查

### 13.1 错误处理的分层判断

这是文档反复强调、也是实践中最重要的一个习惯：**不要只看 HTTP 状态码**。

```
1. 看 HTTP 状态码        -> 传输 / 鉴权 / 路由层面的问题
2. 看响应体 success 字段 -> 工具级失败
3. 看 data.status        -> 命令生命周期（completed / running / timed_out / killed）
4. 看 exit_code / stderr -> 命令本身是否成功
```

**HTTP 200 + `success: true` 不代表命令成功了**：

```json
{
  "success": true,
  "data": {
    "status": "finished",
    "exit_code": 1,
    "stdout": "",
    "stderr": "command not found"
  }
}
```

`success: true` 的含义只是"沙箱成功处理了这个请求"。

一个可直接用的断言辅助：

```python
def assert_sandbox_response(response):
    if getattr(response, "success", True) is False:
        raise RuntimeError(response.message)

    data = getattr(response, "data", None)
    if data is not None and getattr(data, "exit_code", 0) not in (0, None):
        raise RuntimeError(getattr(data, "stderr", "execution failed"))

    return data
```

文件 API 有个**特例**：预期内的文件系统失败返回 **HTTP 200 + `success: false`**，错误详情在 `data` 里（`error_type`、`errno_name`、`retryable` 等）。`error_type` 取值包括 `not_found`、`permission_denied`、`invalid_target`、`already_exists`、`no_space_left`、`decode_error` 等。**例外中的例外**是 `GET /v1/file/download`——成功返回二进制流，失败走标准 HTTP 错误码。

常见状态码：

| 码 | 含义 |
| --- | --- |
| 400 | 请求非法或业务校验失败 |
| 401 / 403 | 缺鉴权 / 鉴权无效 / 操作被拒绝 |
| 404 | 路由或目标资源不存在 |
| 409 | 目标已存在（或下载时文件被改动） |
| 422 | 请求体校验失败 |
| 500+ | 沙箱服务内部错误 |

### 13.2 常见问题

**浏览器启动失败？** 先确认容器内存够（建议 2GB 以上），并用推荐的 seccomp 参数启动：

```bash
docker run --security-opt seccomp=unconfined --rm -it -p 127.0.0.1:8080:8080 \
  ghcr.io/agent-infra/sandbox:latest
```

受限容器环境还要检查 Chromium 沙箱能力和 `/dev/shm` 大小（K8s 里给 4GiB）。

**8080 被占用？** 换宿主端口映射，然后把 base_url 改成新端口：

```bash
docker run --security-opt seccomp=unconfined --rm -it \
  -p 127.0.0.1:3000:8080 ghcr.io/agent-infra/sandbox:latest
```

**SDK 连不上？** 确认 `base_url` 指向正确的宿主端口：

```python
client = Sandbox(base_url="http://localhost:8080")
print(client.sandbox.get_context())
```

**截图正常但自动化操作失败？** 检查页面是否加载完成、目标元素是否可见，以及选的接口是否合适。DOM 级操作用 CDP 或 page API，视觉桌面级操作用 GUI actions——两者不能混。

**下载的文件在哪？** `/home/gem/Downloads`。

**为什么 `cd` 不生效？** 见 5.1：`/v1/bash` 的会话不保留命令内部的 `cd` 和 `export`，跨调用要显式传 `exec_dir`。

**浏览器返回成功但页面是错的？** 连接被拒绝时 Chromium 会加载自己的错误页并触发 `load` 事件，所以 `navigate` 仍返回成功。要检查页面最终内容（比如 `browser_evaluate` 读 `location.href`，会看到 `chrome-error://chromewebdata/`）。只有主机完全无响应时 `navigate` 才返回 `503`。

**导航之后元素引用失效？** CDP 的元素 ref 只属于获取它的那份文档，每次导航后都要重新获取。同一份 ref 在导航后可能解析到别的节点，行为是静默错误的。

**怎么预装依赖？** 两种方式：基于公开镜像构建自定义镜像（Dockerfile 里装），或者用启动 Hook（`RUN_HOOK_PRE_SERVICES`）。

**怎么设默认工作目录？** 启动时设 `WORKSPACE`。

---

## 14. 参考链接

- 官方站点（中文）：<https://sandbox.agent-infra.com/zh/>
- 快速开始：<https://sandbox.agent-infra.com/zh/guide/start/quick-start>
- 完整 API 文档（沙箱内）：`http://localhost:8080/v1/docs`
- GitHub 仓库：<https://github.com/agent-infra/sandbox>（Apache-2.0）
- daemon 架构文档：<https://sandbox.agent-infra.com/zh/daemon/start/introduction>
- 云部署指引：<https://sandbox.agent-infra.com/zh/guide/start/cloud-deployment>
- 安全指南：<https://sandbox.agent-infra.com/zh/guide/advanced/security>
- SDK：`agent-sandbox`（PyPI）、`@agent-infra/sandbox`（npm）、`agent-infra/sandbox-sdk-go`（Go）
- 相关论文：arXiv 2509.02544（UI-TARS-2 Technical Report）

---

## 附录：文档中已发现的不一致

写指南时交叉核对官方文档，发现几处会误导使用者的问题，列在这里以便你自己看文档时不被带偏：

| 位置 | 文档写的 | 实际情况 |
| --- | --- | --- |
| `zh/examples/index.md` | `pip install aio-sandbox`、`from aio_sandbox import AioClient` | 真实包名是 `agent-sandbox`，类名是 `Sandbox` |
| `zh/examples/index.md` | TS 用 `AioClient` + `client.shellExec(...)` | 真实导出是 `SandboxApiClient` + `client.shell.exec(...)` |
| 主 README | `import { Sandbox }` + `new Sandbox({ baseURL })` | 与 `sdk/js/README.md` 的 `SandboxApiClient` + `{ environment }` 冲突 |
| `guide/start/quick-start` | 表格里 Jupyter 行描述写成 "VSCode Server" | 笔误 |
| 启动 banner | "镜像版本：1.0.0.93" | 与镜像 tag（1.11.0）不是一个体系，以 `/v1/sandbox` 为准 |
| 博客 announcing-0 | Dockerfile 示例写到 `/opt/tiger/run/supervisord/` | 正文声明的是 `/opt/gem/supervisord/`，以后者为准 |
| JS SDK README | License 写 ISC | 仓库根 LICENSE 是 Apache-2.0 |

一句话：**遇到冲突时，以 SDK 自身 README、`/v1/sandbox` 实际返回、以及正在运行的容器实测为准。**
