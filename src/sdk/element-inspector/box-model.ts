import { calculateGapRects } from "./gap-geometry";
import type { BoxEdges, BoxRect, ElementBoxModel } from "./types";

function pixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function rectFromDom(rect: DOMRect): BoxRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function edgeValues(style: CSSStyleDeclaration, prefix: "margin" | "padding"): BoxEdges {
  return {
    top: pixels(style[`${prefix}Top`]),
    right: pixels(style[`${prefix}Right`]),
    bottom: pixels(style[`${prefix}Bottom`]),
    left: pixels(style[`${prefix}Left`]),
  };
}

function borderValues(style: CSSStyleDeclaration): BoxEdges {
  return {
    top: pixels(style.borderTopWidth),
    right: pixels(style.borderRightWidth),
    bottom: pixels(style.borderBottomWidth),
    left: pixels(style.borderLeftWidth),
  };
}

function insetRect(rect: BoxRect, first: BoxEdges, second: BoxEdges): BoxRect {
  const left = first.left + second.left;
  const top = first.top + second.top;
  const right = first.right + second.right;
  const bottom = first.bottom + second.bottom;
  return {
    left: rect.left + left,
    top: rect.top + top,
    width: Math.max(0, rect.width - left - right),
    height: Math.max(0, rect.height - top - bottom),
  };
}

function childRects(element: Element): BoxRect[] {
  return Array.from(element.children)
    .slice(0, 60)
    .map((child) => rectFromDom(child.getBoundingClientRect()))
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

export function readBoxModel(element: Element): ElementBoxModel {
  const view = element.ownerDocument.defaultView;
  if (!view) throw new Error("元素不属于可用的浏览器窗口");
  const style = view.getComputedStyle(element);
  const rowGap = pixels(style.rowGap);
  const columnGap = pixels(style.columnGap);
  const rect = rectFromDom(element.getBoundingClientRect());
  const border = borderValues(style);
  const padding = edgeValues(style, "padding");

  return {
    rect,
    margin: edgeValues(style, "margin"),
    border,
    padding,
    rowGap,
    columnGap,
    gapRects: calculateGapRects({
      display: style.display,
      container: insetRect(rect, border, padding),
      children: childRects(element),
      rowGap,
      columnGap,
    }),
  };
}
