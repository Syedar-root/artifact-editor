import type { ElementInspection } from "../sdk/element-inspector";

export interface ElementInspectorOverlayTheme {
  selection: string;
  marginFill: string;
  marginAccent: string;
  borderFill: string;
  paddingFill: string;
  paddingAccent: string;
  contentFill: string;
  gapFill: string;
  gapAccent: string;
  labelForeground: string;
  measurementBackground: string;
  fontFamily: string;
  cursor: string;
  outlineOffset: number;
  labelGap: number;
  labelHeight: number;
}

export interface ElementInspectorOverlay {
  setActive(active: boolean): void;
  render(inspection: ElementInspection | null): void;
  destroy(): void;
}

export interface ElementInspectorOverlayOptions {
  iframe: HTMLIFrameElement;
  theme: ElementInspectorOverlayTheme;
}
