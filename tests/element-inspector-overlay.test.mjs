import assert from "node:assert/strict";
import test from "node:test";
import { figmaInspectorTheme } from "../src/element-inspector-overlay/figma-theme.ts";
import { createElementInspectorOverlay } from "../src/element-inspector-overlay/renderer.ts";

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
