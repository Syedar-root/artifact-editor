import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { SandboxClient } from "@agent-infra/sandbox";
import { fixture as sandboxFixture } from "../../../packages/sdk/test/server/fixtures.js";
import { ArtifactWorkspace } from "../src/modules/artifacts/models/artifact-workspace.model.js";
import { BuildService } from "../src/modules/artifacts/services/build.service.js";
import { ServerConfigService } from "../src/config/server-config.service.js";
import { createApplication } from "../src/main.js";
import { ChatService } from "../src/modules/agent/services/chat.service.js";

const local = (value: string) =>
  process.platform === "win32"
    ? value.replace(
        /^\/([a-z])(?=\/)/u,
        (_, drive) => `${drive.toUpperCase()}:`,
      )
    : value;

async function fixture(context) {
  const value = await sandboxFixture(context);
  const workspace = new ArtifactWorkspace({
    root: value.root,
    files: value.sandbox,
    execute: (command, options) => value.sandbox.bash(command, options),
  });
  await workspace.files.write("index.html", "V1");
  await workspace.versions.initialize();
  const checkpoint = (await workspace.versions.list())[0];
  const releaseRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "artifact-build-test-"),
  );
  context.after(() => fs.rm(releaseRoot, { recursive: true, force: true }));
  const state = {
    unavailable: false,
    fail: false,
    builds: 0,
    downloads: 0,
    gate: Promise.resolve(),
    cleanupFail: false,
  };
  const client = new SandboxClient({
    environment: "http://sandbox.test",
    baseUrl: "http://sandbox.test",
    maxRetries: 0,
    fetch: async (input, init) => {
      if (state.unavailable) throw new Error("sandbox expired");
      const url = new URL(String(input));
      const request = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.pathname.endsWith("/glob")) {
        const files = await fs.readdir(local(request.path), {
          recursive: true,
        });
        const entries = [];
        for (const file of files)
          if ((await fs.stat(path.join(local(request.path), file))).isFile())
            entries.push({
              path: request.path + "/" + file.replaceAll("\\", "/"),
            });
        return Response.json({ success: true, data: { files: entries } });
      }
      if (url.pathname.endsWith("/download")) {
        state.downloads++;
        return new Response(
          await fs.readFile(local(url.searchParams.get("path")!)),
        );
      }
      throw new Error(url.pathname);
    },
  });
  const commands = {
    run: async (command, options) => {
      if (state.cleanupFail && command.startsWith("'rm' '-rf'"))
        throw new Error("sandbox expired during cleanup");
      if (command.startsWith("'npm' 'run' 'build'")) {
        state.builds++;
        await state.gate;
        if (state.fail)
          return {
            stdout: "",
            stderr: "build failed",
            exitCode: 1,
            truncated: false,
          };
        const outDir = /'--outDir=([^']+)'/u.exec(command)![1];
        await fs.mkdir(path.join(local(outDir), "assets"), { recursive: true });
        // 读取导出的提交，不能混入当前编辑目录的下一轮修改。
        const source = await fs.readFile(
          path.join(local(options.cwd), "index.html"),
          "utf8",
        );
        await fs.writeFile(path.join(local(outDir), "index.html"), source);
        await fs.writeFile(
          path.join(local(outDir), "assets", "image.png"),
          Buffer.from([0, 255, 1, 128]),
        );
        return { stdout: "built", stderr: "", exitCode: 0, truncated: false };
      }
      return value.sandbox.bash(command, options);
    },
  };
  const dependencies = {
    ensure: async (_root, options) => {
      assert.equal(options.mode, "restore");
      assert.equal(options.persistLock, false);
    },
  };
  const config = {
    releaseRoot,
    dependencyRoot: value.root + "/fast",
    buildRoot: value.root + "/builds",
  };
  const build = new BuildService(
    client,
    commands as any,
    { forArtifact: () => workspace } as any,
    dependencies as any,
    config as any,
  );
  context.after(() => build.onModuleDestroy());
  return {
    ...value,
    workspace,
    checkpoint,
    build,
    config,
    state,
    commands,
    client,
    dependencies,
  };
}

test("固定提交构建、同版本请求合并、二进制资源完整且成功结果可离线复用", async (context) => {
  const { workspace, checkpoint, build, state, config } =
    await fixture(context);
  await workspace.edit({}, (current) =>
    current.files.write("index.html", "V2"),
  );
  const first = build.ensure("test-artifact", checkpoint);
  assert.equal(build.ensure("test-artifact", checkpoint), first);
  const record = await first;
  assert.equal(record.status, "ready");
  const directory = path.join(
    config.releaseRoot,
    "test-artifact",
    checkpoint.commitSha,
    "files",
  );
  assert.equal(
    await fs.readFile(path.join(directory, "index.html"), "utf8"),
    "V1",
  );
  assert.deepEqual(
    await fs.readFile(path.join(directory, "assets/image.png")),
    Buffer.from([0, 255, 1, 128]),
  );
  assert.equal(state.builds, 1);
  state.unavailable = true;
  assert.deepEqual(await build.ensure("test-artifact", checkpoint), record);
  assert.equal(state.downloads, 2);
});

