export interface EditorTargetRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ElementEditorPositionInput {
  iframeLeft: number;
  iframeTop: number;
  iframeWidth: number;
  iframeHeight: number;
  propertyCount: number;
  target: EditorTargetRect;
}

export interface ElementEditorPosition {
  left: number;
  top: number;
  placement: "above" | "below";
  maxHeight?: number;
}

export function calculateElementEditorPosition({
  iframeLeft,
  iframeTop,
  iframeWidth,
  iframeHeight,
  propertyCount,
  target,
}: ElementEditorPositionInput): ElementEditorPosition {
  const viewportMargin = 8;
  const anchorGap = 10;
  const popoverWidth = Math.min(348, Math.max(0, iframeWidth - viewportMargin * 2));
  const halfPopoverWidth = popoverWidth / 2;
  const minimumLeft = iframeLeft + viewportMargin + halfPopoverWidth;
  const maximumLeft = iframeLeft + iframeWidth - viewportMargin - halfPopoverWidth;
  const left = Math.min(
    Math.max(minimumLeft, iframeLeft + target.left + target.width / 2),
    maximumLeft,
  );

  const previewTop = iframeTop + viewportMargin;
  const previewBottom = iframeTop + iframeHeight - viewportMargin;
  const targetTop = iframeTop + target.top;
  const targetBottom = targetTop + target.height;
  const spaceAbove = Math.max(0, targetTop - anchorGap - previewTop);
  const spaceBelow = Math.max(0, previewBottom - targetBottom - anchorGap);
  const estimatedHeight = Math.min(500, 170 + propertyCount * 34);
  const placement = spaceBelow >= estimatedHeight || spaceBelow >= spaceAbove
    ? "below"
    : "above";
  return {
    placement,
    left,
    top: placement === "above" ? targetTop - anchorGap : targetBottom + anchorGap,
    maxHeight: Math.floor(placement === "above" ? spaceAbove : spaceBelow),
  };
}
