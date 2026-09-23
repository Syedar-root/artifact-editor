import { readBoxModel } from "./box-model";
import { describeElement } from "./selection";
import type { ElementInspection, ElementInspector, ElementInspectorOptions } from "./types";

function eventElement(event: Event): Element | null {
  const target = event.target;
  return target && "nodeType" in target && target.nodeType === 1
    ? (target as Element)
    : null;
}

export function createElementInspector({
  iframe,
  onSelect,
  onInspect,
  onCancel,
}: ElementInspectorOptions): ElementInspector {
  let enabled = false;
  let frameDocument: Document | null = null;
  let frameWindow: Window | null = null;
  let hoveredElement: Element | null = null;

  function inspect(element: Element): ElementInspection {
    return {
      element,
      selection: describeElement(element),
      boxModel: readBoxModel(element),
    };
  }

  function show(element: Element) {
    if (element === hoveredElement) return;
    hoveredElement = element;
    onInspect?.(inspect(element));
  }

  function handlePointerOver(event: PointerEvent) {
    const element = eventElement(event);
    if (element) show(element);
  }

  function handleClick(event: MouseEvent) {
    const element = eventElement(event);
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    onSelect(describeElement(element));
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setEnabled(false);
    onCancel?.();
  }

  function refresh() {
    if (hoveredElement) onInspect?.(inspect(hoveredElement));
  }

  function detach() {
    frameDocument?.removeEventListener("pointerover", handlePointerOver, true);
    frameDocument?.removeEventListener("click", handleClick, true);
    frameDocument?.removeEventListener("keydown", handleKeyDown, true);
    frameWindow?.removeEventListener("scroll", refresh, true);
    frameWindow?.removeEventListener("resize", refresh);
    onInspect?.(null);
    frameDocument = null;
    frameWindow = null;
    hoveredElement = null;
  }

  function attach() {
    detach();
    if (!enabled) return;
    const document = iframe.contentDocument;
    const window = iframe.contentWindow;
    if (!document?.documentElement || !window) return;

    frameDocument = document;
    frameWindow = window;

    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
  }

  function setEnabled(nextEnabled: boolean) {
    if (enabled === nextEnabled) return;
    enabled = nextEnabled;
    if (enabled) attach();
    else detach();
  }

  function handleFrameLoad() {
    if (enabled) attach();
  }

  iframe.addEventListener("load", handleFrameLoad);

  return {
    setEnabled,
    destroy() {
      enabled = false;
      detach();
      iframe.removeEventListener("load", handleFrameLoad);
    },
  };
}
