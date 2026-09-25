import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PI_CONTAINER_ID } from "./pi-sessions.js";

export const SANDBOX_WORKSPACE_ROOT = "/workspace";

const ARTIFACT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/u;
const PREVIEW_PORT_START = 5173;
const PREVIEW_PORT_END = 5999;
const MAX_DOCKER_OUTPUT = 4 * 1024 * 1024;
const TECHNOLOGY_STACKS = new Set(["html", "react", "vue"]);
const SDK_VITE_ADAPTER_PATH = fileURLToPath(
  import.meta.resolve("@artifact-editor/sdk/vite"),
);

const DISCOVER_ARTIFACTS_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");

const workspaceRoot = path.resolve(process.argv[1]);
const startPort = Number(process.argv[2]);
const metadataDirectoryName = ".artifact";
const metadataFileName = "metadata.json";

fs.mkdirSync(workspaceRoot, { recursive: true });

const candidates = fs.readdirSync(workspaceRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .filter((entry) => {
    const root = path.join(workspaceRoot, entry.name);
    return fs.existsSync(path.join(root, "package.json")) || fs.existsSync(path.join(root, "index.html"));
  })
  .sort((left, right) => left.name.localeCompare(right.name));

const usedPorts = new Set();
for (const entry of candidates) {
  const metadataPath = path.join(workspaceRoot, entry.name, metadataDirectoryName, metadataFileName);
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    if (Number.isInteger(metadata.previewPort)) usedPorts.add(metadata.previewPort);
  } catch {}
}

let nextPort = startPort;
function allocatePort() {
  while (usedPorts.has(nextPort)) nextPort += 1;
  const port = nextPort;
  usedPorts.add(port);
  nextPort += 1;
  return port;
}

function displayName(root, fallback) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    if (typeof packageJson.name === "string" && packageJson.name.trim()) return packageJson.name.trim();
  } catch {}
  return fallback;
}

function packageJsonAt(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

function detectTechnologyStack(root) {
  const packageJson = packageJsonAt(root);
  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };
  let reactScore = dependencies.react || dependencies["react-dom"] ? 2 : 0;
  let vueScore = dependencies.vue ? 2 : 0;
  const sourceRoot = path.join(root, "src");
  const pending = fs.existsSync(sourceRoot) ? [sourceRoot] : [];
  let inspectedFiles = 0;

  while (pending.length > 0 && inspectedFiles < 200) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(filePath);
        continue;
      }
      inspectedFiles += 1;
      if (/\.vue$/iu.test(entry.name)) vueScore += 5;
      if (/\.(jsx|tsx)$/iu.test(entry.name)) reactScore += 4;
      if (!/\.(js|jsx|ts|tsx|vue)$/iu.test(entry.name)) continue;
      try {
        const source = fs.readFileSync(filePath, "utf8").slice(0, 256 * 1024);
        if (/from\s+["']react(?:-dom)?(?:\/[^"']*)?["']/u.test(source)) reactScore += 4;
        if (/from\s+["']vue["']/u.test(source)) vueScore += 4;
      } catch {}
    }
  }

  if (vueScore > reactScore) return "vue";
  if (reactScore > vueScore) return "react";
  if (dependencies.vue) return "vue";
  if (dependencies.react || dependencies["react-dom"]) return "react";
  return "html";
}

function packageIsInstalled(root, packageName) {
  return fs.existsSync(path.join(root, "node_modules", ...packageName.split("/"), "package.json"));
}

