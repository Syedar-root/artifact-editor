export interface GapRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GapLayout {
  display: string;
  container: GapRect;
  children: GapRect[];
  rowGap: number;
  columnGap: number;
}

function right(rect: GapRect): number {
  return rect.left + rect.width;
}

function bottom(rect: GapRect): number {
  return rect.top + rect.height;
}

function overlap(startA: number, endA: number, startB: number, endB: number): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

export function calculateGapRects({
  display,
  container,
  children,
  rowGap,
  columnGap,
}: GapLayout): GapRect[] {
  if (rowGap <= 0 && columnGap <= 0) return [];
  const gaps = new Map<string, GapRect>();
  const isGrid = display.includes("grid");

  for (let leftIndex = 0; leftIndex < children.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < children.length; rightIndex += 1) {
      const first = children[leftIndex];
      const second = children[rightIndex];
      const horizontalOverlap = overlap(first.left, right(first), second.left, right(second));
      const verticalOverlap = overlap(first.top, bottom(first), second.top, bottom(second));

      const horizontalSpace = Math.max(second.left - right(first), first.left - right(second));
      if (columnGap > 0 && verticalOverlap > 0 && Math.abs(horizontalSpace - columnGap) <= 2) {
        const gap = {
          left: Math.min(right(first), right(second)),
          top: isGrid ? container.top : Math.max(first.top, second.top),
          width: horizontalSpace,
          height: isGrid ? container.height : verticalOverlap,
        };
        gaps.set(`${gap.left}:${gap.top}:${gap.width}:${gap.height}`, gap);
      }

      const verticalSpace = Math.max(second.top - bottom(first), first.top - bottom(second));
      if (rowGap > 0 && horizontalOverlap > 0 && Math.abs(verticalSpace - rowGap) <= 2) {
        const gap = {
          left: isGrid ? container.left : Math.max(first.left, second.left),
          top: Math.min(bottom(first), bottom(second)),
          width: isGrid ? container.width : horizontalOverlap,
          height: verticalSpace,
        };
        gaps.set(`${gap.left}:${gap.top}:${gap.width}:${gap.height}`, gap);
      }
    }
  }

  return Array.from(gaps.values());
}
