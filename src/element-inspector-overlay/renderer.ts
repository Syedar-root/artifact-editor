import type { BoxEdges, BoxRect, ElementInspection } from "../sdk/element-inspector";
import type {
  ElementInspectorOverlay,
  ElementInspectorOverlayOptions,
  ElementInspectorOverlayTheme,
} from "./types";

interface EdgeMeasurement {
  value: number;
  x: number;
  y: number;
}

function createLayer(document: Document, rect: BoxRect, color: string): HTMLDivElement | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const layer = document.createElement("div");
  layer.style.cssText = [
    "position:fixed",
    `left:${rect.left}px`,
    `top:${rect.top}px`,
    `width:${rect.width}px`,
    `height:${rect.height}px`,
    `background:${color}`,
    "box-sizing:border-box",
  ].join(";");
  return layer;
}

function createGapLayer(
  document: Document,
  rect: BoxRect,
  theme: ElementInspectorOverlayTheme,
): HTMLDivElement | null {
  const layer = createLayer(document, rect, theme.gapFill);
  if (!layer) return null;
  layer.style.border = `1px dashed ${theme.gapAccent}`;

  const value = document.createElement("span");
  value.textContent = String(Math.round(Math.min(rect.width, rect.height)));
  value.style.cssText = [
    "position:absolute",
    "left:50%",
    "top:50%",
    "transform:translate(-50%,-50%)",
    "min-width:18px",
    "padding:2px 5px",
    "border-radius:4px",
    `background:${theme.gapAccent}`,
    `color:${theme.labelForeground}`,
    `font:600 11px/1.3 ${theme.fontFamily}`,
    "text-align:center",
    "box-shadow:0 1px 3px rgba(80,16,61,.18)",
  ].join(";");
  layer.append(value);
  return layer;
}

function edgeMeasurements(rect: BoxRect, edges: BoxEdges, outside: boolean): EdgeMeasurement[] {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const direction = outside ? -1 : 1;
  return [
    { value: edges.top, x: rect.left + rect.width / 2, y: rect.top + direction * edges.top / 2 },
    { value: edges.right, x: right - direction * edges.right / 2, y: rect.top + rect.height / 2 },
    { value: edges.bottom, x: rect.left + rect.width / 2, y: bottom - direction * edges.bottom / 2 },
    { value: edges.left, x: rect.left + direction * edges.left / 2, y: rect.top + rect.height / 2 },
  ].filter((measurement) => measurement.value > 0);
}

function createMeasurementBadge(
  document: Document,
  measurement: EdgeMeasurement,
  color: string,
  theme: ElementInspectorOverlayTheme,
): HTMLSpanElement {
  const badge = document.createElement("span");
  const viewport = document.defaultView;
  const x = Math.min(Math.max(12, measurement.x), (viewport?.innerWidth || 24) - 12);
  const y = Math.min(Math.max(9, measurement.y), (viewport?.innerHeight || 18) - 9);
  badge.textContent = String(Math.round(measurement.value));
  badge.style.cssText = [
    "position:fixed",
    `left:${Math.round(x)}px`,
    `top:${Math.round(y)}px`,
    "transform:translate(-50%,-50%)",
    "padding:1px 4px",
    "border-radius:3px",
    `background:${theme.measurementBackground}`,
    `color:${color}`,
    `border:1px solid ${color}`,
    `font:600 10px/1.25 ${theme.fontFamily}`,
    "box-shadow:0 1px 2px rgba(0,0,0,.10)",
  ].join(";");
  return badge;
}

function inset(rect: BoxRect, edges: BoxEdges): BoxRect {
  return {
    left: rect.left + edges.left,
    top: rect.top + edges.top,
    width: Math.max(0, rect.width - edges.left - edges.right),
    height: Math.max(0, rect.height - edges.top - edges.bottom),
  };
}

function edgeRects(rect: BoxRect, edges: BoxEdges, outside = false): BoxRect[] {
  const outer = outside
    ? {
        left: rect.left - edges.left,
        top: rect.top - edges.top,
        width: rect.width + edges.left + edges.right,
        height: rect.height + edges.top + edges.bottom,
      }
    : rect;
  const inner = outside ? rect : inset(rect, edges);

  return [
    { left: outer.left, top: outer.top, width: outer.width, height: inner.top - outer.top },
    {
      left: outer.left,
      top: inner.top + inner.height,
      width: outer.width,
      height: outer.top + outer.height - inner.top - inner.height,
    },
    { left: outer.left, top: inner.top, width: inner.left - outer.left, height: inner.height },
    {
      left: inner.left + inner.width,
      top: inner.top,
      width: outer.left + outer.width - inner.left - inner.width,
      height: inner.height,
    },
  ];
}

