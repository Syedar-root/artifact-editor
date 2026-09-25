import assert from "node:assert/strict";
import test from "node:test";
import {
  createArtifactInspectorVitePlugin,
  supportsPreciseSourceLocation,
} from "../src/vite/adapter.js";

test("HTML 使用运行时 hint，不创建源码定位插件", () => {
  let called = false;
  const plugin = createArtifactInspectorVitePlugin({
    technologyStack: "html",
    codeInspectorPlugin() {
      called = true;
    },
  });

  assert.equal(plugin, null);
  assert.equal(called, false);
  assert.equal(supportsPreciseSourceLocation("html"), false);
});

test("React/Vue 通过统一 Adapter 创建源码定位插件", () => {
  let receivedOptions;
  const expectedPlugin = { name: "test-code-inspector" };
  const plugin = createArtifactInspectorVitePlugin({
    technologyStack: "react",
    codeInspectorPlugin(options) {
      receivedOptions = options;
      return expectedPlugin;
    },
  });

  assert.equal(plugin, expectedPlugin);
  assert.equal(supportsPreciseSourceLocation("vue"), true);
  assert.deepEqual(receivedOptions, {
    bundler: "vite",
    hideConsole: true,
    behavior: { locate: false, copy: false },
  });
});
