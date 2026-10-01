import { randomUUID } from "node:crypto";
import { createServer, request as createHttpRequest } from "node:http";
import { connect as connectSocket } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  createArtifact,
  getArtifact,
  isValidArtifactId,
  listArtifacts,
  startArtifact,
} from "./artifacts.js";
import { initializeArtifactWorkspace, workspaceForArtifact } from "./sandbox.js";
import { askPiAgent } from "./pi-agent.js";
import { isValidSessionId, readPiSessions } from "./pi-sessions.js";

const SERVER_ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST_ROOT = path.resolve(SERVER_ROOT, "../../web/dist");
const IS_PRODUCTION = process.argv.includes("--production");
const PORT = Number(process.env.PORT || (IS_PRODUCTION ? 4173 : 4174));
const MAX_BODY_SIZE = 32 * 1024;
const SANDBOX_PROXY_HOST = "127.0.0.1";
const SANDBOX_PROXY_PORT = 18080;
const SANDBOX_PROXY_PATTERN = /^\/proxy\/(5\d{3})\//u;

function proxySandboxRequest(request, response) {
  const proxyRequest = createHttpRequest(
    {
      hostname: SANDBOX_PROXY_HOST,
      port: SANDBOX_PROXY_PORT,
      method: request.method,
      path: request.url,
      headers: {
        ...request.headers,
        host: `${SANDBOX_PROXY_HOST}:${SANDBOX_PROXY_PORT}`,
      },
    },
    (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
      proxyResponse.pipe(response);
    },
  );

  proxyRequest.on("error", (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.status(502).json({ error: `无法连接沙箱预览：${error.message}` });
  });
  request.pipe(proxyRequest);
}

function proxySandboxUpgrade(request, socket, head) {
  const upstream = connectSocket(SANDBOX_PROXY_PORT, SANDBOX_PROXY_HOST);

  upstream.once("connect", () => {
    const headers = {
      ...request.headers,
      host: `${SANDBOX_PROXY_HOST}:${SANDBOX_PROXY_PORT}`,
    };
    const headerLines = Object.entries(headers).flatMap(([name, value]) => {
      if (Array.isArray(value)) return value.map((item) => `${name}: ${item}`);
      return value === undefined ? [] : [`${name}: ${value}`];
    });
    upstream.write(
      `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headerLines.join("\r\n")}\r\n\r\n`,
    );
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function wantsArtifactProgress(request) {
  return request.get("accept")?.includes("application/x-ndjson");
}

function beginArtifactProgress(response) {
  response.status(200);
  response.setHeader("content-type", "application/x-ndjson; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.flushHeaders();
}

function writeArtifactProgress(response, event) {
  response.write(`${JSON.stringify(event)}\n`);
}

async function artifactExists(artifactId) {
  return isValidArtifactId(artifactId) && !!(await getArtifact(artifactId));
}

function checkpointVersion(value) {
  const version = Number(value);
  return Number.isSafeInteger(version) && version > 0 ? version : null;
}

const app = express();

// 预览响应和 HMR WebSocket 都保持原始请求体，必须放在 JSON 中间件之前。
app.use((request, response, next) => {
  if (SANDBOX_PROXY_PATTERN.test(request.path)) {
    proxySandboxRequest(request, response);
    return;
  }
  next();
});
app.use(express.json({ limit: MAX_BODY_SIZE }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, agent: "pi", container: "connected" });
});

app.get("/api/artifacts", asyncRoute(async (_request, response) => {
  response.json({ artifacts: await listArtifacts() });
}));

app.post("/api/artifacts", asyncRoute(async (request, response) => {
  if (wantsArtifactProgress(request)) {
    beginArtifactProgress(response);
    try {
      const artifact = await createArtifact(
        request.body?.name,
        request.body?.technologyStack,
        (phase) => writeArtifactProgress(response, { type: "progress", phase }),
      );
      writeArtifactProgress(response, { type: "complete", artifact });
    } catch (error) {
      writeArtifactProgress(response, {
        type: "error",
        error: error instanceof Error ? error.message : "无法创建产物",
      });
    } finally {
      response.end();
    }
    return;
  }
  try {
    const artifact = await createArtifact(
      request.body?.name,
      request.body?.technologyStack,
    );
    response.status(201).json({ artifact });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "无法创建产物",
    });
  }
}));

