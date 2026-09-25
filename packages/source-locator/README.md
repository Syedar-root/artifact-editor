# Source Locator

> 这是早期源码映射实验。Artifact Editor 当前不再把它加载到 HTML 产物；HTML 项目改用无侵入的运行时 DOM hint，React/Vue 项目使用 `code-inspector-plugin`。

`@artifact-editor/source-locator` 把静态 HTML 标签，以及 JavaScript 模板字符串中生成的 HTML/SVG，与原始源码位置关联起来。

```js
import { artifactSourceLocator } from "@artifact-editor/source-locator";

export default {
  plugins: [artifactSourceLocator()],
};
```

开发服务器返回的 HTML，以及运行时插入页面的模板内容，会带有类似属性：

```html
<button data-artifact-source="s_1a2b3c">保存</button>
```

映射表位于：

```text
/__artifact/source-map
```

每个映射包含文件、标签名、原始行列号和字符范围。插件只转换响应，不修改磁盘上的 HTML 源码。

## 当前支持范围

- 静态 HTML 标签；
- Vite 的单页和多页 HTML 入口；
- `innerHTML`、辅助函数等位置的 HTML/SVG 模板字符串，包括带 `${...}` 插值的模板；
- 注释、`script`、`style`、`textarea` 和 `title` 的 raw text 跳过；
- 重复转换保护。

同一段模板被循环渲染时，多个 DOM 会共享同一个 source id，这是预期行为：它们都回指同一处源码。

暂不覆盖 `document.createElement`、普通字符串拼接、React/Vue 等框架虚拟 DOM，以及浏览器或 Vite 自动生成的 DOM。这些场景需要对应的 JavaScript API 或框架 Adapter。
