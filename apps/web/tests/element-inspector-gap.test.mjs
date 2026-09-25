import assert from "node:assert/strict";
import test from "node:test";
import { calculateGapRects } from "../src/sdk/element-inspector/gap-geometry.ts";
import { createElementInspector } from "../src/sdk/element-inspector/inspector.ts";
import { describeElement } from "../src/sdk/element-inspector/selection.ts";

class FakeEventTarget {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

function createInspectorFixture() {
  const frameWindow = new FakeEventTarget();
  frameWindow.getComputedStyle = () => ({
    rowGap: "0px",
    columnGap: "0px",
    marginTop: "0px",
    marginRight: "0px",
    marginBottom: "0px",
    marginLeft: "0px",
    borderTopWidth: "0px",
    borderRightWidth: "0px",
    borderBottomWidth: "0px",
    borderLeftWidth: "0px",
    paddingTop: "0px",
    paddingRight: "0px",
    paddingBottom: "0px",
    paddingLeft: "0px",
    display: "block",
  });
  const frameDocument = new FakeEventTarget();
  frameDocument.documentElement = {};
  frameDocument.defaultView = frameWindow;
  const createElement = ({ tagName, id, classList, left }) => ({
    nodeType: 1,
    tagName,
    id,
    classList,
    children: [],
    ownerDocument: frameDocument,
    getBoundingClientRect: () => ({ left, top: 20, width: 80, height: 32 }),
  });
  const element = createElement({
    tagName: "BUTTON",
    id: "save",
    classList: ["primary"],
    left: 10,
  });
  const secondElement = createElement({
    tagName: "A",
    id: "cancel",
    classList: ["secondary"],
    left: 110,
  });
  const iframe = new FakeEventTarget();
  iframe.contentDocument = frameDocument;
  iframe.contentWindow = frameWindow;
  return { element, secondElement, frameDocument, iframe };
}

test("元素选择结果包含祖先链路和受限的运行时上下文", () => {
  const parent = {
    tagName: "SECTION",
    id: "dashboard",
    classList: ["metrics"],
    parentElement: null,
  };
  const selection = describeElement({
    tagName: "ARTICLE",
    id: "hero",
    classList: ["card", "featured", "wide", "ignored"],
    parentElement: parent,
    attributes: [
      { name: "class", value: "card featured wide" },
      { name: "aria-label", value: "核心指标" },
    ],
    textContent: "  核心指标   在线 128  ",
    outerHTML: '<article class="card featured wide" aria-label="核心指标">在线 128</article>',
  });

  assert.deepEqual(selection, {
    tagName: "article",
    id: "hero",
    classNames: ["card", "featured", "wide"],
    hint: "section#dashboard.metrics > article#hero.card.featured.wide",
    domHint: {
      path: "section#dashboard.metrics > article#hero.card.featured.wide",
      ancestors: ["section#dashboard.metrics"],
      attributes: { "aria-label": "核心指标" },
      text: "核心指标 在线 128",
      outerHTML: '<article class="card featured wide" aria-label="核心指标">在线 128</article>',
    },
  });
});

test("没有稳定 id 时，hint 会携带父级和祖先元素", () => {
  const main = { tagName: "MAIN", id: "app", classList: [], parentElement: null };
  const section = {
    tagName: "SECTION",
    id: "",
    classList: ["dashboard", "dark"],
    parentElement: main,
  };
  const selection = describeElement({
    tagName: "ARTICLE",
    id: "",
    classList: ["metric-card"],
    parentElement: section,
  });

  assert.equal(selection.hint, "main#app > section.dashboard.dark > article.metric-card");
  assert.deepEqual(selection.domHint.ancestors, ["main#app", "section.dashboard.dark"]);
});

test("元素选择结果会携带源码定位插件注入的 source id", () => {
  const selection = describeElement({
    tagName: "BUTTON",
    id: "save",
    classList: ["primary"],
    getAttribute: (name) => name === "data-artifact-source" ? "s_abc123" : null,
  });

  assert.equal(selection.sourceId, "s_abc123");
});

test("元素选择结果会解析 Code Inspector 的源码位置", () => {
  const selection = describeElement({
    tagName: "BUTTON",
    id: "save",
    classList: ["primary"],
    getAttribute: (name) => name === "data-insp-path"
      ? "src/components/SaveButton.tsx:27:5:button"
      : null,
  });

  assert.deepEqual(selection.source, {
    file: "src/components/SaveButton.tsx",
    line: 27,
    column: 5,
  });
});

test("单击只激活元素，确认选择后才产出列表项", () => {
  const { element, frameDocument, iframe } = createInspectorFixture();
  const states = [];
  const inspector = createElementInspector({
    iframe,
    onInspectionStateChange: (state) => states.push(state),
  });

  inspector.setPickingEnabled(true);
  frameDocument.emit("click", {
    target: element,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  });

  assert.equal(states.at(-1).activeInspections[0].selection.hint, "button#save.primary");
  assert.equal(states.at(-1).hoveredInspection, null);

  assert.deepEqual(inspector.confirmActiveSelections(), [
    {
      tagName: "button",
      id: "save",
      classNames: ["primary"],
      hint: "button#save.primary",
      domHint: {
        path: "button#save.primary",
        ancestors: [],
        attributes: {},
      },
    },
  ]);
  assert.deepEqual(states.at(-1).activeInspections, []);
  assert.equal(states.at(-1).hoveredInspection, null);
  assert.deepEqual(inspector.confirmActiveSelections(), []);

  inspector.destroy();
});

test("Ctrl 或 Command 单击可以追加和取消激活元素", () => {
  const { element, secondElement, frameDocument, iframe } = createInspectorFixture();
  const states = [];
  const inspector = createElementInspector({
    iframe,
    onInspectionStateChange: (state) => states.push(state),
  });
  const click = (target, modifiers = {}) => frameDocument.emit("click", {
    target,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
    ...modifiers,
  });

  inspector.setPickingEnabled(true);
  click(element);
  click(secondElement, { ctrlKey: true });
  assert.deepEqual(
    states.at(-1).activeInspections.map(({ selection }) => selection.hint),
    ["button#save.primary", "a#cancel.secondary"],
  );

  click(element, { metaKey: true });
  assert.deepEqual(
    states.at(-1).activeInspections.map(({ selection }) => selection.hint),
    ["a#cancel.secondary"],
  );

  assert.deepEqual(
    inspector.confirmActiveSelections().map(({ hint }) => hint),
    ["a#cancel.secondary"],
  );
  inspector.destroy();
});

test("激活元素后 hover 其他元素会同时保留两种状态", () => {
  const { element, secondElement, frameDocument, iframe } = createInspectorFixture();
  const states = [];
  const inspector = createElementInspector({
    iframe,
    onInspectionStateChange: (state) => states.push(state),
  });

  inspector.setPickingEnabled(true);
  frameDocument.emit("click", {
    target: element,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  });
  frameDocument.emit("pointerover", { target: secondElement });

  assert.equal(states.at(-1).activeInspections[0].selection.hint, "button#save.primary");
  assert.equal(states.at(-1).hoveredInspection.selection.hint, "a#cancel.secondary");
  inspector.destroy();
});

test("grid 列间距贯穿完整网格行", () => {
  const gaps = calculateGapRects({
    display: "grid",
    container: { left: 54, top: 57, width: 1104, height: 554 },
    children: [
      { left: 54, top: 57, width: 588, height: 554 },
      { left: 694, top: 57, width: 464, height: 305 },
    ],
    rowGap: 52,
    columnGap: 52,
  });

  assert.deepEqual(gaps, [
    { left: 642, top: 57, width: 52, height: 554 },
  ]);
});

test("grid 行间距横跨完整网格列", () => {
  const gaps = calculateGapRects({
    display: "grid",
    container: { left: 20, top: 30, width: 600, height: 420 },
    children: [
      { left: 20, top: 30, width: 240, height: 180 },
      { left: 20, top: 234, width: 160, height: 216 },
    ],
    rowGap: 24,
    columnGap: 0,
  });

  assert.deepEqual(gaps, [
    { left: 20, top: 210, width: 600, height: 24 },
  ]);
});

test("flex 间距仍限定在相邻元素的重叠范围内", () => {
  const gaps = calculateGapRects({
    display: "flex",
    container: { left: 0, top: 0, width: 400, height: 200 },
    children: [
      { left: 0, top: 20, width: 180, height: 120 },
      { left: 200, top: 40, width: 200, height: 80 },
    ],
    rowGap: 0,
    columnGap: 20,
  });

  assert.deepEqual(gaps, [
    { left: 180, top: 40, width: 20, height: 80 },
  ]);
});
