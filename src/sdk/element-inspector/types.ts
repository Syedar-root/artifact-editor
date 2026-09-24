export interface ElementSelection {
  tagName: string;
  id: string;
  classNames: string[];
  hint: string;
}

export interface ElementInspection {
  element: Element;
  selection: ElementSelection;
  boxModel: ElementBoxModel;
}

export interface ElementInspectionState {
  hoveredInspection: ElementInspection | null;
  activeInspections: ElementInspection[];
}

export interface ElementInspector {
  setPickingEnabled(enabled: boolean): void;
  /** 重新读取当前 hover 与激活元素的几何信息。 */
  refresh(): void;
  /** 确认全部激活选择并清空激活态；没有激活选择时返回空数组。 */
  confirmActiveSelections(): ElementSelection[];
  destroy(): void;
}

export interface ElementInspectorOptions {
  iframe: HTMLIFrameElement;
  /** hover 预览与激活选择任一发生变化时触发。 */
  onInspectionStateChange?(state: ElementInspectionState): void;
  onPickingCancel?(): void;
}

export interface BoxEdges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ElementBoxModel {
  rect: BoxRect;
  margin: BoxEdges;
  border: BoxEdges;
  padding: BoxEdges;
  rowGap: number;
  columnGap: number;
  gapRects: BoxRect[];
}
