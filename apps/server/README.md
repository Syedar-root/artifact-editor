# Server

Server 统一使用 TypeScript，按业务模块组织，模块内按 Controller、Service、Repository、Model 分层。Web 应用承担视图层。

```text
src/
  main.ts                         应用启动、HTTP 适配与静态资源
  app.module.ts                   组合模块
  config/                         ConfigModule 与 ServerConfigService
  common/filters/                  统一异常响应
  modules/
    artifacts/
      artifacts.module.ts
      controllers/                产物、文件、版本接口与进度流
      services/                   产物业务、依赖缓存、模板、工作区与预览
      repositories/               产物元数据与存储访问
      models/                     产物类型、ID 校验、工作区事务与 Git 版本类
    agent/
      agent.module.ts
      controllers/                对话与会话接口
      services/                   对话、会话、展示、工具定义与薄 DSH 接入
      models/                     会话 ID 校验
    health/                       健康检查
  infrastructure/sandbox/
    sandbox.module.ts
    services/                     命令等待与同源 HTTP/HMR 入口
    models/                       SDK 响应状态解析
scripts/
  clean-dist.ts                   编译前清理旧输出
test/                             TypeScript 回归与真实沙箱集成测试
```

`Controller → 业务 Service → Repository / 沙箱基础设施` 是主要调用关系。`ConfigModule` 提供配置和路径校验，`ArtifactsModule` 公开 `ArtifactsService` 给 Agent 模块，`SandboxModule` 注入官方 `SandboxClient`，直接向业务模块提供官方 SDK。`SandboxCommandService.run()` 仅处理命令等待、输出限制、超时和取消清理；文件操作由产物文件业务直接调用 SDK，路径约束属于 `ArtifactWorkspace`，预览 session 的创建、回收和关闭属于 `PreviewService`；`PreviewProxyService` 使用标准 HTTP 代理库提供同源入口，容器内路由由 AIO 处理。

`ArtifactRepository` 管理产物元数据，扫描与文件持久化由 `ArtifactFilesystemService` 实现，纯模板与 Vite 配置生成由 `ArtifactTemplateService` 实现。`WorkspaceService` 为每个产物创建 `ArtifactWorkspace` 并接入 `DependenciesService`。依赖安装通过官方文件接口复制清单，通过 Bash 执行 npm/pnpm 和目录链接；缓存决策在服务端方法中完成。工作区类管理串行编辑与回滚，`ArtifactVersions` 管理 Git 版本；两个类均位于 `models/`，不通过独立函数导出业务逻辑。`PreviewService` 管理定位插件与 Vite 预览，`ArtifactsService` 编排创建和历史版本切换。

`ChatService` 在编辑事务中调用 `DshRuntimeService`。DSH 继续直接组合官方核心包，接受模型、插件和工具，不另写模型循环。`SessionViewService` 转换会话展示数据，`SessionsService` 处理会话查询。请求参数、进度流等 HTTP 辅助逻辑由 Controller 的私有方法处理。

`AgentToolsService.forWorkspace()` 使用官方 `defineTool` 声明 `read/write/edit/list/search/bash`、`inspect_artifact`、`install_dependencies` 和 `build`。工具绑定该次编辑提供的工作区，不重复获取编辑锁；产物检查由 Server 绑定当前产物 ID。创建产物和启动预览继续通过 HTTP 业务接口调用。

源码、测试和构建辅助文件均使用 TypeScript。源码开启严格类型检查，只编译 `src/**/*.ts`。ESM 导入中的 `.js` 后缀对应编译后的文件，开发和测试通过 `tsx` 解析对应的 `.ts` 源码。Server 不再包含注入容器执行的 Node 业务程序。模板生成的 Vite 配置和前端源码属于产物文件，由官方文件接口写入沙箱。npm/pnpm 的安装、缓存和链接机制见[根目录说明](../../README.md)。

```bash
npm run dev --workspace @artifact-editor/server
npm run check:server
npm run test --workspace @artifact-editor/server
```

配置 `ARTIFACT_SANDBOX_URL`（默认 `http://127.0.0.1:18080`），可选的 `ARTIFACT_SANDBOX_TOKEN` 用于 JWT 鉴权。NAS 源码和 SSD 依赖挂载目录必须允许 AIO 执行用户读写。

设置 `ARTIFACT_SANDBOX_TEST_URL` 后可运行 `npm run test:integration --workspace @artifact-editor/server`。真实集成测试通过官方 SDK 使用 `/tmp/artifact-aio-*` 的独立源码和依赖目录，验证三个技术栈及 HMR；要求已安装 pnpm 且 5173 预览端口空闲。
