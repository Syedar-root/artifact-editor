# 前端宿主

`src/App.tsx` 组装工作台页面。

- `src/components/`：页头、会话列表、对话区、预览与代码视图、版本菜单、创建窗口和元素编辑弹层。
- `src/hooks/use-workbench.ts`：协调产物、会话、消息与版本操作，组合其他 Hook。
- `src/hooks/use-element-drafts.ts`：接入 Web SDK，管理元素草稿、评论、编辑模式与消息附件。
- `src/hooks/use-code-browser.ts`：读取文件树和内容，管理展开状态与复制操作。
- `src/hooks/use-panel-resize.ts`：管理面板宽度、拖动与键盘调整。
- `src/types.ts`：宿主界面与接口共用的数据类型；配置、时间格式和创建进度解析分别放在对应模块。
- `src/styles/`：按界面职责拆分样式，`src/styles.css` 按原有顺序加载，保留层叠关系。

在仓库根目录运行 `npm run build`、`npm run typecheck` 和 `npm run test --workspace @artifact-editor/web`。

`npm run test:web:integration` 使用独立 Web 服务和固定接口响应，验证预览加载、元素草稿、消息发送、版本菜单及代码浏览，无需调用真实 Agent 或 Docker。
