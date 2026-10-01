import type { MessageElementAttachment } from "./types";
import type {
  ElementChangeSet,
  ElementPropertyChange,
} from "@artifact-editor/sdk/web/element-editor";
import type {
  ElementInspection,
  ElementSelection,
} from "@artifact-editor/sdk/web/element-inspector";

export interface SelectedElementItem extends ElementSelection {
  key: number;
  element?: Element;
  comment?: string;
  changes?: ElementChangeSet["changes"];
}

export type ElementEditTarget =
  | { kind: "preview-selection" }
  | { kind: "queue-item"; key: number; element: SelectedElementItem };

export function editingQueueItem(
  element: SelectedElementItem,
): ElementEditTarget {
  return { kind: "queue-item", key: element.key, element };
}

function sameSelection(
  inspection: ElementInspection,
  queued: SelectedElementItem,
): boolean {
  if (queued.element === inspection.element) return true;
  if (queued.element?.isConnected) return false;
  if (queued.source && inspection.selection.source) {
    return (
      queued.source.file === inspection.selection.source.file &&
      queued.source.line === inspection.selection.source.line &&
      queued.source.column === inspection.selection.source.column
    );
  }
  return queued.domHint.path === inspection.selection.domHint.path;
}

export function editingTargetForSelection(
  inspection: ElementInspection,
  elements: SelectedElementItem[],
): ElementEditTarget {
  const existing = elements.find((element) =>
    sameSelection(inspection, element),
  );
  return existing ? editingQueueItem(existing) : { kind: "preview-selection" };
}

function subjectKey(change: ElementPropertyChange): string {
  return change.subject.kind === "element"
    ? `${change.property}:element`
    : `${change.property}:text-node:${change.subject.path.join(".")}`;
}

function mergeChanges(
  previous: ElementPropertyChange[] | undefined,
  current: ElementPropertyChange[] | undefined,
): ElementPropertyChange[] | undefined {
  const merged = new Map<string, ElementPropertyChange>();
  for (const change of previous ?? []) merged.set(subjectKey(change), change);
  for (const change of current ?? []) {
    const key = subjectKey(change);
    const earlier = merged.get(key);
    const next = earlier ? { ...change, before: earlier.before } : change;
    if (Object.is(next.before, next.after)) merged.delete(key);
    else merged.set(key, next);
  }
  return merged.size > 0 ? [...merged.values()] : undefined;
}

export function mergeEditedElement(
  elements: SelectedElementItem[],
  target: ElementEditTarget,
  edited: SelectedElementItem,
): SelectedElementItem[] {
  if (target.kind === "preview-selection") return [...elements, edited];

  return elements.map((element) => {
    if (element.key !== target.key) return element;
    const {
      comment: _previousComment,
      changes: previousChanges,
      ...previousIdentity
    } = element;
    const { comment, changes: currentChanges, ...currentIdentity } = edited;
    const changes = mergeChanges(previousChanges, currentChanges);
    return {
      ...previousIdentity,
      ...currentIdentity,
      key: element.key,
      ...(comment ? { comment } : {}),
      ...(changes ? { changes } : {}),
    };
  });
}

export const DEFAULT_ELEMENT_PROMPT =
  "请结合这些元素的评论和已应用修改统一调整页面，并保持整体视觉风格一致。";

export function toMessageElementAttachment(
  element: SelectedElementItem,
): MessageElementAttachment {
  return {
    tagName: element.tagName,
    id: element.id,
    classNames: element.classNames,
    hint: element.hint,
    domHint: element.domHint,
    source: element.source,
    comment: element.comment,
    changes: element.changes,
  };
}
