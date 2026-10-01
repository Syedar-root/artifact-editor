# Artifact Editor

这是一个包含宿主 Web 应用和 Express 接口服务的 npm monorepo。

```text
apps/
  web/       React + Vite 宿主界面
  server/    Express、Artifact/Session 管理与沙箱代理
packages/
  sdk/
    src/web/       无头 DOM 检查、属性编辑、overlay、React hook 与 Vite Adapter
    src/server/    Sandbox Bash 接口、文件辅助操作、薄 Git 版本封装、可选 Docker 适配器
```

## 元素定位策略

前端模块组织见 [前端宿主说明](apps/web/README.md)。

- HTML + JavaScript 产物不修改 DOM，用户选择元素时采集祖先链路、关键属性、文本和 HTML，并作为运行时 hint 发送给 Agent；
- React/Vue 产物使用 `code-inspector-plugin` 提供 `file:line:column`；
- Artifact 同时保存创建时选择的技术栈和从当前源码检测到的技术栈。启动预览及 Agent 修改依赖后都会重新检测，必要时自动切换定位方式并重启预览。

## 开发

```bash
npm install
npm run dev
```

开发模式会同时启动：

- Web：`http://127.0.0.1:4173`
- Express：`http://127.0.0.1:4174`

Vite 会把 `/api` 和 `/proxy` 请求转发给 Express。

## 构建和运行

```bash
npm run build
npm start
```

生产模式下 Express 在 `http://127.0.0.1:4173` 同时提供接口、沙箱预览代理和 Web 静态文件。

Agent 配置继续从仓库根目录的 `.env` 读取。宿主使用一个用户的已有容器，可通过 `ARTIFACT_SANDBOX_CONTAINER` 指定容器 ID。

SDK server 只要求实现 `Sandbox.bash`，产物目录通过 `cwd` 传入。用户绑定、沙箱生命周期、产物信息和持久化由宿主管理。现有宿主的 Pi 对话、Workspace 编辑队列和 checkpoint 规则在 `apps/server` 中封装，通过 SDK 执行命令。SDK 保留旧浏览器导入入口，新的接入统一使用 `/web` 和 `/server`。

执行接口、辅助方法与两种 Agent 接入示例见 [SDK 文档](packages/sdk/README.md)。

`npm test` 运行 SDK、宿主版本工作流和 Web 回归检查；真实 Docker 测试通过 `SDK_DOCKER_CONTAINER` 指定容器。已启动宿主接口时，设置 `ARTIFACT_SERVER_TEST_URL` 和 `ARTIFACT_SANDBOX_CONTAINER` 后运行 `npm run test:integration --workspace @artifact-editor/server`，验证文件、版本、构建与预览。集成测试使用独立临时产物，并要求宿主预览槽位空闲。

`npm run test:web:integration` 使用 Chromium 验证首次打开和刷新时预览只加载一次。测试会启动独立的 Web 服务并提供固定接口响应，无需启动业务服务或 Docker；可通过 `ARTIFACT_TEST_BROWSER` 指定浏览器可执行文件。
