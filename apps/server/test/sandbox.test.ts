import assert from "node:assert/strict";
import test from "node:test";
import { SandboxClient } from "@agent-infra/sandbox";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { SandboxCommandService } from "../dist/infrastructure/sandbox/services/sandbox-command.service.js";
import { ArtifactFilesystemService } from "../dist/modules/artifacts/services/artifact-filesystem.service.js";
import { ArtifactTemplateService } from "../dist/modules/artifacts/services/artifact-template.service.js";
import { PreviewService } from "../dist/modules/artifacts/services/preview.service.js";

/** 使用官方 SDK 的 fetch seam，检查真实 HTTP 协议而非私有实现。 */
function fixture(
  handler: (path: string, request: Record<string, any>) => unknown,
) {
  const calls: { path: string; request: Record<string, any> }[] = [];
  const client = new SandboxClient({
    environment: "http://sandbox.test",
    baseUrl: "http://sandbox.test",
    maxRetries: 0,
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      const request = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ path, request });
      const body = await handler(path, request);
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const commands = new SandboxCommandService(client);
  return {
    client,
    commands,
    files: new ArtifactFilesystemService(
      client,
      commands,
      new ArtifactTemplateService(),
    ),
    calls,
  };
}
const success = (data: unknown) => ({ success: true, data });

test("SDK 命令适配：增量 stdout/stderr、退出码和 session 清理", async () => {
  let reads = 0;
  const { commands, calls } = fixture((path, request) => {
    if (path.endsWith("/create")) return success({ session_id: "s1" });
    if (path.endsWith("/exec"))
      return success({
        session_id: "s1",
        command_id: "c1",
        status: "running",
        stdout: null,
        stderr: null,
      });
    if (path.endsWith("/output")) {
      reads++;
      assert.equal(request.offset, reads === 1 ? 0 : 3);
      return success(
        reads === 1
          ? {
              stdout: "abc",
              stderr: "warn",
              offset: 3,
              stderr_offset: 4,
              command: { status: "running" },
            }
          : {
              stdout: "def",
              stderr: null,
              offset: 6,
              stderr_offset: 4,
              command: { status: "completed", exit_code: 7 },
            },
      );
    }
    if (path.endsWith("/close")) return success(null);
    throw new Error(path);
  });
  const output: string[] = [];
  assert.deepEqual(
    await commands.run("build", {
      cwd: "/workspace/a",
      onOutput: (_stream, content) => output.push(content),
    }),
    {
      stdout: "abcdef",
      stderr: "warn",
      exitCode: 7,
      truncated: false,
    },
  );
  assert.deepEqual(output, ["abc", "warn", "def"]);
  assert.ok(calls.at(-1)?.path.endsWith("/s1/close"));
});

test("SDK 文件错误：只有不存在可忽略，权限错误必须传播", async () => {
  const { files } = fixture((_path, request) => ({
    success: false,
    data: {
      error_type: request.file.includes("missing")
        ? "not_found"
        : "permission_denied",
      message: "文件访问失败",
    },
  }));
  assert.equal(await files.readOptional("/workspace/missing"), null);
  await assert.rejects(
    files.readOptional("/workspace/protected"),
    /文件访问失败/u,
  );
});

function previewFor(
  client: SandboxClient,
  sandboxBaseUrl = "http://sandbox.test",
) {
  const artifact = {
    id: "test",
    detectedStack: "html",
    locatorMode: "runtime-hint",
    previewUrl: "/absproxy/5173/",
  };
  return new PreviewService(
    client,
    { get: async () => artifact } as any,
    {
      initialize: async () => {},
      ensureReady: async () => ({
        root: "/workspace/test",
        prepareDependencies: async () => {},
        files: { write: async () => {} },
      }),
      forArtifact: () => ({ prepareDependencies: async () => {} }),
    } as any,
    { configurePreview: async () => {} } as any,
    { workspaceRoot: "/workspace", sandboxBaseUrl } as any,
  );
}

test("预览启动失败后关闭 SDK session，避免遗留进程", async () => {
  let created = false;
  const { client, calls } = fixture((path) => {
    if (path.endsWith("/sessions"))
      return success(created ? [{ session_id: "preview" }] : []);
    if (path.endsWith("/create")) {
      created = true;
      return success({ session_id: "preview" });
    }
    if (path.endsWith("/exec")) return { success: false, message: "无法启动" };
    if (path.endsWith("/close")) return success(null);
    throw new Error(path);
  });
  const preview = previewFor(client);
  await assert.rejects(preview.start("test"), /无法启动/u);
  await preview.onModuleDestroy();
  assert.equal(
    calls.filter((call) => call.path.endsWith("/preview/close")).length,
    1,
  );
});

test("预览通过 SDK 回收同名 session，启动成功后在关闭时清理", async (context) => {
  const sessionId = `artifact-preview-${createHash("sha256").update("/workspace").digest("hex").slice(0, 24)}`;
  const server = createServer((_request, response) => response.end("preview"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const { client, calls } = fixture((path, request) => {
    if (path.endsWith("/sessions"))
      return success([{ session_id: sessionId }, { session_id: "other-user" }]);
    if (path.endsWith("/close")) return success(null);
    if (path.endsWith("/create")) {
      assert.equal(request.session_id, sessionId);
      return success({ session_id: sessionId });
    }
    if (path.endsWith("/exec"))
      return success({
        session_id: sessionId,
        command_id: "c1",
        status: "running",
      });
    if (path.endsWith("/output"))
      return success({ command: { status: "running" } });
    throw new Error(path);
  });
  const preview = previewFor(
    client,
    `http://127.0.0.1:${(server.address() as { port: number }).port}`,
  );
  context.after(() => preview.onModuleDestroy());
  assert.equal((await preview.start("test")).id, "test");
  assert.deepEqual(
    calls
      .filter((call) => call.path.endsWith("/close"))
      .map((call) => call.path),
    [`/v1/bash/sessions/${sessionId}/close`],
  );
  await preview.onModuleDestroy();
  assert.equal(calls.filter((call) => call.path.endsWith("/close")).length, 2);
});
