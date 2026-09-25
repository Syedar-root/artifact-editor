const PRECISE_SOURCE_STACKS = new Set(["react", "vue"]);

export function supportsPreciseSourceLocation(technologyStack) {
  return PRECISE_SOURCE_STACKS.has(technologyStack);
}

/**
 * 将第三方框架定位器适配为产物编辑器统一的 Vite 插件。
 * codeInspectorPlugin 由宿主项目注入，SDK 不强制 HTML 项目安装它。
 */
export function createArtifactInspectorVitePlugin({
  technologyStack,
  codeInspectorPlugin,
}) {
  if (!supportsPreciseSourceLocation(technologyStack)) return null;
  if (typeof codeInspectorPlugin !== "function") return null;

  return codeInspectorPlugin({
    bundler: "vite",
    hideConsole: true,
    behavior: { locate: false, copy: false },
  });
}
