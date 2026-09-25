import { readBoxModel } from "./box-model.ts";
import { describeElement } from "./selection.ts";
import type { ElementInspection, ElementInspector, ElementInspectorOptions } from "./types.ts";

function eventElement(event: Event): Element | null {
  const target = event.target;
  return target && "nodeType" in target && target.nodeType === 1
    ? (target as Element)
    : null;
}

export function createElementInspector({
  iframe,
  onInspectionStateChange,
  onPickingCancel,
}: ElementInspectorOptions): ElementInspector {
  let enabled = false;
  let frameDocument: Document | null = null;
  let frameWindow: Window | null = null;
  let hoveredInspection: ElementInspection | null = null;
  let activeInspections: ElementInspection[] = [];

  function inspect(element: Element): ElementInspection {
    return {
      element,
      selection: describeElement(element),
      boxModel: readBoxModel(element),
    };
  }

  function emitInspectionState() {
    onInspectionStateChange?.({
      hoveredInspection,
      activeInspections: [...activeInspections],
    });
  }

  function show(element: Element) {
    if (element === hoveredInspection?.element) return;
    hoveredInspection = activeInspections.some((active) => active.element === element)
      ? null
      : inspect(element);
    emitInspectionState();
  }

  function clearHoveredInspection() {
    if (!hoveredInspection) return;
    hoveredInspection = null;
    emitInspectionState();
  }

  function clearActiveSelections() {
    if (activeInspections.length === 0) return;
    activeInspections = [];
    hoveredInspection = null;
    emitInspectionState();
  }

  function handlePointerOver(event: PointerEvent) {
    const element = eventElement(event);
    if (element) show(element);
  }

  function handlePointerOut(event: PointerEvent) {
    if (event.relatedTarget === null) clearHoveredInspection();
  }

  function handleClick(event: MouseEvent) {
    const element = eventElement(event);
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const inspection = inspect(element);
    if (event.ctrlKey || event.metaKey) {
      const activeIndex = activeInspections.findIndex((active) => active.element === element);
      activeInspections = activeIndex >= 0
        ? activeInspections.filter((_, index) => index !== activeIndex)
        : [...activeInspections, inspection];
    } else {
      activeInspections = [inspection];
    }
    hoveredInspection = activeInspections.some((active) => active.element === element)
      ? null
      : inspection;
    emitInspectionState();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setPickingEnabled(false);
    onPickingCancel?.();
  }

  function refresh() {
    if (hoveredInspection) hoveredInspection = inspect(hoveredInspection.element);
    activeInspections = activeInspections.map(({ element }) => inspect(element));
    if (hoveredInspection || activeInspections.length > 0) emitInspectionState();
  }

  function detach() {
    frameDocument?.removeEventListener("pointerover", handlePointerOver, true);
    frameDocument?.removeEventListener("pointerout", handlePointerOut, true);
    frameDocument?.removeEventListener("click", handleClick, true);
    frameDocument?.removeEventListener("keydown", handleKeyDown, true);
    frameWindow?.removeEventListener("scroll", refresh, true);
    frameWindow?.removeEventListener("resize", refresh);
    frameDocument = null;
    frameWindow = null;
    hoveredInspection = null;
    activeInspections = [];
    emitInspectionState();
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
    document.addEventListener("pointerout", handlePointerOut, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
  }

  function setPickingEnabled(nextEnabled: boolean) {
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
    setPickingEnabled,
    refresh,
    confirmActiveSelections() {
      const selections = activeInspections.map(({ selection }) => selection);
      clearActiveSelections();
      return selections;
    },
    destroy() {
      enabled = false;
      detach();
      iframe.removeEventListener("load", handleFrameLoad);
    },
  };
}