app.post("/api/artifacts/:artifactId/start", asyncRoute(async (request, response) => {
  if (wantsArtifactProgress(request)) {
    beginArtifactProgress(response);
    try {
      const artifactId = request.params.artifactId;
      if (!isValidArtifactId(artifactId)) throw new Error("无效的 artifact ID");
      const artifact = await startArtifact(
        artifactId,
        (phase) => writeArtifactProgress(response, { type: "progress", phase }),
      );
      writeArtifactProgress(response, { type: "complete", artifact });
    } catch (error) {
      writeArtifactProgress(response, {
        type: "error",
        error: error instanceof Error ? error.message : "无法启动产物预览",
      });
    } finally {
      response.end();
    }
    return;
  }
  try {
    const artifactId = request.params.artifactId;
    if (!isValidArtifactId(artifactId)) {
      response.status(400).json({ error: "无效的 artifact ID" });
      return;
    }
    response.json({ artifact: await startArtifact(artifactId) });
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : "无法启动产物预览",
    });
  }
}));

app.get("/api/artifacts/:artifactId/checkpoints", asyncRoute(async (request, response) => {
  const { artifactId } = request.params;
  if (!(await artifactExists(artifactId))) {
    response.status(404).json({ error: "找不到这个产物" });
    return;
  }
  await initializeArtifactWorkspace(artifactId);
  response.json(await workspaceForArtifact(artifactId).versions.inspect());
}));

app.post("/api/artifacts/:artifactId/checkpoints/:version/preview", asyncRoute(async (request, response) => {
  const { artifactId } = request.params;
  const version = checkpointVersion(request.params.version);
  if (!(await artifactExists(artifactId)) || !version) {
    response.status(400).json({ error: "产物或版本无效" });
    return;
  }
  await initializeArtifactWorkspace(artifactId);
  const snapshot = await workspaceForArtifact(artifactId).versions.checkout(version);
  const artifact = await startArtifact(artifactId);
  response.json({ ...snapshot, artifact });
}));

app.post("/api/artifacts/:artifactId/checkpoints/:version/edit", asyncRoute(async (request, response) => {
  const { artifactId } = request.params;
  const version = checkpointVersion(request.params.version);
  if (!(await artifactExists(artifactId)) || !version) {
    response.status(400).json({ error: "产物或版本无效" });
    return;
  }
  await initializeArtifactWorkspace(artifactId);
  const snapshot = await workspaceForArtifact(artifactId).versions.beginEdit(version);
  const artifact = await startArtifact(artifactId);
  response.json({ ...snapshot, artifact });
}));

app.post("/api/artifacts/:artifactId/checkpoints/resume", asyncRoute(async (request, response) => {
  const { artifactId } = request.params;
  if (!(await artifactExists(artifactId))) {
    response.status(404).json({ error: "找不到这个产物" });
    return;
  }
  await initializeArtifactWorkspace(artifactId);
  const snapshot = await workspaceForArtifact(artifactId).versions.resume();
  const artifact = await startArtifact(artifactId);
  response.json({ ...snapshot, artifact });
}));

app.get("/api/sandbox/files", asyncRoute(async (request, response) => {
  const artifactId = typeof request.query.artifactId === "string" ? request.query.artifactId : "";
  if (!(await artifactExists(artifactId))) {
    response.status(400).json({ error: "请选择有效的产物" });
    return;
  }
  const workspace = workspaceForArtifact(artifactId);
  response.json({ root: workspace.root, ...await workspace.files.list() });
}));

app.get("/api/sandbox/file", asyncRoute(async (request, response) => {
  const artifactId = typeof request.query.artifactId === "string" ? request.query.artifactId : "";
  const filePath = typeof request.query.path === "string" ? request.query.path : "";
  if (!(await artifactExists(artifactId))) {
    response.status(400).json({ error: "请选择有效的产物" });
    return;
  }
  if (!filePath || filePath.length > 512) {
    response.status(400).json({ error: "文件路径无效" });
    return;
  }
  try {
    response.json(await workspaceForArtifact(artifactId).files.read(filePath));
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "无法读取沙箱文件",
    });
  }
}));

app.get("/api/sessions", asyncRoute(async (request, response) => {
  const artifactId = typeof request.query.artifactId === "string" ? request.query.artifactId : "";
  if (!(await artifactExists(artifactId))) {
    response.status(400).json({ error: "请选择有效的产物" });
    return;
  }
  response.json(await readPiSessions("", artifactId));
}));

