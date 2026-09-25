# Vite 生态的 DOM / 组件源码定位方案调研

调研日期：2026-09-25

> 实施决策更新：后续讨论决定纯 HTML/原生 JavaScript 产物完全不注入源码属性，而是在选择元素时把祖先链路等运行时 DOM hint 直接交给 Agent。`code-inspector-plugin` 仅用于检测为 React/Vue 的产物。下文保留的是形成这一决策前的方案调研。

## 结论

有成熟方案，但成熟的是**按框架划分的组件定位器**，不是一个可以完整覆盖“普通 HTML + 原生 JavaScript 动态 DOM + React/Vue/Svelte”的通用 Vite 插件。

对于本项目，更稳妥的方向不是删除 `packages/source-locator` 并押注某一个第三方插件，而是采用混合架构：

- 普通 HTML、`innerHTML` 和 HTML 模板字符串继续使用现有轻量适配器；
- React、Vue、Svelte 项目优先接入各自成熟的 inspector；
- 在宿主应用内统一成我们自己的 `{ file, line, column, sourceId? }` 协议；
- `launch-editor-middleware` 只负责最后的“打开编辑器”，不负责 DOM 到源码的定位。

核心原因是：多数成熟 inspector 的产品目标是“用户点击一下，立即打开本地编辑器”，而本项目需要的是“宿主选中 DOM 后，取得并保存可传给 Agent 的源码位置”。两者底层信息相近，但对外接口并不相同。

## 方案对比

