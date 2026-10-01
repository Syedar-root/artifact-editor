import assert from "node:assert/strict";
import test from "node:test";
import { calculateElementEditorPosition } from "../src/element-editor-position.ts";

const VIEWPORT_MARGIN = 8;

function assertInsidePreview(result, input) {
  const previewTop = input.iframeTop + VIEWPORT_MARGIN;
  const previewBottom = input.iframeTop + input.iframeHeight - VIEWPORT_MARGIN;
  assert.ok(result.maxHeight > 0, "弹层应获得可用区域的最大高度");
  if (result.placement === "below") {
    assert.ok(result.top >= previewTop);
    assert.ok(result.top + result.maxHeight <= previewBottom);
  } else {
    assert.ok(result.top <= previewBottom);
    assert.ok(result.top - result.maxHeight >= previewTop);
  }
}

test("靠近预览底部时，编辑弹层不会超出可见区域", () => {
  const input = {
    iframeLeft: 0,
    iframeTop: 42,
    iframeWidth: 900,
    iframeHeight: 320,
    propertyCount: 4,
    target: { left: 380, top: 252, width: 140, height: 48 },
  };

  assertInsidePreview(calculateElementEditorPosition(input), input);
});

test("上下空间都不足时，弹层使用空间更大的一侧并限制高度", () => {
  const input = {
    iframeLeft: 0,
    iframeTop: 42,
    iframeWidth: 900,
    iframeHeight: 260,
    propertyCount: 18,
    target: { left: 380, top: 92, width: 140, height: 48 },
  };

  const result = calculateElementEditorPosition(input);
  assert.equal(result.placement, "below");
  assertInsidePreview(result, input);
});

test("窄视口中弹层中心会按实际宽度限制在左右边界内", () => {
  const input = {
    iframeLeft: 0,
    iframeTop: 42,
    iframeWidth: 280,
    iframeHeight: 500,
    propertyCount: 2,
    target: { left: 250, top: 200, width: 30, height: 30 },
  };

  const result = calculateElementEditorPosition(input);
  const actualPopoverWidth = input.iframeWidth - VIEWPORT_MARGIN * 2;
  assert.ok(result.left + actualPopoverWidth / 2 <= input.iframeWidth - VIEWPORT_MARGIN);
});
