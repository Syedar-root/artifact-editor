import { useState, useRef, useEffect } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export const DEFAULT_CHAT_WIDTH = 420;

export const MIN_CHAT_WIDTH = 320;

export const MAX_CHAT_WIDTH = 640;

export const MIN_PREVIEW_WIDTH = 560;

export const RAIL_WIDTH = 220;

export const RESIZER_WIDTH = 7;

function chatWidthLimit(workspaceWidth: number) {
  const compact = window.matchMedia("(max-width: 1200px)").matches;
  const railWidth = compact ? 0 : RAIL_WIDTH;
  const previewWidth = compact ? 320 : MIN_PREVIEW_WIDTH;
  return Math.max(
    MIN_CHAT_WIDTH,
    Math.min(MAX_CHAT_WIDTH, workspaceWidth - railWidth - RESIZER_WIDTH - previewWidth),
  );
}

export function usePanelResize() {
  const [chatWidth, setChatWidth] = useState(() => {
    const savedWidth = Number(
      window.localStorage.getItem("artifact-chat-width"),
    );
    return Number.isFinite(savedWidth) && savedWidth >= MIN_CHAT_WIDTH
      ? Math.min(savedWidth, MAX_CHAT_WIDTH)
      : DEFAULT_CHAT_WIDTH;
  });

  const [isResizing, setIsResizing] = useState(false);

  const workspaceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    window.localStorage.setItem("artifact-chat-width", String(chatWidth));
  }, [chatWidth]);

  useEffect(() => {
    if (!isResizing) return undefined;

    document.body.classList.add("is-resizing-panels");
    const handlePointerMove = (event: PointerEvent) => {
      const bounds = workspaceRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const railWidth = window.matchMedia("(max-width: 1200px)").matches ? 0 : RAIL_WIDTH;
      const availableMax = chatWidthLimit(bounds.width);
      const nextWidth = event.clientX - bounds.left - railWidth;
      setChatWidth(
        Math.min(
          Math.max(nextWidth, MIN_CHAT_WIDTH),
          availableMax,
        ),
      );
    };
    const stopResizing = () => setIsResizing(false);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing, { once: true });
    window.addEventListener("pointercancel", stopResizing, { once: true });

    return () => {
      document.body.classList.remove("is-resizing-panels");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [isResizing]);

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const availableMax = chatWidthLimit(workspaceRef.current?.clientWidth ?? window.innerWidth);
    if (event.key === "Home") return setChatWidth(MIN_CHAT_WIDTH);
    if (event.key === "End") return setChatWidth(availableMax);
    setChatWidth((current) =>
      Math.min(
        availableMax,
        Math.max(
          MIN_CHAT_WIDTH,
          current + (event.key === "ArrowRight" ? 24 : -24),
        ),
      ),
    );
  }

  return {
    chatWidth,
    setChatWidth,
    isResizing,
    setIsResizing,
    workspaceRef,
    resizeWithKeyboard,
  };
}
