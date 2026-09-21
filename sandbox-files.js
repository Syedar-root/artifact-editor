import { spawn } from "node:child_process";
import { PI_CONTAINER_ID } from "./pi-sessions.js";

export const SANDBOX_PROJECT_ROOT = "/workspace/html-app";

const MAX_OUTPUT = 4 * 1024 * 1024;
const CONTAINER_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(process.argv[1]);
const mode = process.argv[2];
const requestedPath = process.argv[3] || "";
const ignoredDirectories = new Set(["node_modules", ".git", "dist", ".vite"]);
const maxEntries = 1000;
let entryCount = 0;

function toRelativePath(absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function readDirectory(directory, depth = 0) {
  if (depth > 10 || entryCount >= maxEntries) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !ignoredDirectories.has(entry.name))
    .filter((entry) => !entry.isSymbolicLink())
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name);
    })
    .flatMap((entry) => {
      if (entryCount >= maxEntries) return [];
      entryCount += 1;
      const absolutePath = path.join(directory, entry.name);
      const node = {
        name: entry.name,
        path: toRelativePath(absolutePath),
        type: entry.isDirectory() ? "directory" : "file",
      };
      if (entry.isDirectory()) node.children = readDirectory(absolutePath, depth + 1);
      return [node];
    });
}

function resolveRequestedFile(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new Error("文件路径无效");
  }
  const normalized = relativePath.split("/").filter(Boolean).join(path.sep);
  const absolutePath = path.resolve(root, normalized);
  if (!absolutePath.startsWith(root + path.sep)) throw new Error("文件路径超出项目目录");
  const stats = fs.statSync(absolutePath);
  if (!stats.isFile()) throw new Error("目标不是文件");
  if (stats.size > 1024 * 1024) throw new Error("文件超过 1 MB，暂不展示");
  return { absolutePath, stats };
}

try {
  if (mode === "tree") {
    const tree = readDirectory(root);
    process.stdout.write(JSON.stringify({
      root,
      tree,
      defaultFile: fs.existsSync(path.join(root, "index.html"))
        ? "index.html"
        : tree.find((node) => node.type === "file")?.path || "",
      truncated: entryCount >= maxEntries,
    }));
  } else if (mode === "file") {
    const { absolutePath, stats } = resolveRequestedFile(requestedPath);
    const buffer = fs.readFileSync(absolutePath);
    if (buffer.includes(0)) throw new Error("这是二进制文件，暂不支持预览");
    process.stdout.write(JSON.stringify({
      path: toRelativePath(absolutePath),
      content: buffer.toString("utf8"),
      size: stats.size,
    }));
  } else {
    throw new Error("未知的文件读取模式");
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error.message || "读取沙箱文件失败" }));
}
`;

function runContainer(mode, relativePath = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "exec",
        PI_CONTAINER_ID,
        "node",
        "-e",
        CONTAINER_SCRIPT,
        SANDBOX_PROJECT_ROOT,
        mode,
        relativePath,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let outputSize = 0;

    const collect = (chunk, current) => {
      outputSize += chunk.length;
      if (outputSize > MAX_OUTPUT) {
        child.kill();
        reject(new Error("沙箱代码数据过大"));
        return current;
      }
      return current + chunk.toString("utf8");
    };

    child.stdout.on("data", (chunk) => {
      stdout = collect(chunk, stdout);
    });
    child.stderr.on("data", (chunk) => {
      stderr = collect(chunk, stderr);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `读取沙箱代码失败：${code}`));
        return;
      }
      try {
        const payload = JSON.parse(stdout);
        if (payload.error) reject(new Error(payload.error));
        else resolve(payload);
      } catch {
        reject(new Error("沙箱返回了无效的文件数据"));
      }
    });
  });
}

export function readSandboxTree() {
  return runContainer("tree");
}

export function readSandboxFile(relativePath) {
  return runContainer("file", relativePath);
}
