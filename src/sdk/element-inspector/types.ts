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

export interface ElementInspector {
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

export interface ElementInspectorOptions {
  iframe: HTMLIFrameElement;
  onSelect(selection: ElementSelection): void;
  onInspect?(inspection: ElementInspection | null): void;
  onCancel?(): void;
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