export function createElementInspectorOverlay({
  iframe,
  theme,
}: ElementInspectorOverlayOptions): ElementInspectorOverlay {
  let active = false;
  let mountedDocument: Document | null = null;
  let root: HTMLDivElement | null = null;
  let cursorStyle: HTMLStyleElement | null = null;

  function unmount() {
    root?.remove();
    cursorStyle?.remove();
    mountedDocument = null;
    root = null;
    cursorStyle = null;
  }

  function mount(document: Document): HTMLDivElement {
    if (mountedDocument === document && root) return root;
    unmount();
    mountedDocument = document;
    root = document.createElement("div");
    root.dataset.artifactInspector = "overlay";
    root.setAttribute("aria-hidden", "true");
    root.style.cssText = [
      "display:none",
      "position:fixed",
      "inset:0",
      "pointer-events:none",
      "z-index:2147483647",
    ].join(";");
    document.documentElement.append(root);
    if (active) mountCursor(document);
    return root;
  }

  function mountCursor(document: Document) {
    cursorStyle?.remove();
    cursorStyle = document.createElement("style");
    cursorStyle.textContent = `* { cursor: ${theme.cursor} !important; }`;
    document.documentElement.append(cursorStyle);
  }

  function clear() {
    if (!root) return;
    root.style.display = "none";
    root.replaceChildren();
  }

  function appendRects(rects: BoxRect[], color: string) {
    if (!mountedDocument || !root) return;
    for (const rect of rects) {
      const layer = createLayer(mountedDocument, rect, color);
      if (layer) root.append(layer);
    }
  }

  function appendMeasurements(rect: BoxRect, edges: BoxEdges, outside: boolean, color: string) {
    if (!mountedDocument || !root) return;
    for (const measurement of edgeMeasurements(rect, edges, outside)) {
      root.append(createMeasurementBadge(mountedDocument, measurement, color, theme));
    }
  }

  function render(inspection: ElementInspection | null) {
    if (!inspection) {
      clear();
      return;
    }

    const document = inspection.element.ownerDocument;
    const overlayRoot = mount(document);
    const model = inspection.boxModel;
    overlayRoot.replaceChildren();
    overlayRoot.style.display = "block";

    appendRects(edgeRects(model.rect, model.margin, true), theme.marginFill);
    appendRects(edgeRects(model.rect, model.border), theme.borderFill);
    const paddingBox = inset(model.rect, model.border);
    appendRects(edgeRects(paddingBox, model.padding), theme.paddingFill);

    const content = createLayer(document, inset(paddingBox, model.padding), theme.contentFill);
    if (content) overlayRoot.append(content);
    appendMeasurements(model.rect, model.margin, true, theme.marginAccent);
    appendMeasurements(paddingBox, model.padding, false, theme.paddingAccent);
    for (const gapRect of model.gapRects) {
      const gapLayer = createGapLayer(document, gapRect, theme);
      if (gapLayer) overlayRoot.append(gapLayer);
    }

    const outline = document.createElement("div");
    outline.style.cssText = [
      "position:fixed",
      `left:${model.rect.left}px`,
      `top:${model.rect.top}px`,
      `width:${model.rect.width}px`,
      `height:${model.rect.height}px`,
      `outline:1px solid ${theme.selection}`,
      `outline-offset:${theme.outlineOffset}px`,
      "box-sizing:border-box",
    ].join(";");
    overlayRoot.append(outline);

    const label = document.createElement("div");
    const labelTop = model.rect.top >= theme.labelHeight + theme.labelGap + 4
      ? model.rect.top - theme.labelHeight - theme.labelGap
      : model.rect.top + model.rect.height + theme.labelGap;
    label.textContent = `${inspection.selection.hint} · ${Math.round(model.rect.width)}×${Math.round(model.rect.height)}`;
    label.style.cssText = [
      "position:fixed",
      `left:${Math.round(Math.max(4, model.rect.left))}px`,
      `top:${Math.round(Math.max(4, labelTop))}px`,
      "max-width:calc(100vw - 8px)",
      "padding:6px 9px",
      "border-radius:5px",
      `background:${theme.selection}`,
      `color:${theme.labelForeground}`,
      `font:600 12px/1.45 ${theme.fontFamily}`,
      "-webkit-font-smoothing:antialiased",
      "text-rendering:optimizeLegibility",
      "white-space:nowrap",
      "overflow:hidden",
      "text-overflow:ellipsis",
      "box-shadow:0 2px 6px rgba(13,86,139,.18)",
    ].join(";");
    overlayRoot.append(label);
  }

  function handleFrameLoad() {
    if (!active || !iframe.contentDocument?.documentElement) return;
    mount(iframe.contentDocument);
  }

  iframe.addEventListener("load", handleFrameLoad);

  return {
    setActive(nextActive) {
      active = nextActive;
      if (!active) {
        clear();
        cursorStyle?.remove();
        cursorStyle = null;
        return;
      }
      const document = iframe.contentDocument;
      if (document?.documentElement) {
        mount(document);
        mountCursor(document);
      }
    },
    render,
    destroy() {
      active = false;
      iframe.removeEventListener("load", handleFrameLoad);
      unmount();
    },
  };
}
