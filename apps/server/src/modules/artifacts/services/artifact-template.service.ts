import { Injectable } from "@nestjs/common";
import type { TechnologyStack, LocatorMode } from "../models/artifact.model.js";

/** 生成产物源码和 Vite 配置；没有远程执行或文件系统副作用。 */
@Injectable()
export class ArtifactTemplateService {
  files(
    id: string,
    name: string,
    requestedStack: TechnologyStack,
  ): Record<string, string> {
    const packageJson = {
      name: id,
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: { dev: "vite", build: "vite build" },
      dependencies:
        requestedStack === "react"
          ? { react: "latest", "react-dom": "latest" }
          : requestedStack === "vue"
            ? { vue: "latest" }
            : {},
      devDependencies: {
        vite: "latest",
        ...(requestedStack === "react"
          ? {
              "@vitejs/plugin-react": "latest",
              "code-inspector-plugin": "latest",
            }
          : {}),
        ...(requestedStack === "vue"
          ? {
              "@vitejs/plugin-vue": "latest",
              "code-inspector-plugin": "latest",
            }
          : {}),
      },
    };

    const cleanName = name.replace(/[<>&"]/g, "");
    const entryFile =
      requestedStack === "react" ? "/src/main.jsx" : "/src/main.js";
    const indexHtml = [
      "<!doctype html>",
      '<html lang="zh-CN">',
      "  <head>",
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      "    <title>" + cleanName + "</title>",
      "  </head>",
      "  <body>",
      '    <main id="app">',
      ...(requestedStack === "html"
        ? [
            '      <section class="hero">',
            '        <span class="eyebrow">NEW ARTIFACT</span>',
            "        <h1>" + cleanName + "</h1>",
            "        <p>这个产物已经准备好，可以通过对话或代码继续编辑。</p>",
            "      </section>",
          ]
        : []),
      "    </main>",
      '    <script type="module" src="' + entryFile + '"></script>',
      "  </body>",
      "</html>",
      "",
    ].join("\n");

    const htmlMain = ['import "./style.css";', ""].join("\n");
    const reactMain = [
      'import React from "react";',
      'import { createRoot } from "react-dom/client";',
      'import "./style.css";',
      "",
      "function App() {",
      "  return (",
      '    <section className="hero">',
      '      <span className="eyebrow">NEW ARTIFACT</span>',
      "      <h1>" + JSON.stringify(cleanName) + "</h1>",
      "      <p>这个产物已经准备好，可以通过对话或代码继续编辑。</p>",
      "    </section>",
      "  );",
      "}",
      "",
      'createRoot(document.querySelector("#app")).render(<App />);',
      "",
    ].join("\n");
    const vueMain = [
      'import { createApp } from "vue";',
      'import App from "./App.vue";',
      'import "./style.css";',
      "",
      'createApp(App).mount("#app");',
      "",
    ].join("\n");
    const vueApp = [
      "<template>",
      '  <section class="hero">',
      '    <span class="eyebrow">NEW ARTIFACT</span>',
      "    <h1>" + cleanName + "</h1>",
      "    <p>这个产物已经准备好，可以通过对话或代码继续编辑。</p>",
      "  </section>",
      "</template>",
      "",
    ].join("\n");

    const styleCss = [
      ":root { font-family: Inter, system-ui, sans-serif; color: #20201f; background: #f4f1ea; }",
      "* { box-sizing: border-box; }",
      "body { margin: 0; min-width: 320px; min-height: 100vh; }",
      ".hero { min-height: 100vh; display: grid; align-content: center; justify-items: center; gap: 18px; padding: 48px; text-align: center; }",
      ".eyebrow { color: #77736b; font-size: 12px; font-weight: 700; letter-spacing: .16em; }",
      "h1 { margin: 0; font-size: clamp(42px, 8vw, 92px); letter-spacing: -.06em; }",
      "p { max-width: 560px; margin: 0; color: #68645d; font-size: 18px; line-height: 1.7; }",
      "",
    ].join("\n");

    const viteConfig = [
      'import { defineConfig } from "vite";',
      ...(requestedStack === "react"
        ? ['import react from "@vitejs/plugin-react";']
        : []),
      ...(requestedStack === "vue"
        ? ['import vue from "@vitejs/plugin-vue";']
        : []),
      "",
      "export default defineConfig({",
      "  resolve: { preserveSymlinks: true },",
      "  plugins: [" +
        (requestedStack === "react"
          ? "react()"
          : requestedStack === "vue"
            ? "vue()"
            : "") +
        "],",
      "});",
      "",
    ].join("\n");
    return {
      "package.json": JSON.stringify(packageJson, null, 2) + "\n",
      "vite.config.mjs": viteConfig,
      "index.html": indexHtml,
      ["src/" + (requestedStack === "react" ? "main.jsx" : "main.js")]:
        requestedStack === "react"
          ? reactMain
          : requestedStack === "vue"
            ? vueMain
            : htmlMain,
      ...(requestedStack === "vue" ? { "src/App.vue": vueApp } : {}),
      "src/style.css": styleCss,
      ".gitignore": ["node_modules", "dist/", ".vite/", ".artifact/", ""].join(
        "\n",
      ),
    };
  }

  preview(technologyStack: TechnologyStack, locatorMode: LocatorMode): string {
    const imports = [
      'import { defineConfig } from "vite";',
      'import { fileURLToPath } from "node:url";',
      'import { createArtifactInspectorVitePlugin } from "./artifact-editor-sdk-vite.mjs";',
      ...(technologyStack === "react"
        ? ['import react from "@vitejs/plugin-react";']
        : []),
      ...(technologyStack === "vue"
        ? ['import vue from "@vitejs/plugin-vue";']
        : []),
      ...(locatorMode === "code-inspector"
        ? ['import { codeInspectorPlugin } from "code-inspector-plugin";']
        : []),
      "",
    ];
    const plugins = [
      ...(locatorMode === "code-inspector"
        ? [
            "  createArtifactInspectorVitePlugin({",
            "    technologyStack,",
            "    codeInspectorPlugin,",
            "  }),",
          ]
        : []),
      ...(technologyStack === "react" ? ["  react(),"] : []),
      ...(technologyStack === "vue" ? ["  vue(),"] : []),
    ];
    const config = [
      ...imports,
      'const root = fileURLToPath(new URL("..", import.meta.url));',
      "const previewPort = Number(process.env.ARTIFACT_PREVIEW_PORT);",
      "const technologyStack = " + JSON.stringify(technologyStack) + ";",
      'const proxyBase = "/absproxy/" + previewPort + "/";',
      "",
      "export default defineConfig({",
      "  root,",
      "  base: proxyBase,",
      "  resolve: { preserveSymlinks: true },",
      "  plugins: [",
      ...plugins,
      "  ],",
      '  server: { host: "0.0.0.0", port: previewPort, strictPort: true },',
      "});",
      "",
    ].join("\n");
    return config;
  }
}
