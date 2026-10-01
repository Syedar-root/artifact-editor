import assert from "node:assert/strict";
import test from "node:test";
import {
  createElementInspectorOverlay,
  figmaInspectorTheme,
} from "@artifact-editor/sdk/web/overlay";
import { workbenchInspectorTheme } from "../src/element-inspector-theme.ts";

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = { cssText: "", display: "" };
    this.parent = null;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  setAttribute() {}

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
}

function createOverlayFixture() {
  const documentElement = new FakeNode("html");
  const document = {
    documentElement,
    defaultView: { innerWidth: 1024, innerHeight: 768 },
    createElement(tagName) {
      return new FakeNode(tagName);
    },
  };
  const iframe = {
    contentDocument: document,
    addEventListener() {},
    removeEventListener() {},
  };
  const element = { ownerDocument: document };
  const inspection = {
    element,
    selection: { tagName: "button", id: "", classNames: [], hint: "button" },
    boxModel: {
      rect: { left: 20, top: 30, width: 100, height: 40 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      rowGap: 0,
      columnGap: 0,
      gapRects: [],
    },
  };
  return { documentElement, iframe, inspection };
}

test("元素选中描边紧贴 border-box，不额外向外偏移", () => {
  const { documentElement, iframe, inspection } = createOverlayFixture();
  const overlay = createElementInspectorOverlay({ iframe, theme: figmaInspectorTheme });

  overlay.setActive(true);
  overlay.render({ hoveredInspection: null, activeInspections: [inspection] });

  const root = documentElement.children.find(
    ({ dataset }) => dataset.artifactInspector === "overlay",
  );
  const outline = root.children.find(({ style }) => style.cssText.includes("outline:2px solid"));
  assert.match(outline.style.cssText, /outline-offset:0px/);

  overlay.destroy();
});

test("关闭盒模型时仍保留简洁标签与完整定位上下文", () => {
  const { documentElement, iframe, inspection } = createOverlayFixture();
  inspection.selection.hint = "main.page > section.hero > button.primary";
  inspection.selection.classNames = ["primary"];
  inspection.boxModel.margin = { top: 20, right: 20, bottom: 20, left: 20 };
  inspection.boxModel.padding = { top: 8, right: 8, bottom: 8, left: 8 };
  const overlay = createElementInspectorOverlay({
    iframe,
    theme: { ...workbenchInspectorTheme, showBoxModel: false },
  });
  overlay.setActive(true);
  overlay.render({ hoveredInspection: null, activeInspections: [inspection] });
  const root = documentElement.children.find(({ dataset }) => dataset.artifactInspector === "overlay");
  assert.equal(root.children.length, 3);
  assert.equal(root.children.find(({ dataset }) => dataset.artifactInspector === "label").textContent, "button.primary · 100 × 40");
  assert.equal(inspection.selection.hint, "main.page > section.hero > button.primary");

  const hoveredInspection = {
    ...inspection,
    boxModel: { ...inspection.boxModel, rect: { left: 160, top: 30, width: 80, height: 30 } },
  };
  overlay.render({ hoveredInspection, activeInspections: [inspection] });
  assert.equal(root.children.filter(({ dataset }) => dataset.artifactInspector === "label").length, 2);
  overlay.destroy();
});

test("工作台在选中和悬停时绘制 margin、padding 和 gap", () => {
  const { documentElement, iframe, inspection } = createOverlayFixture();
  inspection.boxModel.margin = { top: 20, right: 20, bottom: 20, left: 20 };
  inspection.boxModel.padding = { top: 8, right: 8, bottom: 8, left: 8 };
  inspection.boxModel.gapRects = [{ left: 52, top: 38, width: 12, height: 24 }];
  const overlay = createElementInspectorOverlay({ iframe, theme: workbenchInspectorTheme });
  overlay.setActive(true);
  for (const state of [
    { hoveredInspection: inspection, activeInspections: [] },
    { hoveredInspection: null, activeInspections: [inspection] },
  ]) {
    overlay.render(state);
    const root = documentElement.children.find(({ dataset }) => dataset.artifactInspector === "overlay");
    const layers = (kind) => root.children.filter(({ dataset }) => dataset.artifactInspector === kind);
    assert.equal(layers("margin").length, 4);
    assert.equal(layers("padding").length, 4);
    assert.equal(layers("gap").length, 1);
    assert.equal(layers("measurement").length, 8);
    assert.match(layers("margin")[0].style.cssText, /left:0px;top:10px;width:140px;height:20px/u);
    assert.match(layers("padding")[0].style.cssText, /left:20px;top:30px;width:100px;height:8px/u);
    assert.equal(layers("gap")[0].children[0].textContent, "12");
  }
  overlay.destroy();
});
