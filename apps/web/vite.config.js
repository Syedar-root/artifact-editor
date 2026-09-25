import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sdkSourceRoot = fileURLToPath(new URL("../../packages/sdk/src", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@artifact-editor/sdk/react": path.join(sdkSourceRoot, "react/index.ts"),
      "@artifact-editor/sdk/overlay": path.join(
        sdkSourceRoot,
        "element-inspector-overlay/index.ts",
      ),
      "@artifact-editor/sdk/element-inspector": path.join(
        sdkSourceRoot,
        "element-inspector/index.ts",
      ),
      "@artifact-editor/sdk/element-editor": path.join(
        sdkSourceRoot,
        "element-editor/index.ts",
      ),
      "@artifact-editor/sdk": path.join(sdkSourceRoot, "index.ts"),
    },
  },
  server: {
    proxy: {
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
