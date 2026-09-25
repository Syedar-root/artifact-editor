# Artifact Editor

这是一个包含宿主 Web 应用和 Express 接口服务的 npm monorepo。

```text
apps/
  web/       React + Vite 宿主界面
  server/    Express、Artifact/Session 管理与沙箱代理
packages/
  source-locator/  早期源码定位实验（当前运行链路不加载）
```

## 元素定位策略

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

Agent 配置继续从仓库根目录的 `.env` 读取。
