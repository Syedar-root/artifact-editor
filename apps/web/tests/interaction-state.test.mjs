import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const draftsSource = fs.readFileSync(
  new URL("../src/hooks/use-element-drafts.ts", import.meta.url),
  "utf8",
);
const previewSource = fs.readFileSync(
  new URL("../src/components/PreviewPanel.tsx", import.meta.url),
  "utf8",
);
const checkpointSource = fs.readFileSync(
  new URL("../src/components/CheckpointSwitcher.tsx", import.meta.url),
  "utf8",
);

test("保存元素草稿不会退出页面编辑模式，只有 Apply 到对话才退出", () => {
  const saveDraftHandler = draftsSource.slice(
    draftsSource.indexOf("function closeElementEditor"),
    draftsSource.indexOf("function resolveSelectedElement"),
  );
  const applyToComposerHandler = draftsSource.slice(
    draftsSource.indexOf("function applySelectionListToComposer"),
    draftsSource.indexOf("function closeElementEditor"),
  );
  const clearDraftsHandler = previewSource.slice(
    previewSource.indexOf('className="element-selection-tray-heading"'),
    previewSource.indexOf('className="element-selection-tray-list"'),
  );

  assert.doesNotMatch(saveDraftHandler, /setIsElementPicking\(false\)/u);
  assert.doesNotMatch(clearDraftsHandler, /setIsElementPicking\(false\)/u);
  assert.match(applyToComposerHandler, /setIsElementPicking\(false\)/u);
});

test("Checkpoint selector 在焦点离开或点击外部时收起", () => {
  assert.match(checkpointSource, /ref=\{checkpointMenuRef\}/u);
  assert.match(checkpointSource, /onBlur=\{closeCheckpointMenuOnBlur\}/u);
  assert.match(
    checkpointSource,
    /document\.addEventListener\(\s*"pointerdown",\s*closeCheckpointMenuOnOutsidePointer\s*,?\s*\)/u,
  );
});
