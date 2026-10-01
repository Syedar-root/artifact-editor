import {
  figmaInspectorTheme,
  type ElementInspectorOverlayTheme,
} from "@artifact-editor/sdk/web/overlay";

export const workbenchInspectorTheme: ElementInspectorOverlayTheme = {
  ...figmaInspectorTheme,
  selection: "#7771cf",
  hoverSelection: "#a5a0de",
  hoverFill: "rgba(119, 113, 207, 0.2)",
  contentFill: "rgba(119, 113, 207, 0.1)",
  marginFill: "rgba(185, 145, 99, 0.5)",
  marginAccent: "#805d38",
  paddingFill: "rgba(105, 151, 134, 0.5)",
  paddingAccent: "#466e5e",
  borderFill: "rgba(119, 113, 207, 0.4)",
  gapFill: "rgba(147, 126, 175, 0.5)",
  gapAccent: "#735b8e",
  measurementBackground: "rgba(255, 255, 255, 0.96)",
  labelForeground: "#555967",
  labelBackground: "#ffffff",
  labelBorder: "#e4e5ed",
  labelRadius: 7,
  labelHeight: 24,
  labelGap: 6,
  selectionWidth: 1.5,
  showBoxModel: true,
  compactLabels: true,
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
};
