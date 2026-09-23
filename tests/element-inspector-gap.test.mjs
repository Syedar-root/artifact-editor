import assert from "node:assert/strict";
import test from "node:test";
import { calculateGapRects } from "../src/sdk/element-inspector/gap-geometry.ts";
import { describeElement } from "../src/sdk/element-inspector/selection.ts";

test("元素选择结果只包含简短 hint，不包含内部文本", () => {
  const selection = describeElement({
    tagName: "ARTICLE",
    id: "hero",
    classList: ["card", "featured", "wide", "ignored"],
    textContent: "这段很长的内容不应该进入选择结果",
  });

  assert.deepEqual(selection, {
    tagName: "article",
    id: "hero",
    classNames: ["card", "featured", "wide"],
    hint: "article#hero.card.featured.wide",
  });
  assert.equal("text" in selection, false);
  assert.equal("description" in selection, false);
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
