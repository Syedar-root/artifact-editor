import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { requireSuccess, shellCommand } from "@artifact-editor/sdk/server";
import { createApplication } from "../dist/main.js";
import { ServerConfigService } from "../dist/config/server-config.service.js";
import { SandboxCommandService } from "../dist/infrastructure/sandbox/services/sandbox-command.service.js";
import { ArtifactsService } from "../dist/modules/artifacts/services/artifacts.service.js";

const docker = promisify(execFile);
const repository = path.resolve(import.meta.dirname, "../../..");

// 显式开启才停止/启动专用 mock-nas 容器；不操作用户的其他沙箱。
test(
  "mock NAS：源码和分享持久化、沙箱失效后严格恢复依赖与 HMR",
  {
    skip: process.env.ARTIFACT_NAS_TEST !== "1",
    timeout: 360_000,
  },
  async (context) => {
    const prefix = `lifecycle-${randomUUID()}`;
    const nas = path.join(repository, "mock-nas");
    const source = path.join(nas, "artifacts", prefix);
    const releases = path.join(nas, "releases", prefix);
    for (const directory of [source, releases]) {
      assert.ok(directory.startsWith(nas + path.sep));
      await fs.mkdir(directory, { recursive: true });
    }
    const compose = (action: string) =>
      docker(
        "docker",
        [
          "compose",
          "-f",
          path.join(repository, "compose.sandbox.yaml"),
          action,
          "sandbox",
        ],
        {
          cwd: repository,
          windowsHide: true,
          timeout: 90_000,
        },
      );
    const previous = process.env.ARTIFACT_SANDBOX_URL;
    process.env.ARTIFACT_SANDBOX_URL = "http://127.0.0.1:18081";
    let app;
    try {
      app = await createApplication({ logger: false });
    } finally {
      if (previous === undefined) delete process.env.ARTIFACT_SANDBOX_URL;
      else process.env.ARTIFACT_SANDBOX_URL = previous;
    }
    const config = app.get(ServerConfigService);
    Object.assign(config, {
      workspaceRoot: `/workspace/${prefix}`,
      dependencyRoot: "/opt/artifact-dependencies",
      releaseRoot: releases,
      packageManager: "pnpm",
    });
    const commands = app.get(SandboxCommandService);
    const artifacts = app.get(ArtifactsService);
    let stopped = false;
    context.after(async () => {
      if (stopped) await compose("start");
      await app.close();
      for (const directory of [source, releases]) {
        assert.ok(directory.startsWith(nas + path.sep));
        await fs.rm(directory, { recursive: true, force: true });
      }
    });
    const ready = async () => {
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          requireSuccess(
            await commands.run("node --version", { timeoutMs: 3000 }),
          );
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      throw new Error("模拟沙箱启动超时");
    };
    await ready();
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const json = async (url: string, options?: RequestInit) => {
      const response = await fetch(base + url, options);
      assert.ok(response.ok, await response.clone().text());
      return response.json();
    };
    const artifact = await artifacts.create("NAS lifecycle", "html");
    const workspace = artifacts.workspace(artifact!.id);
    const first = await artifacts.build(artifact!.id, 1);
    assert.equal(first.status, "ready");
    const original = (await workspace.files.read("index.html")).content;
    const mutation = await workspace.edit({}, (current) =>
      current.files.write(
        "index.html",
        original.replace("NAS lifecycle", "NAS version two"),
      ),
    );
    artifacts.scheduleBuild(artifact!.id, mutation.checkpoint!);
    const second = await artifacts.build(artifact!.id, 2);
    assert.equal(second.status, "ready");
    const historical = await json(
      `/api/artifacts/${artifact!.id}/checkpoints/1/preview`,
      { method: "POST" },
    );
    assert.equal(historical.state.mode, "historical-preview");
    assert.equal(historical.artifact.previewUrl, first.previewUrl);
    assert.equal(
      (await workspace.versions.status()).activeVersion,
      2,
      "浏览历史不能改变工作区 HEAD",
    );
    const code = await json(
      `/api/sandbox/file?artifactId=${artifact!.id}&version=1&path=index.html`,
    );
    assert.equal(code.content, original);
    await artifacts.start(artifact!.id);
    assert.equal((await fetch(base + artifact!.previewUrl)).status, 200);
    const target = requireSuccess(
      await workspace.execute("readlink node_modules"),
    ).stdout.trim();
    assert.ok(target.startsWith(config.dependencyRoot + "/projects/"));
    const host = path.join(source, artifact!.id);
    const hash = async (file: string) =>
      createHash("sha256")
        .update(await fs.readFile(path.join(host, file)))
        .digest("hex");
    const before = await Promise.all([
      hash("package.json"),
      hash("pnpm-lock.yaml"),
      hash("index.html"),
    ]);

    await compose("stop");
    stopped = true;
    assert.equal(
      (await fetch(base + first.previewUrl)).status,
      200,
      "沙箱离线时旧分享仍可访问",
    );
    assert.match(
      await fetch(base + second.previewUrl).then((response) => response.text()),
      /NAS version two/u,
    );
    assert.equal(
      (
        await json(`/api/artifacts/${artifact!.id}/share`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: 1 }),
        })
      ).url,
      first.previewUrl,
      "准备已构建版本的分享不依赖沙箱",
    );
    await compose("start");
    stopped = false;
    await ready();
    requireSuccess(
      await commands.run(shellCommand(["test", "!", "-e", target])),
    );
    assert.deepEqual(
      await Promise.all([
        hash("package.json"),
        hash("pnpm-lock.yaml"),
        hash("index.html"),
      ]),
      before,
    );
    await artifacts.start(artifact!.id);
    requireSuccess(
      await workspace.execute(
        "test -L node_modules && test -x node_modules/.bin/vite",
      ),
    );
    assert.deepEqual(
      await Promise.all([
        hash("package.json"),
        hash("pnpm-lock.yaml"),
        hash("index.html"),
      ]),
      before,
      "恢复不允许改写 NAS 源码及 lockfile",
    );
    assert.equal((await workspace.versions.list()).length, 2);
    const live = await fetch(base + artifact!.previewUrl);
    assert.equal(live.status, 200);
    assert.match(await live.text(), /NAS version two/u);
    const client = await fetch(
      base + artifact!.previewUrl + "@vite/client",
    ).then((response) => response.text());
    const token = /\bwsToken\s*=\s*["']([^"']+)["']/u.exec(client)?.[1];
    assert.ok(token);
    const socketUrl = new URL(artifact!.previewUrl, base);
    socketUrl.protocol = "ws:";
    socketUrl.searchParams.set("token", token);
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(socketUrl, "vite-hmr");
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("恢复后的 HMR 超时"));
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
        reject(new Error("恢复后的 HMR 连接失败"));
      });
    });
    assert.equal((await fetch(base + first.previewUrl)).status, 200);
  },
);
