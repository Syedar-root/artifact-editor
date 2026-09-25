import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import webConfig from "../vite.config.js";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdkSourceRoot = path.resolve(webRoot, "../../packages/sdk/src");

test("Web 开发模式不依赖预先生成的 SDK dist", async () => {
  assert.equal(
    webConfig.resolve?.alias?.["@artifact-editor/sdk/react"],
    path.join(sdkSourceRoot, "react/index.ts"),
  );

  const result = await build({
    ...webConfig,
    build: { write: false },
    configFile: false,
    logLevel: "silent",
    root: webRoot,
  });
  assert.ok(result);
});