| 方案 | 普通 HTML / 原生动态 DOM | React | Vue | Svelte | 暴露的定位形态 | 成熟度判断 | 对本项目的价值 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [`vite-plugin-vue-inspector`](https://github.com/webfansplz/vite-plugin-vue-inspector) | 不支持 | 不支持 | Vue 3 专用 | 不支持 | 从 Vue 编译产物及 source map 解析源码位置；通常点击后打开编辑器，不再依赖可见 DOM 属性，遗漏节点才用 `data-v-inspector` 兜底 | GitHub 约 809 stars、222 次提交；npm 7.0.0，历史版本多，npm 页面显示很高的下载量 | Vue Adapter 首选；通过其 client trace API 转换成统一位置协议，不要依赖 DOM 属性 |
| [`vite-plugin-vue-devtools`](https://www.npmjs.com/package/vite-plugin-vue-devtools) | 不支持 | 不支持 | Vue 专用 | 不支持 | Vue DevTools 内置组件 inspector / 打开编辑器能力 | Vue 官方仓库维护；npm 8.2.1、79 dependents、约 90 万周下载 | 若产物本身已使用 Vue DevTools，可复用；若只要元素定位，单独的 Vue Inspector 更轻 |
| [`@sveltejs/vite-plugin-svelte-inspector`](https://github.com/sveltejs/vite-plugin-svelte/blob/main/docs/inspector.md) | 不支持 | 不支持 | 不支持 | Svelte 专用 | 鼠标下元素显示文件位置，点击打开编辑器；没有面向宿主的全量持久映射表 | 位于 Svelte 官方 `vite-plugin-svelte` 仓库，随官方插件维护 | Svelte Adapter 首选；需要包装其元素追踪结果，不能直接当成我们的 source-map endpoint |
| [`vite-plugin-react-click-to-component`](https://github.com/ArnaudBarre/vite-plugin-react-click-to-component) | 不支持 | 支持 | 不支持 | 不支持 | 基于 React 开发期 JSX source / Fiber 信息，右键或快捷点击后调用 Vite editor middleware | 约 85 stars、多个发布版本；Vite 官方 React 插件的 changelog 也明确提到它的行号兼容性 | React 的轻量候选；其目标是打开编辑器，若要把位置发给宿主，需要二次封装客户端选择逻辑 |
| [`react-dev-inspector`](https://github.com/zthxxx/react-dev-inspector) | 不支持 | 支持 | 不支持 | 不支持 | 编译器可注入 `data-inspector-line`、`data-inspector-column`、`data-inspector-relative-path`，Inspector 从 React/Fiber 读取后交给服务端打开编辑器 | 约 1.3k stars、78 forks；[`@react-dev-inspector/vite-plugin`](https://www.npmjs.com/package/%40react-dev-inspector/vite-plugin) npm 页面显示约 1.5 万周下载 | 与当前 `data-*` 方案最接近，可作为 React Adapter 的实现基础；但它不是 vanilla 方案 |
| [`code-inspector-plugin`](https://github.com/zh-lx/code-inspector) | **不能完整覆盖**；静态 HTML 入口只注入客户端脚本，不标注元素；不处理 `innerHTML` 模板字符串 | 支持 JSX / React 风格创建逻辑 | 支持 | 支持 | 编译期写入 `data-insp-path/row/col/node`，既可点击打开 IDE，也可由宿主读取 | 约 3k stars、239 forks；[`code-inspector-plugin`](https://www.npmjs.com/package/code-inspector-plugin) 有 182 个发布版本、约 16 万周下载，且覆盖多种构建器 | **跨框架接入最值得 PoC 的候选**；但不能替换当前 vanilla HTML 与模板字符串能力 |
| [`HoverSource`](https://github.com/loerei/HoverSource) | 部分支持：运行时 monkey patch `createElement` 和 `innerHTML` | 支持 | 支持 | 支持 | 将 V8 stack 中的 file/line/column 写入 `data-hs-source`；静态 HTML、注入前已创建节点会是 Unknown，无 source map 时会指向构建物 | 383 commits，但目前约 6 stars、1 fork，生态验证仍早 | 技术路线很接近我们的缺口，适合参考或做可选 runtime fallback，不建议现在作为核心依赖 |
| [`vite-plugin-inspect`](https://github.com/antfu-collective/vite-plugin-inspect) | 不适用 | 不适用 | 不适用 | 不适用 | 展示 Vite 插件转换前后的模块代码 | 约 1.7k stars、381 commits，很成熟 | 名称容易混淆；它调试的是 Vite 插件流水线，不做 DOM → 源码定位 |
| [`launch-editor-middleware`](https://www.npmjs.com/package/launch-editor-middleware) | 不负责定位 | 不负责定位 | 不负责定位 | 不负责定位 | 接收 `file:line:column` 后打开编辑器 | Vite 官方组织维护；153 dependents、约 73 万周下载 | 可以直接复用为安全、成熟的“最后一公里”，但上游仍必须先得到源码位置 |

## 关键边界

### 1. `code-inspector-plugin` 并不能补上 vanilla 缺口

它是目前跨框架、跨构建器覆盖面较广的候选，但官方源码显示：

- 官方 [`support`](https://github.com/zh-lx/code-inspector#support) 列出了 React、Vue、Svelte、Preact、Solid、Qwik、Astro 等框架，但没有列普通 HTML / vanilla JavaScript；
- 它定义了 [`data-insp-path`、`data-insp-row`、`data-insp-col`、`data-insp-node`](https://github.com/zh-lx/code-inspector/blob/main/packages/core/src/shared/constant.ts) 等 DOM 属性，因此在受支持的框架中，宿主可以直接读取位置，不必局限于它自带的“打开 IDE”交互；
- Vite 的 [`transformIndexHtml`](https://github.com/zh-lx/code-inspector/blob/main/packages/vite/src/index.ts#L193-L207) 仅向 `<head>` 注入客户端脚本，并没有遍历静态 HTML 标签写入源码位置；
- JavaScript 进入 [`transformCode`](https://github.com/zh-lx/code-inspector/blob/main/packages/core/src/server/transform/index.ts) 后按 `jsx`、`vue`、`svelte` 等文件类型处理；
- JSX 逻辑位于 [`transform-jsx.ts`](https://github.com/zh-lx/code-inspector/blob/main/packages/core/src/server/transform/transform-jsx.ts)，面向 JSX / React 风格的创建表达式，而不是任意 JavaScript 中的 `innerHTML = '<div>…'` 或模板字符串。

因此，把现有插件整体换成 `code-inspector-plugin` 会重新引入“智慧市政运行监测报告”这类项目无法定位的问题；但把它作为 React/Vue/Svelte/Astro 等框架 Adapter，则能显著减少我们的自研范围。

### 2. 成熟框架插件不一定往 DOM 上保留属性

新版 Vue Inspector 明确说明，它主要从 Vue 编译 render 输出和 Vite source map 恢复位置，可见 `data-v-inspector` 只作为部分场景的 fallback。它还暴露了 [`findTraceFromElement`](https://github.com/webfansplz/vite-plugin-vue-inspector#client-api) 等 headless helper。

这说明统一协议不应该限定为“DOM 必须带某个 data 属性”。建议定义一个适配器接口：

```ts
type SourceLocation = {
  file: string;
  line: number;
  column: number;
  sourceId?: string;
};

interface SourceLocatorAdapter {
  resolve(element: Element): Promise<SourceLocation | null>;
}
```

vanilla Adapter 可以读 `data-artifact-source`；Vue Adapter 可以调用 trace API；React/Svelte Adapter 可以读取各自开发期元数据。宿主只关心统一的返回值。

### 3. “能打开编辑器”不等于“有可持久化映射”

Svelte Inspector、React click-to-component 等工具通常在点击时即时解析位置，然后请求 editor endpoint。它们没有承诺提供一个类似 `/__artifact/source-map` 的稳定、全量 JSON 表。

对本项目而言，更准确的持久对象应是**源码位置**，而不是第三方插件的内部 source ID。source ID 可以用于同一次构建中的 DOM 选择；会话真正保存的字段应至少包含 `file + line + column`，并附带构建版本/文件内容 hash，避免源码变化后静默指向错误位置。

## 推荐落地方式

### 第一阶段：保留现有实现，停止扩大通用 AST 改写范围

保留 `packages/source-locator` 已经稳定覆盖的两类情况：

- Vite HTML 入口中的静态标签；
- 原生 JavaScript 模板字符串产生的 HTML / SVG，包括 `innerHTML`。

不要继续尝试用一个自研解析器覆盖 JSX、Vue SFC、Svelte compiler 以及所有可能的字符串拼接。框架编译器比我们更清楚组件和真实 DOM 的关系。

### 第二阶段：建立 Adapter 层

按项目依赖自动选择：

1. 跨框架的第一轮 PoC：`code-inspector-plugin`，直接把 `data-insp-*` 转换成宿主统一协议；
2. Vue 3 若需要更精准的 Vue render/source-map trace：`vite-plugin-vue-inspector`；
3. Svelte 若不采用统一跨框架插件：官方 `@sveltejs/vite-plugin-svelte-inspector`；
4. React 若不采用统一跨框架插件：优先验证 `react-dev-inspector`，因为它已有 file/line/column 属性协议；若只需要交互式打开源码，可选更轻的 `vite-plugin-react-click-to-component`；
5. Vanilla：继续使用 `@artifact-editor/source-locator`；
6. 无法识别时：只允许 DOM selector 作为低置信度提示，不把它伪装成精确源码映射。

### 第三阶段：可选 runtime fallback

针对 `document.createElement()` 等当前空白，可借鉴 HoverSource 的运行时思路：在应用代码执行前 patch DOM 创建 API，记录调用栈，再通过 source map 还原位置。

这只能作为 fallback，因为它有三个天然限制：

- patch 安装之前生成的 DOM 无法追踪；
- 浏览器调用栈格式和压缩/转译会影响稳定性；
- 没有 source map 时只能得到构建产物位置。

## 最终建议

现在**不建议用某一个现成插件整体替换** `packages/source-locator`。建议把它收缩为 vanilla Adapter，并把第三方成熟能力放在框架 Adapter 中组合使用。

这样可以把自研范围控制在真正缺少成熟方案的部分，同时避免为了支持 React/Vue/Svelte，重复实现它们已经维护多年的编译器与开发期元数据解析逻辑。
