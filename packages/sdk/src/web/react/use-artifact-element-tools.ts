import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { createElementEditor } from "../element-editor/index.ts";
import type {
  ElementChangeSet,
  ElementEditPropertyId,
  ElementEditPropertyValue,
  ElementEditResult,
  ElementEditor,
  ElementEditorState,
} from "../element-editor/index.ts";
import { createElementInspector } from "../element-inspector/index.ts";
import type {
  ElementInspection,
  ElementInspector,
  ElementSelection,
} from "../element-inspector/index.ts";
import {
  createElementInspectorOverlay,
  figmaInspectorTheme,
} from "../element-inspector-overlay/index.ts";
import type {
  ElementInspectorOverlay,
  ElementInspectorOverlayTheme,
} from "../element-inspector-overlay/index.ts";

const EMPTY_EDITOR_STATE: ElementEditorState = {
  status: "idle",
  dirty: false,
  properties: [],
};

export interface UseArtifactElementToolsOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  enabled: boolean;
  pickingEnabled: boolean;
  /** 预览内容变化时传入一个新值，用于重建绑定。 */
  revision?: string | number;
  theme?: ElementInspectorOverlayTheme;
  onPickingCancel?(): void;
}

export interface ArtifactElementTools {
  activeElements: ElementInspection[];
  editorState: ElementEditorState;
  selectElement(element: Element): void;
  confirmSelections(): ElementSelection[];
  updateProperty(
    property: ElementEditPropertyId,
    value: ElementEditPropertyValue,
  ): ElementEditResult | undefined;
  commitEdits(): ElementChangeSet | null;
  cancelEdits(): void;
  refresh(): void;
}

export function useArtifactElementTools({
  iframeRef,
  enabled,
  pickingEnabled,
  revision,
  theme = figmaInspectorTheme,
  onPickingCancel,
}: UseArtifactElementToolsOptions): ArtifactElementTools {
  const [activeElements, setActiveElements] = useState<ElementInspection[]>([]);
  const [editorState, setEditorState] = useState<ElementEditorState>(EMPTY_EDITOR_STATE);
  const inspectorRef = useRef<ElementInspector | null>(null);
  const overlayRef = useRef<ElementInspectorOverlay | null>(null);
  const editorRef = useRef<ElementEditor | null>(null);
  const editedElementRef = useRef<Element | null>(null);
  const onPickingCancelRef = useRef(onPickingCancel);

  useEffect(() => {
    onPickingCancelRef.current = onPickingCancel;
  }, [onPickingCancel]);

  useEffect(() => {
    if (!enabled) return undefined;
    const iframe = iframeRef.current;
    if (!iframe) return undefined;

    const overlay = createElementInspectorOverlay({ iframe, theme });
    const editor = createElementEditor({ onStateChange: setEditorState });
    const inspector = createElementInspector({
      iframe,
      onInspectionStateChange(state) {
        overlay.render(state);
        setActiveElements(state.activeInspections);
        const nextTarget = state.activeInspections.length === 1
          ? state.activeInspections[0]
          : null;
        if (editedElementRef.current !== (nextTarget?.element ?? null)) {
          editor.setTarget(nextTarget);
          editedElementRef.current = nextTarget?.element ?? null;
        }
      },
      onPickingCancel() {
        onPickingCancelRef.current?.();
      },
    });

    inspectorRef.current = inspector;
    overlayRef.current = overlay;
    editorRef.current = editor;

    return () => {
      inspector.destroy();
      overlay.destroy();
      editor.destroy();
      if (inspectorRef.current === inspector) inspectorRef.current = null;
      if (overlayRef.current === overlay) overlayRef.current = null;
      if (editorRef.current === editor) editorRef.current = null;
      editedElementRef.current = null;
      setActiveElements([]);
      setEditorState(EMPTY_EDITOR_STATE);
    };
  }, [enabled, iframeRef, revision, theme]);

  useEffect(() => {
    const active = enabled && pickingEnabled;
    overlayRef.current?.setActive(active);
    inspectorRef.current?.setPickingEnabled(active);
  }, [enabled, pickingEnabled, revision]);

  const confirmSelections = useCallback(() => {
    return inspectorRef.current?.confirmActiveSelections() ?? [];
  }, []);

  const selectElement = useCallback((element: Element) => {
    inspectorRef.current?.selectElement(element);
  }, []);

  const updateProperty = useCallback((
    property: ElementEditPropertyId,
    value: ElementEditPropertyValue,
  ) => {
    const result = editorRef.current?.update({ property, value });
    if (result?.ok) inspectorRef.current?.refresh();
    return result;
  }, []);

  const commitEdits = useCallback(() => {
    const changeSet = editorRef.current?.commit() ?? null;
    editedElementRef.current = null;
    inspectorRef.current?.confirmActiveSelections();
    return changeSet;
  }, []);

  const cancelEdits = useCallback(() => {
    editorRef.current?.cancel();
    editedElementRef.current = null;
    inspectorRef.current?.confirmActiveSelections();
  }, []);

  const refresh = useCallback(() => {
    inspectorRef.current?.refresh();
  }, []);

  return {
    activeElements,
    editorState,
    selectElement,
    confirmSelections,
    updateProperty,
    commitEdits,
    cancelEdits,
    refresh,
  };
}
