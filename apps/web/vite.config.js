import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sdkSourceRoot = fileURLToPath(
  new URL("../../packages/sdk/src", import.meta.url),
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@artifact-editor/sdk/web/react": path.join(
        sdkSourceRoot,
        "web/react/index.ts",
      ),
      "@artifact-editor/sdk/web/overlay": path.join(
        sdkSourceRoot,
        "web/element-inspector-overlay/index.ts",
      ),
      "@artifact-editor/sdk/web/element-inspector": path.join(
        sdkSourceRoot,
        "web/element-inspector/index.ts",
      ),
      "@artifact-editor/sdk/web/element-editor": path.join(
        sdkSourceRoot,
        "web/element-editor/index.ts",
      ),
      "@artifact-editor/sdk/web": path.join(sdkSourceRoot, "web/index.ts"),
    },
  },
  server: {
    proxy: {
      "/published": { target: "http://127.0.0.1:4174", changeOrigin: true },
      "/absproxy": {
        target: "http://127.0.0.1:4174",
        changeOrigin: true,
        ws: true,
      },
      "/api": {
        target: "http://127.0.0.1:4174",
        changeOrigin: true,
      },
      "/proxy": {
        target: "http://127.0.0.1:4174",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