app.get("/api/sessions/:sessionId", asyncRoute(async (request, response) => {
  const { sessionId } = request.params;
  const artifactId = typeof request.query.artifactId === "string" ? request.query.artifactId : "";
  if (!isValidSessionId(sessionId)) {
    response.status(400).json({ error: "无效的 session ID" });
    return;
  }
  if (!(await artifactExists(artifactId))) {
    response.status(400).json({ error: "请选择有效的产物" });
    return;
  }
  const payload = await readPiSessions(sessionId, artifactId);
  if (!payload.session) {
    response.status(404).json({ error: "找不到这个会话" });
    return;
  }
  response.json(payload);
}));

app.post("/api/chat", asyncRoute(async (request, response) => {
  const prompt = typeof request.body?.message === "string" ? request.body.message.trim() : "";
  if (!prompt) {
    response.status(400).json({ error: "请输入消息" });
    return;
  }

  const artifactId = typeof request.body?.artifactId === "string"
    ? request.body.artifactId.trim()
    : "";
  if (!(await artifactExists(artifactId))) {
    response.status(400).json({ error: "请选择有效的产物" });
    return;
  }

  const requestedSessionId = typeof request.body?.sessionId === "string"
    ? request.body.sessionId.trim()
    : "";
  if (requestedSessionId && !isValidSessionId(requestedSessionId)) {
    response.status(400).json({ error: "无效的 session ID" });
    return;
  }
  if (requestedSessionId) {
    const existing = await readPiSessions(requestedSessionId, artifactId);
    if (!existing.session) {
      response.status(409).json({ error: "这个会话不属于当前产物" });
      return;
    }
  }

  const sessionId = requestedSessionId || randomUUID();
  const sessionName = requestedSessionId ? "" : prompt.replace(/\s+/gu, " ").slice(0, 48);
  const technologyBefore = await getArtifact(artifactId);
  await initializeArtifactWorkspace(artifactId);
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("请求已取消"));
  const onClose = () => { if (!response.writableEnded) cancel(); };
  request.once("aborted", cancel);
  response.once("close", onClose);
  let mutation;
  try {
    mutation = await workspaceForArtifact(artifactId).edit({
      message: prompt,
      onError: "rollback",
      expectedRevision: typeof request.body?.checkpointRevision === "string"
        ? request.body.checkpointRevision
        : "",
    }, workspace => askPiAgent(prompt, {
      sandbox: workspace.sandbox, cwd: workspace.root, sessionId, sessionName, signal: controller.signal,
    }));
  } finally {
    request.removeListener("aborted", cancel);
    response.removeListener("close", onClose);
  }
  const reply = mutation.value;
  let artifact = await getArtifact(artifactId);
  let runtimeWarning = "";
  const runtimeChanged = artifact && technologyBefore && (
    artifact.detectedStack !== technologyBefore.detectedStack
    || artifact.locatorMode !== technologyBefore.locatorMode
  );
  if (runtimeChanged) {
    try {
      artifact = await startArtifact(artifactId);
    } catch (error) {
      runtimeWarning = error instanceof Error ? error.message : "技术栈切换后预览重启失败";
    }
  }
  response.json({
    reply,
    sessionId,
    artifactId,
    artifact,
    runtimeWarning,
    changed: mutation.changed,
    checkpoint: mutation.checkpoint,
    checkpoints: mutation.checkpoints,
    checkpointState: mutation.state,
  });
}));

if (IS_PRODUCTION) {
  app.use(express.static(WEB_DIST_ROOT, { index: false }));
  app.use((request, response, next) => {
    if (request.method === "GET" && !request.path.startsWith("/api/")) {
      response.sendFile(path.join(WEB_DIST_ROOT, "index.html"));
      return;
    }
    next();
  });
}

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "接口不存在" });
});

app.use((error, _request, response, _next) => {
  const bodyError = error?.type === "entity.too.large" || error instanceof SyntaxError;
  response.status(bodyError ? 400 : 502).json({
    error: error instanceof Error ? error.message : "接口服务调用失败",
  });
});

const server = createServer(app);
server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (SANDBOX_PROXY_PATTERN.test(pathname)) {
    proxySandboxUpgrade(request, socket, head);
    return;
  }
  socket.destroy();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Artifact 接口服务已启动：http://localhost:${PORT}`);
});