test("新版本构建失败保留源码版本和旧资源，可重试且不会遗留半成品目录", async (context) => {
  const { workspace, checkpoint, build, state, config, root } =
    await fixture(context);
  const old = await build.ensure("test-artifact", checkpoint);
  const mutation = await workspace.edit({}, (current) =>
    current.files.write("index.html", "V2"),
  );
  state.fail = true;
  await assert.rejects(
    build.ensure("test-artifact", mutation.checkpoint!),
    /build failed/u,
  );
  assert.equal(
    (await build.status("test-artifact", mutation.checkpoint!.commitSha))
      ?.status,
    "failed",
  );
  assert.equal((await workspace.versions.list()).length, 2);
  assert.equal(
    await fs.readFile(
      path.join(
        config.releaseRoot,
        "test-artifact",
        old.commitSha,
        "files/index.html",
      ),
      "utf8",
    ),
    "V1",
  );
  state.fail = false;
  assert.equal(
    (await build.ensure("test-artifact", mutation.checkpoint!)).status,
    "ready",
  );
  assert.deepEqual(await fs.readdir(local(root + "/builds")), []);
  assert.ok(
    !(await fs.readdir(config.releaseRoot)).some((entry) =>
      entry.startsWith(".build-"),
    ),
  );
});

test("持久化完成后沙箱失效不撤销成功构建或阻断分享", async (context) => {
  const { build, checkpoint, state } = await fixture(context);
  state.cleanupFail = true;
  const record = await build.ensure("test-artifact", checkpoint);
  assert.equal(record.status, "ready");
  assert.equal(
    (await build.status("test-artifact", checkpoint.commitSha))?.status,
    "ready",
  );
});

test("保存 Agent 修改后立即返回，后台构建完成再更新持久化状态", async (context) => {
  const { workspace, build, state } = await fixture(context);
  let release;
  state.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  context.after(() => release());
  const artifact = {
    id: "test-artifact",
    detectedStack: "html",
    locatorMode: "runtime-hint",
  };
  const artifacts = {
    exists: async () => true,
    require: async () => artifact,
    get: async () => artifact,
    initialize: async () => {},
    ensureReady: async () => workspace,
    scheduleBuild: (id, checkpoint) => build.schedule(id, checkpoint),
  };
  const runtime = {
    run: async (_prompt, options) => {
      await options.tools.files.write("index.html", "Agent V2");
      return "完成";
    },
  };
  const tools = {
    forWorkspace: (current) => ({ files: current.files }),
    prompt: () => "test",
  };
  const chat = new ChatService(
    artifacts as any,
    {} as any,
    runtime as any,
    tools as any,
  );
  const reply = await chat.send({ message: "修改", artifactId: artifact.id });
  assert.equal(reply.reply, "完成");
  assert.equal(reply.build?.status, "queued");
  assert.equal(reply.checkpoint?.version, 2);
  release();
  assert.equal(
    (await build.ensure(artifact.id, reply.checkpoint!)).status,
    "ready",
  );
});

test("静态页面与资源不访问沙箱，Server 重启后仍可读取，路径不能访问其他文件", async (context) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "artifact-published-test-"),
  );
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const sha = "a".repeat(40);
  const directory = path.join(root, "test-artifact", sha);
  await fs.mkdir(path.join(directory, "files/assets"), { recursive: true });
  await fs.writeFile(
    path.join(directory, "files/index.html"),
    "<h1>持久页面</h1>",
  );
  await fs.writeFile(
    path.join(directory, "files/assets/image.png"),
    Buffer.from([0, 255, 2]),
  );
  await fs.writeFile(
    path.join(directory, "build.json"),
    JSON.stringify({
      artifactId: "test-artifact",
      version: 1,
      commitSha: sha,
      status: "ready",
    }),
  );
  for (let restart = 0; restart < 2; restart++) {
    const app = await createApplication({ logger: false, production: true });
    Object.assign(app.get(ServerConfigService), { releaseRoot: root });
    const client = app.get(SandboxClient);
    client.bash.exec = async () => {
      throw new Error("sandbox expired");
    };
    await app.listen(0, "127.0.0.1");
    try {
      const url = `${await app.getUrl()}/published/test-artifact/${sha}/`;
      assert.equal(
        await fetch(url).then((response) => response.text()),
        "<h1>持久页面</h1>",
      );
      const image = await fetch(url + "assets/image.png");
      assert.equal(image.status, 200);
      assert.match(image.headers.get("content-type")!, /image\/png/u);
      assert.deepEqual(
        Buffer.from(await image.arrayBuffer()),
        Buffer.from([0, 255, 2]),
      );
      assert.equal((await fetch(url + "missing.js")).status, 404);
      assert.notEqual((await fetch(url + "%2e%2e%2fbuild.json")).status, 200);
    } finally {
      await app.close();
    }
  }
});
