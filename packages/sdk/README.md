# @artifact-editor/sdk

与具体宿主项目无关的产物编辑能力：

- `@artifact-editor/sdk`：DOM 选择、运行时 hint、元素编辑与覆盖层；
- `@artifact-editor/sdk/react`：负责上述能力生命周期的 React hook；
- `@artifact-editor/sdk/vite`：React/Vue 精确源码定位的 Vite Adapter；
- `@artifact-editor/sdk/vite/source-locator`：早期 HTML 注入定位实验，默认运行链路不启用。

HTML 产物默认把选择器、祖先链路、关键属性、文本和 HTML 摘要作为 hint 发送给 Agent，不修改构建产物。React/Vue 产物由 Vite Adapter 接入 `code-inspector-plugin`，补充精确源码位置。
