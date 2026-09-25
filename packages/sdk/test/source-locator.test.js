import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "acorn";
import {
  instrumentHtml,
  instrumentJavaScript,
  SOURCE_ATTRIBUTE,
} from "../src/vite/source-locator.js";

test("为静态 HTML 标签注入 source id 并保留原始位置", () => {
  const source = [
    "<!doctype html>",
    '<main class="hero">',
    "  <h1>标题</h1>",
    "  <img src=\"/hero.png\" />",
    "</main>",
  ].join("\n");

  const result = instrumentHtml(source, { file: "index.html" });
  const mappings = Object.values(result.mappings);

  assert.equal(mappings.length, 3);
  assert.deepEqual(
    mappings.map(({ file, tagName, line, column }) => ({ file, tagName, line, column })),
    [
      { file: "index.html", tagName: "main", line: 2, column: 1 },
      { file: "index.html", tagName: "h1", line: 3, column: 3 },
      { file: "index.html", tagName: "img", line: 4, column: 3 },
    ],
  );
  assert.match(result.html, new RegExp(`<main [^>]*${SOURCE_ATTRIBUTE}="s_`));
  assert.match(result.html, new RegExp(`${SOURCE_ATTRIBUTE}="s_[^"]+" \/>`));
});

test("忽略注释和 raw text 中看起来像标签的内容", () => {
  const source = [
    "<!-- <aside>not dom</aside> -->",
    "<script>const fake = '<button>not dom</button>';</script>",
    "<style>.x::before { content: '<i>'; }</style>",
    "<section>real</section>",
  ].join("\n");
  const result = instrumentHtml(source, { file: "src/page.html" });

  assert.deepEqual(
    Object.values(result.mappings).map((mapping) => mapping.tagName),
    ["script", "style", "section"],
  );
});

test("重复转换不会重复写入已经存在的标签", () => {
  const first = instrumentHtml("<main><p>hello</p></main>");
  const second = instrumentHtml(first.html);
  const matches = second.html.match(/data-artifact-source=/gu) || [];

  assert.equal(matches.length, 2);
  assert.equal(Object.keys(second.mappings).length, 2);
});

test("为 innerHTML 及辅助函数中的 HTML 模板字符串注入 source id", () => {
  const source = [
    'const card = (title, kind) => `<article class="card ${kind}"><h2>${title}</h2></article>`;',
    'const items = ["道路", "桥梁"];',
    'document.querySelector("#app").innerHTML = `<main>${items.map((item) => card(item, "ok")).join("")}</main>`;',
  ].join("\n");

  const result = instrumentJavaScript(source, {
    file: "src/main.js",
    parse: (code) => parse(code, { ecmaVersion: "latest", sourceType: "module" }),
  });
  const mappings = Object.values(result.mappings);

  assert.deepEqual(mappings.map((mapping) => mapping.tagName), ["article", "h2", "main"]);
  assert.deepEqual(mappings.map((mapping) => mapping.file), [
    "src/main.js",
    "src/main.js",
    "src/main.js",
  ]);
  assert.equal((result.code.match(/data-artifact-source=/gu) || []).length, 3);
  assert.match(result.code, /class="card \$\{kind\}" data-artifact-source="s_[^"]+"/u);
  assert.match(result.code, /<h2 data-artifact-source="s_[^"]+">\$\{title\}/u);
  assert.match(result.code, /<main data-artifact-source="s_[^"]+">\$\{items/u);
});
