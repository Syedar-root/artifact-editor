import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  resizeComposerInput,
} from "../src/composer-input.ts";

function textareaWithHeight(scrollHeight) {
  return {
    scrollHeight,
    style: {
      height: "",
      overflowY: "",
    },
  };
}

test("composer 默认保持舒适的输入高度", () => {
  const textarea = textareaWithHeight(32);
  resizeComposerInput(textarea);
  assert.equal(textarea.style.height, `${COMPOSER_MIN_HEIGHT}px`);
  assert.equal(textarea.style.overflowY, "hidden");
});

test("composer 随内容增长，并在达到上限后开启内部滚动", () => {
  const growingTextarea = textareaWithHeight(136);
  resizeComposerInput(growingTextarea);
  assert.equal(growingTextarea.style.height, "136px");
  assert.equal(growingTextarea.style.overflowY, "hidden");

  const overflowingTextarea = textareaWithHeight(280);
  resizeComposerInput(overflowingTextarea);
  assert.equal(overflowingTextarea.style.height, `${COMPOSER_MAX_HEIGHT}px`);
  assert.equal(overflowingTextarea.style.overflowY, "auto");
});
