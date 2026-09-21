import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { isValidSessionId, readPiSessions } from "./pi-sessions.js";
import { readSandboxFile, readSandboxTree } from "./sandbox-files.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const IS_PRODUCTION = process.argv.includes("--production");
const MAX_BODY_SIZE = 32 * 1024;
const MAX_AGENT_OUTPUT = 2 * 1024 * 1024;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const vite = IS_PRODUCTION
  ? null
  : await createViteServer({
      root: ROOT,
      appType: "spa",
      server: { middlewareMode: true },
    });

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error("消息太长"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("请求内容不是有效 JSON"));
      }
    });
    request.on("error", reject);
  });
}

function askPiAgent(prompt, { sessionId, sessionName = "" }) {
  return new Promise((resolve, reject) => {
    const runnerArguments = [
      path.join(ROOT, "run-pi-agent.js"),
      "--session-id",
      sessionId,
      ...(sessionName ? ["--session-name", sessionName] : []),
      "--",
      prompt,
    ];
    const child = spawn(process.execPath, runnerArguments, {
      cwd: ROOT,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputSize = 0;

    function collect(chunk, target) {
      outputSize += chunk.length;
      if (outputSize > MAX_AGENT_OUTPUT) {
        child.kill();
        reject(new Error("pi Agent 返回内容过长"));
        return target;
      }
      return target + chunk.toString("utf8");
    }

    child.stdout.on("data", (chunk) => {
      stdout = collect(chunk, stdout);
    });
    child.stderr.on("data", (chunk) => {
      stderr = collect(chunk, stderr);
    });
    child.once("error", (error) => {
      reject(error);
    });
    child.once("close", (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `pi Agent 退出码：${code}`));
      }
    });
  });
}

function serveProductionAsset(request, response) {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const requestedPath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const distRoot = path.join(ROOT, "dist");
  let filePath = path.resolve(distRoot, requestedPath);

  if (!filePath.startsWith(`${distRoot}${path.sep}`) || !existsSync(filePath)) {
    filePath = path.join(distRoot, "index.html");
  }

  response.writeHead(200, {
    "content-type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, "http://localhost");
  const pathname = requestUrl.pathname;

  if (request.method === "GET" && pathname === "/api/health") {
    return sendJson(response, 200, { ok: true, agent: "pi", container: "connected" });
  }

  if (request.method === "GET" && pathname === "/api/sandbox/files") {
    try {
      return sendJson(response, 200, await readSandboxTree());
    } catch (error) {
      return sendJson(response, 502, {
        error: error instanceof Error ? error.message : "无法读取沙箱代码目录",
      });
    }
  }

  if (request.method === "GET" && pathname === "/api/sandbox/file") {
    try {
      const filePath = requestUrl.searchParams.get("path") || "";
      if (!filePath || filePath.length > 512) {
        return sendJson(response, 400, { error: "文件路径无效" });
      }
      return sendJson(response, 200, await readSandboxFile(filePath));
    } catch (error) {
      return sendJson(response, 400, {
        error: error instanceof Error ? error.message : "无法读取沙箱文件",
      });
    }
  }

  if (request.method === "GET" && pathname === "/api/sessions") {
    try {
      const payload = await readPiSessions();
      return sendJson(response, 200, payload);
    } catch (error) {
      return sendJson(response, 502, {
        error: error instanceof Error ? error.message : "无法读取 pi Agent 会话",
      });
    }
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/u);
  if (request.method === "GET" && sessionMatch) {
    try {
      const sessionId = decodeURIComponent(sessionMatch[1]);
      if (!isValidSessionId(sessionId)) {
        return sendJson(response, 400, { error: "无效的 session ID" });
      }
      const payload = await readPiSessions(sessionId);
      if (!payload.session) return sendJson(response, 404, { error: "找不到这个会话" });
      return sendJson(response, 200, payload);
    } catch (error) {
      return sendJson(response, 502, {
        error: error instanceof Error ? error.message : "无法读取 pi Agent 会话",
      });
    }
  }

  if (request.method === "POST" && pathname === "/api/chat") {
    try {
      const body = await readJson(request);
      const prompt = typeof body?.message === "string" ? body.message.trim() : "";
      if (!prompt) return sendJson(response, 400, { error: "请输入消息" });

      const requestedSessionId =
        typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
      if (requestedSessionId && !isValidSessionId(requestedSessionId)) {
        return sendJson(response, 400, { error: "无效的 session ID" });
      }

      const sessionId = requestedSessionId || randomUUID();
      const sessionName = requestedSessionId ? "" : prompt.replace(/\s+/gu, " ").slice(0, 48);

      const reply = await askPiAgent(prompt, { sessionId, sessionName });
      return sendJson(response, 200, { reply, sessionId });
    } catch (error) {
      return sendJson(response, 502, {
        error: error instanceof Error ? error.message : "pi Agent 调用失败",
      });
    }
  }

  if (vite) {
    return vite.middlewares(request, response, () => {
      response.writeHead(404);
      response.end("Not found");
    });
  }

  return serveProductionAsset(request, response);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Artifact 已启动：http://localhost:${PORT}`);
});
