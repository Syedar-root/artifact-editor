import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";
import { createServer } from "vite";
import webConfig from "../../vite.config.js";

const browser = [
  process.env.ARTIFACT_TEST_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].find(candidate => candidate && existsSync(candidate));
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test("首次打开和刷新页面时，预览 iframe 各加载一次", {
  skip: !browser && "当前环境没有可用的 Chromium 浏览器",
  timeout: 40_000,
}, async () => {
  const artifact = {
    id: "preview-load-fixture", name: "预览加载测试", technologyStack: "html",
    previewUrl: "/proxy/5173/", locatorMode: "runtime-hint",
  };
  const profile = await mkdtemp(join(tmpdir(), "artifact-preview-test-"));
  let server, child, socket;
  try {
    // 使用独立服务和固定响应，避免启动或切换用户的真实产物。
    server = await createServer({
      ...webConfig,
      configFile: false,
      root: fileURLToPath(new URL("../../", import.meta.url)),
      server: { host: "127.0.0.1", port: 0 },
      plugins: [...webConfig.plugins, {
        name: "preview-load-fixture",
        configureServer(current) {
          current.middlewares.use((request, response, next) => {
            const pathname = new URL(request.url, "http://fixture").pathname;
            if (pathname === artifact.previewUrl) {
              response.setHeader("content-type", "text/html; charset=utf-8");
              response.end("<!doctype html><h1>预览已加载</h1>");
              return;
            }
            if (!pathname.startsWith("/api/")) return next();
            let payload;
            if (pathname === "/api/artifacts") payload = { artifacts: [artifact] };
            else if (pathname === `/api/artifacts/${artifact.id}/start`) payload = { artifact };
            else if (pathname === `/api/artifacts/${artifact.id}/checkpoints`) payload = {
              checkpoints: [{ version: 1, message: "测试版本", createdAt: "2026-01-01T00:00:00Z" }],
              state: { mode: "latest", activeVersion: 1, workspaceVersion: 1, latestVersion: 1, nextVersion: 2, revision: "fixture:1" },
            };
            else if (pathname === "/api/sessions") payload = { sessions: [] };
            else {
              response.statusCode = 404;
              payload = { error: `未定义测试接口：${pathname}` };
            }
            response.setHeader("content-type", "application/json; charset=utf-8");
            response.end(JSON.stringify(payload));
          });
        },
      }],
    });
    await server.listen();
    const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
    child = spawn(browser, [
      "--headless=new", "--disable-gpu", "--no-sandbox",
      "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: "ignore", windowsHide: true });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    let debuggingPort;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        debuggingPort = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await delay(100);
      }
    }
    assert.ok(debuggingPort, "浏览器调试端口没有启动");
    const target = await fetch(`http://127.0.0.1:${debuggingPort}/json/new?about:blank`, {
      method: "PUT",
    }).then(response => response.json());
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let commandId = 0;
    const pending = new Map();
    const previewDocuments = [];
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (pending.has(message.id)) {
        const { resolve, reject, timer } = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      }
      if (message.method === "Network.requestWillBeSent"
        && message.params.type === "Document"
        && message.params.request.url === `${baseUrl}${artifact.previewUrl}`) {
        previewDocuments.push(message.params.request.url);
      }
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++commandId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`浏览器命令超时：${method}`));
      }, 5000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const waitForPreview = async expectedLoads => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await command("Runtime.evaluate", {
          expression: "document.querySelector('iframe.sandbox-preview')?.contentDocument?.querySelector('h1')?.textContent",
          returnByValue: true,
        });
        if (previewDocuments.length >= expectedLoads && result.result.value === "预览已加载") {
          await delay(500);
          assert.equal(previewDocuments.length, expectedLoads, "每次打开页面，iframe 应只加载一次");
          return;
        }
        await delay(100);
      }
      assert.fail("没有加载预览页面");
    };
    await command("Network.enable");
    await command("Page.enable");
    await command("Page.navigate", { url: baseUrl });
    await waitForPreview(1);
    await command("Page.reload", { ignoreCache: true });
    await waitForPreview(2);
  } finally {
    socket?.close();
    if (child && child.exitCode === null) {
      const stopped = new Promise(resolve => child.once("exit", resolve));
      child.kill();
      await Promise.race([stopped, delay(2000)]);
    }
    await server?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
