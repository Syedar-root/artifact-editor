import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("保存元素草稿不会退出页面编辑模式，只有 Apply 到对话才退出", () => {
  const saveDraftHandler = appSource.slice(
    appSource.indexOf("function closeElementEditor"),
    appSource.indexOf("function resolveSelectedElement"),
  );
  const applyToComposerHandler = appSource.slice(
    appSource.indexOf("function applySelectionListToComposer"),
    appSource.indexOf("function closeElementEditor"),
  );
  const clearDraftsHandler = appSource.slice(
    appSource.indexOf('className="element-selection-tray-heading"'),
    appSource.indexOf('className="element-selection-tray-list"'),
  );

  assert.doesNotMatch(saveDraftHandler, /setIsElementPicking\(false\)/u);
  assert.doesNotMatch(clearDraftsHandler, /setIsElementPicking\(false\)/u);
  assert.match(applyToComposerHandler, /setIsElementPicking\(false\)/u);
});

test("Checkpoint selector 在焦点离开或点击外部时收起", () => {
  assert.match(appSource, /ref=\{checkpointMenuRef\}/u);
  assert.match(appSource, /onBlur=\{closeCheckpointMenuOnBlur\}/u);
  assert.match(appSource, /document\.addEventListener\("pointerdown", closeCheckpointMenuOnOutsidePointer\)/u);
});
