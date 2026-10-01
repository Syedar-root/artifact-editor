import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(
  new URL("../src/components/ArtifactCreationDialog.tsx", import.meta.url),
  "utf8",
);
const styles = fs.readFileSync(
  new URL("../src/styles/motion.css", import.meta.url),
  "utf8",
);

test("产物创建中的 loading 图标会在整个等待期间持续旋转", () => {
  assert.match(appSource, /<RefreshCw className="spin" size=\{13\} \/>/u);

  const spinRule =
    styles.match(/\.spin\s*\{(?<body>[^}]*)\}/u)?.groups?.body ?? "";
  assert.match(spinRule, /animation\s*:[^;]*\binfinite\b/u);
});
