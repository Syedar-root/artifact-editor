import assert from "node:assert/strict";
import test from "node:test";
import { createConnection } from "node:net";
import { createServer } from "node:http";
import { ServerConfigService } from "../dist/config/server-config.service.js";
import { createApplication } from "../dist/main.js";
import { ArtifactRepository } from "../dist/modules/artifacts/repositories/artifact.repository.js";
import { ChatService } from "../dist/modules/agent/services/chat.service.js";
import { WorkspaceService } from "../dist/modules/artifacts/services/workspace.service.js";
import { PreviewProxyService } from "../dist/infrastructure/sandbox/services/preview-proxy.service.js";

test("预览入口透传请求到配置的 AIO，兼容旧路径并覆盖端口控制头", async (context) => {
  const upstream = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          url: request.url,
          port: request.headers["x-aio-proxy-port"],
          auth: request.headers.authorization,
          body,
        }),
      );
    });
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  context.after(
    () =>
      new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const app = await createApplication({ logger: false });
  context.after(() => app.close());
  Object.assign(app.get(ServerConfigService), {
    sandboxBaseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`,
    sandboxToken: "test-sandbox-token",
  });
  await app.listen(0, "127.0.0.1");
  for (const prefix of ["proxy", "absproxy"]) {
    const response = await fetch(
      `${await app.getUrl()}/${prefix}/5173/assets?x=1`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-aio-proxy-port": "9999",
        },
        body: "{原始请求体}",
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      url: "/absproxy/5173/assets?x=1",
      port: "5173",
      auth: "Bearer test-sandbox-token",
      body: "{原始请求体}",
    });
  }
});

test("预览代理接收原始请求体，HMR 升级交给注入的代理服务", async (context) => {
  const app = await createApplication({ logger: false });
  await app.listen(0, "127.0.0.1");
  context.after(() => app.close());
  const base = await app.getUrl();
  const proxy = app.get(PreviewProxyService);
  proxy.request = (request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      response.status(200).send(body);
    });
  };
  const body = "{这不是 JSON，但预览代理应透传}";
  const response = await fetch(`${base}/proxy/5173/raw`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), body);
  proxy.upgrade = (request, socket, head) => {
    assert.equal(request.url, "/proxy/5173/hmr");
    socket.end(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n" +
        head.toString(),
    );
  };
  const result = await new Promise<string>((resolve, reject) => {
    const socket = createConnection({
      host: "127.0.0.1",
      port: Number(new URL(base).port),
    });
    let data = "";
    socket.setTimeout(3_000, () => {
      socket.destroy(new Error("HMR 升级超时"));
    });
    socket.on("connect", () =>
      socket.write(
        "GET /proxy/5173/hmr HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nhmr",
      ),
    );
    socket.on("data", (chunk) => {
      data += chunk;
    });
    socket.on("error", reject);
    socket.on("end", () => resolve(data));
  });
  assert.match(result, /^HTTP\/1\.1 101/u);
  assert.ok(result.endsWith("hmr"));
});

test("NestJS 服务保留健康检查、输入校验和统一 JSON 错误协议", async (context) => {
  const app = await createApplication({ logger: false });
  await app.listen(0, "127.0.0.1");
  context.after(() => app.close());
  const base = await app.getUrl();
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).agent, "dsh");
  for (const body of [
    "{}",
    "{",
    JSON.stringify({ message: "x".repeat(40 * 1024) }),
  ]) {
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, "string");
  }
  const missing = await fetch(`${base}/api/not-a-route`);
  assert.equal(missing.status, 404);
  assert.equal(typeof (await missing.json()).error, "string");

  const workspaces = app.get(WorkspaceService);
  const repository = app.get(ArtifactRepository);
  const originalCreate = repository.create;
  const originalGet = repository.get;
  context.after(() => {
    repository.create = originalCreate;
    repository.get = originalGet;
  });
  const operations = [];
  const artifact = {
    id: "test-artifact",
    name: "Test",
    detectedStack: "html",
    previewUrl: "/proxy/5173/",
  };
  repository.create = async (name, stack) => {
    assert.equal(name, "Test");
    assert.equal(stack, "html");
    operations.push("source");
    return artifact.id;
  };
  repository.get = async () => artifact;
  workspaces.forArtifact = () => ({
    prepareDependencies: async () => {
      operations.push("dependencies");
    },
  });
  workspaces.initialize = async () => {
    operations.push("checkpoint");
  };
  const request = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"name":"Test","technologyStack":"html"}',
  };
  const created = await fetch(`${base}/api/artifacts`, request);
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { artifact });
  assert.deepEqual(operations, ["source", "dependencies", "checkpoint"]);
  const progress = await fetch(`${base}/api/artifacts`, {
    ...request,
    headers: { ...request.headers, accept: "application/x-ndjson" },
  });
  assert.equal(progress.status, 200);
  assert.deepEqual((await progress.text()).trim().split("\n").map(JSON.parse), [
    { type: "progress", phase: "workspace" },
    { type: "progress", phase: "dependencies" },
    { type: "complete", artifact },
  ]);
  const chat = app.get(ChatService);
  chat.send = async () => ({ reply: "完成", sessionId: "test-session" });
  const reply = await fetch(`${base}/api/chat`, {
    ...request,
    body: '{"message":"Test"}',
  });
  assert.equal(reply.status, 200);
  assert.equal((await reply.json()).reply, "完成");
});
