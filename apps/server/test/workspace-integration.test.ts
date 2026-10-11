import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SandboxClient } from "@agent-infra/sandbox";
import { requireSuccess, shellCommand } from "@artifact-editor/sdk/server";
import { SandboxCommandService } from "../dist/infrastructure/sandbox/services/sandbox-command.service.js";
import { ArtifactFilesystemService } from "../dist/modules/artifacts/services/artifact-filesystem.service.js";
import { ArtifactTemplateService } from "../dist/modules/artifacts/services/artifact-template.service.js";
import { DependenciesService } from "../dist/modules/artifacts/services/dependencies.service.js";
import { WorkspaceService } from "../dist/modules/artifacts/services/workspace.service.js";
import { ArtifactsService } from "../dist/modules/artifacts/services/artifacts.service.js";
import { ServerConfigService } from "../dist/config/server-config.service.js";
import { createApplication } from "../dist/main.js";

const sandboxUrl = process.env.ARTIFACT_SANDBOX_TEST_URL;
const sandbox = () => {
  const client = new SandboxClient({
    environment: sandboxUrl!,
    baseUrl: sandboxUrl!,
    maxRetries: 0,
    headers: process.env.ARTIFACT_SANDBOX_TOKEN
      ? { Authorization: `Bearer ${process.env.ARTIFACT_SANDBOX_TOKEN}` }
      : undefined,
  });
  const commands = new SandboxCommandService(client);
  const files = new ArtifactFilesystemService(
    client,
    commands,
    new ArtifactTemplateService(),
  );
  return { client, commands, files };
};

test(
  "官方 SDK：文件搜索、目录树、唯一替换、路径约束与命令取消",
  { skip: !sandboxUrl },
  async (context) => {
    const remote = sandbox();
    const root = `/tmp/artifact-aio-files-${randomUUID()}`;
    requireSuccess(
      await remote.commands.run(shellCommand(["mkdir", "--", root])),
    );
    context.after(() =>
      remote.commands.run(shellCommand(["rm", "-rf", "--", root])),
    );
    await remote.files.write("src/中文 文件.txt", "你好\nworld\nworld", {
      cwd: root,
    });
    assert.equal(
      (await remote.files.read("src/中文 文件.txt", { cwd: root })).content,
      "你好\nworld\nworld",
    );
    assert.equal(
      (await remote.files.list(".", { cwd: root })).tree[0].children?.[0].path,
      "src/中文 文件.txt",
    );
    assert.deepEqual(
      (await remote.files.search("你好", { cwd: root })).matches,
      [{ path: "src/中文 文件.txt", line: 1, text: "你好" }],
    );
    await assert.rejects(
      remote.files.edit("src/中文 文件.txt", "world", "new", { cwd: root }),
      /多处/u,
    );
    await remote.files.edit("src/中文 文件.txt", "你好", "完成", { cwd: root });
    await assert.rejects(
      remote.files.read("../outside", { cwd: root }),
      /超出/u,
    );
    requireSuccess(
      await remote.commands.run(
        shellCommand(["ln", "-s", "--", "/etc", `${root}/outside`]),
      ),
    );
    await assert.rejects(
      remote.files.read("outside/passwd", { cwd: root }),
      /超出/u,
    );
    const limited = await remote.commands.run(
      "printf 123456789; printf error >&2",
      {
        cwd: root,
        maxOutputBytes: 4,
      },
    );
    assert.equal(limited.truncated, true);
    assert.equal(Buffer.byteLength(limited.stdout + limited.stderr), 4);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("取消测试")),
      300,
    );
    await assert.rejects(
      remote.commands.run("sleep 2; touch cancelled-command-finished", {
        cwd: root,
        signal: controller.signal,
      }),
      /取消测试/u,
    );
    clearTimeout(timer);
    await new Promise((resolve) => setTimeout(resolve, 2200));
    assert.equal(
      requireSuccess(
        await remote.commands.run("test ! -e cancelled-command-finished", {
          cwd: root,
        }),
      ).exitCode,
      0,
    );
  },
);

