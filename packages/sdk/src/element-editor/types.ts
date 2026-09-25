import type {
  ElementInspection,
  ElementSelection,
} from "../element-inspector/types.ts";

export type ElementEditPropertyKey =
  | "content.text"
  | "form.value"
  | "form.placeholder"
  | "form.checked"
  | "form.disabled"
  | "link.href"
  | "link.target"
  | "media.src"
  | "media.alt"
  | "media.objectFit"
  | "media.backgroundImage"
  | "typography.fontFamily"
  | "typography.fontSize"
  | "typography.fontWeight"
  | "typography.fontStyle"
  | "typography.lineHeight"
  | "typography.textAlign"
  | "typography.color"
  | "size.width"
  | "size.height"
  | "size.aspectRatio"
  | "layout.display"
  | "layout.flexDirection"
  | "layout.justifyContent"
  | "layout.alignItems"
  | "layout.gap"
  | "spacing.marginTop"
  | "spacing.marginRight"
  | "spacing.marginBottom"
  | "spacing.marginLeft"
  | "spacing.paddingTop"
  | "spacing.paddingRight"
  | "spacing.paddingBottom"
  | "spacing.paddingLeft"
  | "appearance.backgroundColor"
  | "appearance.borderColor"
  | "appearance.borderWidth"
  | "appearance.borderStyle"
  | "appearance.borderRadius"
  | "appearance.opacity";

export type ElementEditPropertyId = string;
export type ElementEditPropertyValue = string | number | boolean | null;

export type ElementEditGroup =
  | "content"
  | "form"
  | "link"
  | "media"
  | "typography"
  | "size"
  | "layout"
  | "spacing"
  | "appearance";

export type ElementEditSchema =
  | { kind: "text"; multiline?: boolean; allowEmpty?: boolean }
  | { kind: "url"; allowEmpty?: boolean }
  | { kind: "color" }
  | { kind: "boolean" }
  | { kind: "number"; min?: number; max?: number; step?: number }
  | { kind: "length"; allowKeywords?: boolean }
  | { kind: "choice"; options: ReadonlyArray<string | number> };

export interface ElementEditProperty {
  /** 当前编辑目标中唯一，仅用于 update。 */
  id: ElementEditPropertyId;
  /** 稳定的语义名称，用于 commit 与持久化。 */
  key: ElementEditPropertyKey;
  group: ElementEditGroup;
  value: ElementEditPropertyValue;
  schema: ElementEditSchema;
}

export interface ElementEditChangeInput {
  property: ElementEditPropertyId;
  value: ElementEditPropertyValue;
}

export type ElementEditSubject =
  | { kind: "element" }
  | { kind: "text-node"; path: number[] };

export interface ElementPropertyChange {
  property: ElementEditPropertyKey;
  subject: ElementEditSubject;
  before: ElementEditPropertyValue;
  after: ElementEditPropertyValue;
}

export interface ElementChangeSet {
  target: ElementSelection;
  changes: ElementPropertyChange[];
}

export interface ElementEditorIdleState {
  status: "idle";
  dirty: false;
  properties: [];
}

export interface ElementEditorEditingState {
  status: "editing";
  target: ElementSelection;
  dirty: boolean;
  properties: ElementEditProperty[];
}

export type ElementEditorState = ElementEditorIdleState | ElementEditorEditingState;

export type ElementEditErrorCode =
  | "no-target"
  | "unsupported-property"
  | "invalid-value"
  | "target-disconnected"
  | "apply-failed";

export type ElementEditResult =
  | { ok: true }
  | { ok: false; code: ElementEditErrorCode };

export interface ElementEditor {
  /** 切换目标会取消并恢复上一个目标尚未确认的修改。 */
  setTarget(inspection: ElementInspection | null): void;
  getState(): ElementEditorState;
  /** 在目标 DOM 中即时预览一项修改。 */
  update(change: ElementEditChangeInput): ElementEditResult;
  /** 恢复当前目标在开始编辑前的精确 DOM 状态。 */
  cancel(): void;
  /** 保留当前预览结果，并返回可序列化的语义变更。 */
  commit(): ElementChangeSet | null;
  /** 销毁时会取消尚未确认的修改。 */
  destroy(): void;
}

export interface ElementEditorOptions {
  onStateChange?(state: ElementEditorState): void;
}
