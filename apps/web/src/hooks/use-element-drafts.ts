import { useState, useRef, useLayoutEffect, useEffect } from "react";
import type {
  SelectedElementItem,
  ElementEditTarget,
} from "../element-edit-workflow";
import { useArtifactElementTools } from "@artifact-editor/sdk/web/react";
import { resizeComposerInput } from "../composer-input";
import {
  editingTargetForSelection,
  DEFAULT_ELEMENT_PROMPT,
  mergeEditedElement,
  editingQueueItem,
} from "../element-edit-workflow";
import type { ElementSelection } from "@artifact-editor/sdk/web/element-inspector";
import type {
  ElementChangeSet,
  ElementEditPropertyId,
  ElementEditPropertyValue,
} from "@artifact-editor/sdk/web/element-editor";
import type { CSSProperties } from "react";
import { calculateElementEditorPosition } from "../element-editor-position";
import { workbenchInspectorTheme } from "../element-inspector-theme";

export function useElementDrafts({
  view,
  previewKey,
}: {
  view: "preview" | "code";
  previewKey: number;
}) {
  const [input, setInput] = useState("");

  const [isElementPicking, setIsElementPicking] = useState(false);

  const [selectedElements, setSelectedElements] = useState<
    SelectedElementItem[]
  >([]);

  const [composerElements, setComposerElements] = useState<
    SelectedElementItem[]
  >([]);

  const [elementEditTarget, setElementEditTarget] =
    useState<ElementEditTarget | null>(null);

  const composerInputRef = useRef<HTMLTextAreaElement>(null);

  const previewIframeRef = useRef<HTMLIFrameElement>(null);

  const selectedElementKeyRef = useRef(0);

  const elementTools = useArtifactElementTools({
    iframeRef: previewIframeRef,
    enabled: view === "preview",
    pickingEnabled: isElementPicking,
    revision: previewKey,
    theme: workbenchInspectorTheme,
    onPickingCancel: () => setIsElementPicking(false),
  });

  const { activeElements, editorState: elementEditorState } = elementTools;

  useLayoutEffect(() => {
    if (composerInputRef.current) resizeComposerInput(composerInputRef.current);
  }, [input]);

  useEffect(() => {
    if (activeElements.length !== 1) {
      setElementEditTarget(null);
      return;
    }
    const next = editingTargetForSelection(activeElements[0], selectedElements);
    setElementEditTarget((current) => {
      if (
        current?.kind === "queue-item" &&
        next.kind === "queue-item" &&
        current.key === next.key
      ) {
        return current;
      }
      if (
        current?.kind === "preview-selection" &&
        next.kind === "preview-selection"
      ) {
        return current;
      }
      return next;
    });
  }, [activeElements, selectedElements]);

  function createSelectedElementItem(
    selection: ElementSelection,
    element?: Element,
    comment?: string,
    changes?: ElementChangeSet["changes"],
  ): SelectedElementItem {
    selectedElementKeyRef.current += 1;
    return {
      ...selection,
      key: selectedElementKeyRef.current,
      ...(element ? { element } : {}),
      ...(comment ? { comment } : {}),
      ...(changes && changes.length > 0 ? { changes } : {}),
    };
  }

  function applySelectionListToComposer() {
    if (selectedElements.length === 0) return;
    const shouldUseDefaultPrompt = input.trim().length === 0;
    if (elementEditTarget) elementTools.cancelEdits();
    setComposerElements((current) => [...current, ...selectedElements]);
    setSelectedElements([]);
    setElementEditTarget(null);
    setIsElementPicking(false);
    if (shouldUseDefaultPrompt) setInput(DEFAULT_ELEMENT_PROMPT);
    window.requestAnimationFrame(() => {
      const textarea = composerInputRef.current;
      if (!textarea) return;
      textarea.focus();
      if (shouldUseDefaultPrompt) textarea.select();
    });
  }

  function closeElementEditor(commit: boolean, comment = "") {
    if (!commit) {
      elementTools.cancelEdits();
      setElementEditTarget(null);
      return;
    }

    const inspection = activeElements.length === 1 ? activeElements[0] : null;
    const target = elementEditTarget;
    const changeSet = elementTools.commitEdits();
    if (!inspection || !target) return;
    const item = createSelectedElementItem(
      changeSet?.target ?? inspection.selection,
      inspection.element,
      comment,
      changeSet?.changes,
    );
    setSelectedElements((current) => mergeEditedElement(current, target, item));
    setElementEditTarget(null);
  }

  function resolveSelectedElement(item: SelectedElementItem): Element | null {
    if (item.element?.isConnected) return item.element;
    const document = previewIframeRef.current?.contentDocument;
    if (!document) return null;
    if (item.source) {
      const prefix = `${item.source.file}:${item.source.line}:${item.source.column}:`;
      const sourceMatch = Array.from(
        document.querySelectorAll("[data-insp-path]"),
      ).find((element) =>
        element.getAttribute("data-insp-path")?.startsWith(prefix),
      );
      if (sourceMatch) return sourceMatch;
    }
    if (item.id) {
      const idMatch = document.getElementById(item.id);
      if (idMatch) return idMatch;
    }
    return (
      Array.from(document.getElementsByTagName(item.tagName)).find((element) =>
        item.classNames.every((className) =>
          element.classList.contains(className),
        ),
      ) ?? null
    );
  }

  function editSelectedElement(item: SelectedElementItem) {
    const element = resolveSelectedElement(item);
    if (!element) return;
    element.scrollIntoView({ block: "center", inline: "center" });
    setIsElementPicking(true);
    setElementEditTarget(editingQueueItem(item));
    elementTools.selectElement(element);
  }

  function updateElementEditor(
    property: ElementEditPropertyId,
    value: ElementEditPropertyValue,
  ) {
    elementTools.updateProperty(property, value);
  }

  function elementEditorPosition(): {
    position: CSSProperties;
    placement: "above" | "below";
  } | null {
    if (elementEditorState.status !== "editing" || activeElements.length !== 1)
      return null;
    const iframe = previewIframeRef.current;
    if (!iframe) return null;
    const calculated = calculateElementEditorPosition({
      iframeLeft: iframe.offsetLeft,
      iframeTop: iframe.offsetTop,
      iframeWidth: iframe.clientWidth,
      iframeHeight: iframe.clientHeight,
      propertyCount: elementEditorState.properties.length,
      target: activeElements[0].boxModel.rect,
    });
    return {
      placement: calculated.placement,
      position: {
        left: calculated.left,
        top: calculated.top,
        maxHeight: Math.min(calculated.maxHeight ?? 480, 480),
      },
    };
  }

  function stopEditing() {
    elementTools.cancelEdits();
    setIsElementPicking(false);
    setElementEditTarget(null);
  }

  function reset() {
    stopEditing();
    setSelectedElements([]);
    setComposerElements([]);
  }

  function togglePicking() {
    if (isElementPicking) elementTools.cancelEdits();
    setElementEditTarget(null);
    setIsElementPicking((current) => !current);
  }

  function clearDrafts() {
    if (elementEditTarget) elementTools.cancelEdits();
    setSelectedElements([]);
    setElementEditTarget(null);
  }

  function removeDraft(key: number) {
    setSelectedElements((current) =>
      current.filter((item) => item.key !== key),
    );
    if (
      elementEditTarget?.kind === "queue-item" &&
      elementEditTarget.key === key
    ) {
      elementTools.cancelEdits();
      setElementEditTarget(null);
    }
  }
  return {
    stopEditing,
    reset,
    togglePicking,
    clearDrafts,
    removeDraft,
    input,
    setInput,
    isElementPicking,
    selectedElements,
    composerElements,
    setComposerElements,
    elementEditTarget,
    composerInputRef,
    previewIframeRef,
    elementEditorState,
    applySelectionListToComposer,
    closeElementEditor,
    editSelectedElement,
    updateElementEditor,
    elementEditorPosition,
  };
}
