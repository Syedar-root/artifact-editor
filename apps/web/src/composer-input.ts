export const COMPOSER_MIN_HEIGHT = 76;
export const COMPOSER_MAX_HEIGHT = 192;

export function resizeComposerInput(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  const contentHeight = textarea.scrollHeight;
  const nextHeight = Math.min(
    Math.max(contentHeight, COMPOSER_MIN_HEIGHT),
    COMPOSER_MAX_HEIGHT,
  );
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = contentHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
}