test(
  "官方 SDK + pnpm：依赖复用、安装失败和历史 lockfile 恢复",
  { skip: !sandboxUrl },
  async (context) => {
    const remote = sandbox(),
      directory = `/tmp/artifact-aio-deps-${randomUUID()}`;
    const root = `${directory}/nas`,
      store = `${directory}/ssd`;
    requireSuccess(
      await remote.commands.run(shellCommand(["mkdir", "-p", "--", root])),
    );
    context.after(() =>
      remote.commands.run(shellCommand(["rm", "-rf", "--", directory])),
    );
    const dependencies = new DependenciesService(
      remote.client,
      remote.commands,
      {
        dependencyRoot: store,
        packageManager: "pnpm",
      },
    );
    const manifest = (version: string) =>
      JSON.stringify({
        name: "test-artifact",
        version: "1.0.0",
        dependencies: { semver: version },
        scripts: { prepare: "exit 99" },
      });
    await remote.files.write(`${root}/package.json`, manifest("7.7.2"));
    const first = await dependencies.ensure(root);
    assert.ok("directory" in first);
    const lock = (await remote.files.read(`${root}/pnpm-lock.yaml`)).content;
    assert.equal((await dependencies.ensure(root)).cached, true);
    requireSuccess(
      await remote.commands.run(
        "test -L node_modules && ./node_modules/.bin/semver 1.2.3",
        { cwd: root },
      ),
    );
    await remote.files.write(
      `${root}/package.json`,
      manifest("version-that-does-not-exist"),
    );
    await assert.rejects(dependencies.ensure(root));
    assert.equal(
      (await remote.files.read(`${root}/pnpm-lock.yaml`)).content,
      lock,
    );
    assert.equal(
      requireSuccess(
        await remote.commands.run("readlink node_modules", { cwd: root }),
      ).stdout.trim(),
      first.directory,
    );
    await remote.files.write(`${root}/package.json`, manifest("7.7.2"));
    assert.equal((await dependencies.ensure(root)).directory, first.directory);
  },
);

test(
  "NestJS + 官方 SDK：HTML/React/Vue 创建、外置依赖、版本与预览",
  { skip: !sandboxUrl, timeout: 300_000 },
  async (context) => {
    const remote = sandbox(),
      directory = `/tmp/artifact-aio-app-${randomUUID()}`;
    const previousUrl = process.env.ARTIFACT_SANDBOX_URL;
    process.env.ARTIFACT_SANDBOX_URL = sandboxUrl;
    const app = await createApplication({ logger: false });
    if (previousUrl === undefined) delete process.env.ARTIFACT_SANDBOX_URL;
    else process.env.ARTIFACT_SANDBOX_URL = previousUrl;
    const config = app.get(ServerConfigService);
    const releaseRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "artifact-aio-releases-"),
    );
    Object.assign(config, {
      workspaceRoot: `${directory}/nas`,
      dependencyRoot: `${directory}/ssd`,
      packageManager: "pnpm",
      releaseRoot,
    });
    context.after(async () => {
      await app.close();
      await fs.rm(releaseRoot, { recursive: true, force: true });
      requireSuccess(
        await remote.commands.run(shellCommand(["rm", "-rf", "--", directory])),
      );
    });
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const json = async (url: string, options?: RequestInit) => {
      const response = await fetch(base + url, options);
      assert.ok(response.ok, await response.clone().text());
      return response.json();
    };
    for (const stack of ["html", "react", "vue"]) {
      const { artifact } = await json("/api/artifacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: `aio-${stack}`, technologyStack: stack }),
      });
      assert.equal(artifact.detectedStack, stack);
      const root = `${directory}/nas/${artifact.id}`;
      requireSuccess(
        await remote.commands.run("test -L node_modules", { cwd: root }),
      );
      const target = requireSuccess(
        await remote.commands.run("readlink node_modules", { cwd: root }),
      ).stdout.trim();
      assert.ok(target.startsWith(`${directory}/ssd/projects/`));
      const started = await json(`/api/artifacts/${artifact.id}/start`, {
        method: "POST",
      });
      assert.equal(
        started.artifact.locatorMode,
        stack === "html" ? "runtime-hint" : "code-inspector",
      );
      const preview = await fetch(base + artifact.previewUrl);
      assert.equal(preview.status, 200, await preview.clone().text());
      const file =
        stack === "react"
          ? "src/main.jsx"
          : stack === "vue"
            ? "src/App.vue"
            : "src/main.js";
      const transformed = await fetch(base + artifact.previewUrl + file);
      assert.equal(transformed.status, 200, await transformed.clone().text());
      const client = await fetch(
        base + artifact.previewUrl + "@vite/client",
      ).then((response) => response.text());
      const token = /\bwsToken\s*=\s*["']([^"']+)["']/u.exec(client)?.[1];
      assert.ok(token, "Vite 客户端应包含 HMR token");
      const socketUrl = new URL(artifact.previewUrl, base);
      socketUrl.protocol = "ws:";
      socketUrl.searchParams.set("token", token);
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(socketUrl, "vite-hmr");
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error("HMR 连接超时"));
        }, 5000);
        socket.addEventListener("message", (event) => {
          if (JSON.parse(String(event.data)).type === "connected") {
            clearTimeout(timer);
            socket.close();
            resolve();
          }
        });
        socket.addEventListener("error", () => {
          clearTimeout(timer);
          socket.close();
          reject(new Error("HMR 连接失败"));
        });
      });
      const release = await app.get(ArtifactsService).build(artifact.id, 1);
      assert.equal((await fetch(base + release.previewUrl)).status, 200);
      const versions = await json(`/api/artifacts/${artifact.id}/checkpoints`);
      assert.equal(versions.state.dirty, false);
      assert.equal(versions.checkpoints.length, 1);
    }
    assert.equal((await json("/api/artifacts")).artifacts.length, 3);
  },
);