const artifacts = candidates.map((entry) => {
  const root = path.join(workspaceRoot, entry.name);
  const metadataDirectory = path.join(root, metadataDirectoryName);
  const metadataPath = path.join(metadataDirectory, metadataFileName);
  let metadata = {};
  try { metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")); } catch {}

  const stats = fs.statSync(root);
  const detectedStack = detectTechnologyStack(root);
  const requestedStack = ["html", "react", "vue"].includes(metadata.requestedStack)
    ? metadata.requestedStack
    : detectedStack;
  const locatorMode = (detectedStack === "react" || detectedStack === "vue")
    && packageIsInstalled(root, "code-inspector-plugin")
    ? "code-inspector"
    : "runtime-hint";
  const normalized = {
    id: entry.name,
    name: typeof metadata.name === "string" && metadata.name.trim()
      ? metadata.name.trim()
      : displayName(root, entry.name),
    previewPort: Number.isInteger(metadata.previewPort) ? metadata.previewPort : allocatePort(),
    createdAt: typeof metadata.createdAt === "string"
      ? metadata.createdAt
      : (stats.birthtime || stats.ctime).toISOString(),
    requestedStack,
    detectedStack,
    locatorMode,
  };

  fs.mkdirSync(metadataDirectory, { recursive: true });
  fs.writeFileSync(metadataPath, JSON.stringify(normalized, null, 2) + "\n");
  return normalized;
});

process.stdout.write(JSON.stringify({ artifacts }));
`;

const CREATE_ARTIFACT_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");

const workspaceRoot = path.resolve(process.argv[1]);
const id = process.argv[2];
const name = process.argv[3];
const previewPort = Number(process.argv[4]);
const requestedStack = process.argv[5];
const root = path.join(workspaceRoot, id);

if (fs.existsSync(root)) throw new Error("产物目录已经存在");
if (!["html", "react", "vue"].includes(requestedStack)) throw new Error("不支持的技术栈");
fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.mkdirSync(path.join(root, ".artifact"), { recursive: true });

const packageJson = {
  name: id,
  private: true,
  version: "0.0.0",
  type: "module",
  scripts: { dev: "vite", build: "vite build" },
  dependencies: requestedStack === "react"
    ? { react: "latest", "react-dom": "latest" }
    : requestedStack === "vue" ? { vue: "latest" } : {},
  devDependencies: {
    vite: "latest",
    ...(requestedStack === "react"
      ? { "@vitejs/plugin-react": "latest", "code-inspector-plugin": "latest" }
      : {}),
    ...(requestedStack === "vue"
      ? { "@vitejs/plugin-vue": "latest", "code-inspector-plugin": "latest" }
      : {}),
  },
};

const cleanName = name.replace(/[<>&"]/g, "");
const entryFile = requestedStack === "react" ? "/src/main.jsx" : "/src/main.js";
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
  ...(requestedStack === "html" ? [
    '      <section class="hero">',
    '        <span class="eyebrow">NEW ARTIFACT</span>',
    "        <h1>" + cleanName + "</h1>",
    "        <p>这个产物已经准备好，可以通过对话或代码继续编辑。</p>",
    "      </section>",
  ] : []),
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

const metadata = {
  id,
  name,
  previewPort,
  createdAt: new Date().toISOString(),
  requestedStack,
  detectedStack: requestedStack,
  locatorMode: requestedStack === "html" ? "runtime-hint" : "code-inspector",
};
fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");
fs.writeFileSync(path.join(root, "index.html"), indexHtml);
fs.writeFileSync(
  path.join(root, "src", requestedStack === "react" ? "main.jsx" : "main.js"),
  requestedStack === "react" ? reactMain : requestedStack === "vue" ? vueMain : htmlMain,
);
if (requestedStack === "vue") fs.writeFileSync(path.join(root, "src", "App.vue"), vueApp);
fs.writeFileSync(path.join(root, "src", "style.css"), styleCss);
fs.writeFileSync(path.join(root, ".artifact", "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
process.stdout.write(JSON.stringify(metadata));
`;

const WRITE_PREVIEW_CONFIG_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(process.argv[1]);
const technologyStack = process.argv[2];
const locatorMode = process.argv[3];
const configDirectory = path.join(root, ".artifact");
fs.mkdirSync(configDirectory, { recursive: true });
const imports = [
  'import { defineConfig } from "vite";',
  'import { fileURLToPath } from "node:url";',
  'import { createArtifactInspectorVitePlugin } from "./artifact-editor-sdk-vite.mjs";',
  ...(technologyStack === "react" ? ['import react from "@vitejs/plugin-react";'] : []),
  ...(technologyStack === "vue" ? ['import vue from "@vitejs/plugin-vue";'] : []),
  ...(locatorMode === "code-inspector"
    ? ['import { codeInspectorPlugin } from "code-inspector-plugin";']
    : []),
  '',
];
const plugins = [
  '  {',
  '    name: "artifact-sandbox-proxy",',
  '    configureServer(server) {',
  '      server.middlewares.use((request, _response, next) => {',
  '        if (request.url && !request.url.startsWith(proxyBase)) {',
  '          request.url = proxyBase.slice(0, -1) + request.url;',
  '        }',
  '        next();',
  '      });',
  '    },',
  '  },',
  ...(locatorMode === "code-inspector" ? [
    '  createArtifactInspectorVitePlugin({',
    '    technologyStack,',
    '    codeInspectorPlugin,',
    '  }),',
  ] : []),
  ...(technologyStack === "react" ? ['  react(),'] : []),
  ...(technologyStack === "vue" ? ['  vue(),'] : []),
];
const config = [
  ...imports,
  'const root = fileURLToPath(new URL("..", import.meta.url));',
  'const previewPort = Number(process.env.ARTIFACT_PREVIEW_PORT);',
  'const technologyStack = ' + JSON.stringify(technologyStack) + ';',
  'const proxyBase = "/proxy/" + previewPort + "/";',
  '',
  'export default defineConfig({',
  '  root,',
  '  base: proxyBase,',
  '  plugins: [',
  ...plugins,
  '  ],',
  '  server: { host: "0.0.0.0", port: previewPort, strictPort: true },',
  '});',
  '',
].join("\n");
const configPath = path.join(configDirectory, "vite.config.mjs");
let previous = "";
try { previous = fs.readFileSync(configPath, "utf8"); } catch {}
const changed = previous !== config;
if (changed) fs.writeFileSync(configPath, config);
process.stdout.write(JSON.stringify({ changed }));
`;

function runDocker(args, { maxOutput = MAX_DOCKER_OUTPUT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputSize = 0;

    const collect = (chunk, current) => {
      outputSize += chunk.length;
      if (outputSize > maxOutput) {
        child.kill();
        reject(new Error("沙箱返回内容过大"));
        return current;
      }
      return current + chunk.toString("utf8");
    };

    child.stdout.on("data", (chunk) => { stdout = collect(chunk, stdout); });
    child.stderr.on("data", (chunk) => { stderr = collect(chunk, stderr); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `沙箱命令执行失败：${code}`));
    });
  });
}

function toArtifact(metadata) {
  const requestedStack = TECHNOLOGY_STACKS.has(metadata.requestedStack)
    ? metadata.requestedStack
    : "html";
  const detectedStack = TECHNOLOGY_STACKS.has(metadata.detectedStack)
    ? metadata.detectedStack
    : requestedStack;
  return {
    id: metadata.id,
    name: metadata.name,
    status: "ready",
    previewUrl: `/proxy/${metadata.previewPort}/`,
    createdAt: metadata.createdAt,
    updatedAt: metadata.createdAt,
    requestedStack,
    detectedStack,
    stackChanged: requestedStack !== detectedStack,
    locatorMode: metadata.locatorMode === "code-inspector"
      ? "code-inspector"
      : "runtime-hint",
  };
}

function slugify(value) {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return slug || `artifact-${randomBytes(3).toString("hex")}`;
}

export function isValidArtifactId(value) {
  return typeof value === "string" && ARTIFACT_ID_PATTERN.test(value);
}

export function artifactRoot(artifactId) {
  if (!isValidArtifactId(artifactId)) throw new Error("无效的 artifact ID");
  return `${SANDBOX_WORKSPACE_ROOT}/${artifactId}`;
}

export async function listArtifacts() {
  const output = await runDocker([
    "exec",
    PI_CONTAINER_ID,
    "node",
    "-e",
    DISCOVER_ARTIFACTS_SCRIPT,
    SANDBOX_WORKSPACE_ROOT,
    String(PREVIEW_PORT_START),
  ]);
  const payload = JSON.parse(output);
  return payload.artifacts.map(toArtifact);
}

export async function getArtifact(artifactId) {
  if (!isValidArtifactId(artifactId)) return null;
  const artifacts = await listArtifacts();
  return artifacts.find((artifact) => artifact.id === artifactId) || null;
}

export async function createArtifact(name, technologyStack = "html") {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName || trimmedName.length > 80) throw new Error("产物名称应为 1–80 个字符");
  if (!TECHNOLOGY_STACKS.has(technologyStack)) throw new Error("请选择有效的技术栈");

  const artifacts = await listArtifacts();
  const ids = new Set(artifacts.map((artifact) => artifact.id));
  const baseId = slugify(trimmedName);
  let id = baseId;
  while (ids.has(id)) id = `${baseId.slice(0, 42)}-${randomBytes(2).toString("hex")}`;

  const usedPorts = artifacts.map((artifact) => Number(new URL(artifact.previewUrl, "http://local").pathname.split("/")[2]));
  const previewPort = Math.max(PREVIEW_PORT_START - 1, ...usedPorts) + 1;
  if (previewPort > PREVIEW_PORT_END) throw new Error("沙箱中可用的预览端口已耗尽");

  const output = await runDocker([
    "exec",
    PI_CONTAINER_ID,
    "node",
    "-e",
    CREATE_ARTIFACT_SCRIPT,
    SANDBOX_WORKSPACE_ROOT,
    id,
    trimmedName,
    String(previewPort),
    technologyStack,
  ]);
  JSON.parse(output);

  await runDocker([
    "exec",
    "-w",
    artifactRoot(id),
    PI_CONTAINER_ID,
    "npm",
    "install",
    "--no-audit",
    "--no-fund",
  ]);

  return getArtifact(id);
}

async function previewIsReachable(previewUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(`http://127.0.0.1:18080${previewUrl}`, {
      signal: controller.signal,
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureFrameworkLocator(artifact) {
  if (
    artifact.locatorMode === "code-inspector"
    || (artifact.detectedStack !== "react" && artifact.detectedStack !== "vue")
  ) return artifact;

  try {
    await runDocker([
      "exec",
      "-w",
      artifactRoot(artifact.id),
      PI_CONTAINER_ID,
      "npm",
      "install",
      "--no-save",
      "--no-package-lock",
      "--no-audit",
      "--no-fund",
      "code-inspector-plugin",
      artifact.detectedStack === "react" ? "@vitejs/plugin-react" : "@vitejs/plugin-vue",
    ]);
    return (await getArtifact(artifact.id)) || artifact;
  } catch {
    // 定位插件不可用时保持 runtime hint，不能阻断产物预览。
    return artifact;
  }
}

export async function startArtifact(artifactId) {
  let artifact = await getArtifact(artifactId);
  if (!artifact) throw new Error("找不到这个产物");
  artifact = await ensureFrameworkLocator(artifact);

  const previewPort = artifact.previewUrl.split("/")[2];
  const root = artifactRoot(artifactId);
  const previewWasRunning = await previewIsReachable(artifact.previewUrl);
  await runDocker([
    "cp",
    SDK_VITE_ADAPTER_PATH,
    `${PI_CONTAINER_ID}:${root}/.artifact/artifact-editor-sdk-vite.mjs`,
  ]);
  const configOutput = await runDocker([
    "exec",
    PI_CONTAINER_ID,
    "node",
    "-e",
    WRITE_PREVIEW_CONFIG_SCRIPT,
    root,
    artifact.detectedStack,
    artifact.locatorMode,
  ]);
  const { changed: previewConfigChanged } = JSON.parse(configOutput);

  if (previewWasRunning && !previewConfigChanged) return artifact;

  if (previewWasRunning) {
    await runDocker([
      "exec",
      PI_CONTAINER_ID,
      "fuser",
      "-k",
      `${previewPort}/tcp`,
    ]).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  await runDocker([
    "exec",
    "-d",
    "-e",
    `ARTIFACT_PREVIEW_PORT=${previewPort}`,
    "-w",
    root,
    PI_CONTAINER_ID,
    "npx",
    "vite",
    "--config",
    ".artifact/vite.config.mjs",
  ]);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await previewIsReachable(artifact.previewUrl)) return artifact;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("产物预览启动超时");
}
