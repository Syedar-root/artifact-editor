import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fixture as sandboxFixture } from "../../../packages/sdk/test/server/fixtures.js";
import { DependenciesService } from "../dist/modules/artifacts/services/dependencies.service.js";
import type { SandboxClient } from "@agent-infra/sandbox";
import type { SandboxCommandService } from "../src/infrastructure/sandbox/services/sandbox-command.service.js";

// 对远端文件/命令接口使用本地替身，测试直接穿过 ensure()。
const localPath = (value: string) =>
  process.platform === "win32"
    ? value.replace(
        /^\/([a-z])(?=\/)/u,
        (_, drive) => drive.toUpperCase() + ":",
      )
    : value;
const remotePath = (value: string) =>
  process.platform === "win32"
    ? value
        .replaceAll("\\", "/")
        .replace(/^([A-Za-z]):/u, (_, drive) => "/" + drive.toLowerCase())
    : value;

class LocalDependenciesSandbox {
  constructor(
    private readonly execution,
    private readonly install?,
  ) {}
  async readOptional(file: string) {
    try {
      const content = await fs.readFile(localPath(file), "utf8");
      return { content };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async write(file: string, content: string) {
    await fs.mkdir(path.dirname(localPath(file)), { recursive: true });
    await fs.writeFile(localPath(file), content);
  }
  async bash(command: string, options = {}) {
    const parts = [...command.matchAll(/'([^']*)'/gu)].map((match) => match[1]);
    if (process.platform === "win32") {
      // MSYS ln 默认复制目录；用真正的 Windows junction 模拟 Linux symlink。
      if (parts[0] === "ln") {
        await fs.symlink(
          localPath(parts.at(-2)),
          localPath(parts.at(-1)),
          "junction",
        );
        return { stdout: "", stderr: "", exitCode: 0, truncated: false };
      }
      if (parts[0] === "mv") {
        const from = localPath(parts.at(-2)),
          to = localPath(parts.at(-1));
        try {
          if ((await fs.lstat(to)).isSymbolicLink()) await fs.unlink(to);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        await fs.rename(from, to);
        return { stdout: "", stderr: "", exitCode: 0, truncated: false };
      }
      if (parts[0] === "test" && parts[1] === "-L") {
        let symbolic = false;
        try {
          symbolic = (await fs.lstat(localPath(parts[2]))).isSymbolicLink();
        } catch {}
        return {
          stdout: "",
          stderr: "",
          exitCode: symbolic ? 0 : 1,
          truncated: false,
        };
      }
    }
    const manager = /^'(npm|pnpm)' /u.exec(command)?.[1];
    if (manager && this.install) {
      const args = [...command.matchAll(/'([^']*)'/gu)]
        .map((match) => match[1])
        .slice(1);
      return this.install(manager, args, options);
    }
    return this.execution.bash(command, options);
  }
}

async function installer(
  root: string,
  store: string,
  extra = {},
  execution?,
  install?,
) {
  const remote = new LocalDependenciesSandbox(execution, install);
  const success = (data) => ({ ok: true, body: { success: true, data } });
  const client = {
    file: {
      readFile: async ({ file }) => {
        const result = await remote.readOptional(file);
        return result
          ? success(result)
          : {
              ok: true,
              body: { success: false, data: { error_type: "not_found" } },
            };
      },
      writeFile: async ({ file, content }) => {
        await remote.write(file, content);
        return success(null);
      },
    },
  } as unknown as SandboxClient;
  const service = new DependenciesService(
    client,
    {
      run: (command, options) => remote.bash(command, options),
    } as SandboxCommandService,
    { dependencyRoot: store, packageManager: extra.packageManager ?? "npm" },
  );
  return service.ensure(root, extra);
}

async function fixture(context) {
  const {
    sandbox: execution,
    localRoot,
    root: fixtureRoot,
  } = await sandboxFixture(context);
  const root = path.posix.join(fixtureRoot, "nas", "artifact"),
    store = path.posix.join(fixtureRoot, "ssd");
  const log = localPath(path.posix.join(fixtureRoot, "installs.jsonl"));
  await fs.mkdir(localPath(root), { recursive: true });
  const manifest = async (version) =>
    fs.writeFile(
      localPath(root + "/package.json"),
      JSON.stringify({
        name: "test-artifact",
        version: "1.0.0",
        dependencies: { example: version },
        scripts: { build: "vite build", prepare: "must-not-run-in-staging" },
      }),
    );
  const install = async (command, args, options) => {
    options.signal?.throwIfAborted();
    if (args[0] === "--version")
      return { stdout: "11.18.0\n", stderr: "", exitCode: 0, truncated: false };
    const cwd = localPath(options.cwd),
      pkg = JSON.parse(
        await fs.readFile(path.join(cwd, "package.json"), "utf8"),
      );
    assert.equal(
      pkg.scripts,
      undefined,
      "root lifecycle scripts leaked into staging",
    );
    assert.ok(
      options.cwd.startsWith(store + "/"),
      "installer must run on fast storage",
    );
    if (command === "npm" && args[0] === "ci") {
      const lock = JSON.parse(
        await fs.readFile(path.join(cwd, "package-lock.json"), "utf8"),
      );
      if (
        JSON.stringify(lock.packages?.[""].dependencies) !==
        JSON.stringify(pkg.dependencies)
      )
        return {
          stdout: "",
          stderr: "lockfile does not match manifest",
          exitCode: 1,
          truncated: false,
        };
    }
    await fs.appendFile(
      log,
      JSON.stringify({ command, args, cwd: options.cwd }) + "\n",
    );
    if (pkg.dependencies.example === "fail")
      return {
        stdout: "",
        stderr: "installation failed",
        exitCode: 1,
        truncated: false,
      };
    await fs.mkdir(path.join(cwd, "node_modules", "example"), {
      recursive: true,
    });
    for (const name of Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    }))
      await fs.mkdir(path.join(cwd, "node_modules", ...name.split("/")), {
        recursive: true,
      });
    await fs.writeFile(
      path.join(cwd, "node_modules", "example", "version"),
      pkg.dependencies.example,
    );
    if (command === "pnpm")
      await fs.writeFile(
        path.join(cwd, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\n# " + JSON.stringify(pkg.dependencies),
      );
    else
      await fs.writeFile(
        path.join(cwd, "package-lock.json"),
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": {
              dependencies: pkg.dependencies,
              devDependencies: pkg.devDependencies,
            },
          },
        }),
      );
    return { stdout: "", stderr: "", exitCode: 0, truncated: false };
  };
  const run = (extra = {}) =>
    installer(root, extra.store ?? store, extra, execution, install);
  return { root, store, log, manifest, run };
}

test("依赖在快速存储安装与复用；清单变化和历史回退选择对应依赖", async (context) => {
  const { root, store, log, manifest, run } = await fixture(context);
  await manifest("1.0.0");
  const first = await run();
  assert.ok(first.directory.startsWith(store + "/"));
  assert.ok(
    (
      await fs.lstat(path.join(localPath(root), "node_modules"))
    ).isSymbolicLink(),
  );
  assert.equal(
    await fs.readFile(
      path.join(localPath(root), "node_modules/example/version"),
      "utf8",
    ),
    "1.0.0",
  );
  const originalLock = await fs.readFile(
    path.join(localPath(root), "package-lock.json"),
    "utf8",
  );
  assert.equal((await run()).cached, true);
  await manifest("2.0.0");
  const second = await run();
  assert.notEqual(second.directory, first.directory);
  assert.equal(
    await fs.readFile(
      path.join(localPath(root), "node_modules/example/version"),
      "utf8",
    ),
    "2.0.0",
  );
  const installs = (await fs.readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(installs.length, 2);
  assert.equal(
    installs[1].args[0],
    "install",
    "changed manifest must update a stale lockfile instead of using npm ci",
  );
  await manifest("1.0.0");
  await fs.writeFile(
    path.join(localPath(root), "package-lock.json"),
    originalLock,
  );
  assert.deepEqual(await run(), { directory: first.directory, cached: true });
  assert.equal((await fs.readFile(log, "utf8")).trim().split("\n").length, 2);
});

test("安装失败保留当前依赖链接与 lockfile，拒绝依赖落入产物目录", async (context) => {
  const { root, manifest, run } = await fixture(context);
  await manifest("1.0.0");
  await run();
  const link = await fs.readlink(path.join(localPath(root), "node_modules"));
  const lock = await fs.readFile(
    path.join(localPath(root), "package-lock.json"),
    "utf8",
  );
  await manifest("fail");
  await assert.rejects(() => run(), /installation failed/u);
  assert.equal(
    await fs.readlink(path.join(localPath(root), "node_modules")),
    link,
  );
  assert.equal(
    await fs.readFile(path.join(localPath(root), "package-lock.json"), "utf8"),
    lock,
  );
  await assert.rejects(
    () => run({ store: path.posix.join(root, "deps") }),
    /分离/u,
  );
});

test("既有实体依赖迁移到快速存储，预览插件不改变版本化清单", async (context) => {
  const { root, store, manifest, run } = await fixture(context);
  await manifest("1.0.0");
  await fs.mkdir(path.join(localPath(root), "node_modules"));
  await fs.writeFile(
    path.join(localPath(root), "node_modules", "legacy-file"),
    "keep me",
  );
  const original = await fs.readFile(
    path.join(localPath(root), "package.json"),
    "utf8",
  );
  const result = await run({
    packages: ["code-inspector-plugin"],
    persistLock: false,
  });
  const project = path.dirname(path.dirname(localPath(result.directory)));
  const legacy = (await fs.readdir(project)).find((name) =>
    name.startsWith("legacy-"),
  );
  assert.ok(remotePath(project).startsWith(store + "/"));
  assert.equal(
    await fs.readFile(path.join(project, legacy, "legacy-file"), "utf8"),
    "keep me",
  );
  assert.equal(
    await fs.readFile(path.join(localPath(root), "package.json"), "utf8"),
    original,
  );
  await assert.rejects(
    fs.stat(path.join(localPath(root), "package-lock.json")),
    {
      code: "ENOENT",
    },
  );
  assert.equal(
    (await run({ packages: ["code-inspector-plugin"], persistLock: false }))
      .cached,
    true,
  );
});

test("真实 npm 在独立目录生成 lockfile，产物目录保留可用链接", async (context) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "artifact-real-npm-"),
  );
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "source");
  const store = path.join(directory, "dependencies");
  await fs.mkdir(root);
  await fs.writeFile(
    path.join(localPath(root), "package.json"),
    JSON.stringify({ name: "empty-artifact", version: "1.0.0" }),
  );
  await installer(
    remotePath(root),
    remotePath(store),
    {},
    (await sandboxFixture(context)).sandbox,
  );
  assert.ok(
    (
      await fs.lstat(path.join(localPath(root), "node_modules"))
    ).isSymbolicLink(),
  );
  assert.ok(
    JSON.parse(
      await fs.readFile(
        path.join(localPath(root), "package-lock.json"),
        "utf8",
      ),
    ).lockfileVersion,
  );
});

test("pnpm 清单识别、lockfile 更新、历史缓存复用和失败恢复", async (context) => {
  const { root, store, log, manifest, run } = await fixture(context);
  await manifest("1.0.0");
  const first = await run({ packageManager: "pnpm" });
  const lock = await fs.readFile(
    path.join(localPath(root), "pnpm-lock.yaml"),
    "utf8",
  );
  assert.ok(first.directory.startsWith(store + "/"));
  await assert.rejects(
    fs.stat(path.join(localPath(root), "package-lock.json")),
    {
      code: "ENOENT",
    },
  );
  // Once the pnpm lockfile exists, it wins over the host's fallback manager.
  assert.equal((await run({ packageManager: "npm" })).cached, true);
  await manifest("2.0.0");
  const second = await run();
  assert.notEqual(second.directory, first.directory);
  assert.match(
    await fs.readFile(path.join(localPath(root), "pnpm-lock.yaml"), "utf8"),
    /2\.0\.0/u,
  );
  const installs = (await fs.readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(installs.length, 2);
  assert.ok(
    installs.every(
      (item) =>
        item.command.startsWith("pnpm") &&
        item.args.includes("--no-frozen-lockfile"),
    ),
  );
  assert.ok(
    installs[0].args.includes(
      "--config.store-dir=" + path.posix.join(store, "pnpm-store"),
    ),
  );
  const link = await fs.readlink(path.join(localPath(root), "node_modules"));
  const secondLock = await fs.readFile(
    path.join(localPath(root), "pnpm-lock.yaml"),
    "utf8",
  );
  await manifest("fail");
  await assert.rejects(() => run(), /installation failed/u);
  assert.equal(
    await fs.readlink(path.join(localPath(root), "node_modules")),
    link,
  );
  assert.equal(
    await fs.readFile(path.join(localPath(root), "pnpm-lock.yaml"), "utf8"),
    secondLock,
  );
  await manifest("1.0.0");
  await fs.writeFile(path.join(localPath(root), "pnpm-lock.yaml"), lock);
  assert.equal((await run()).directory, first.directory);
  assert.equal((await run()).cached, true);
});

test("pnpm 导入已有 npm lockfile；预览附加依赖不改写源清单", async (context) => {
  const { root, log, manifest, run } = await fixture(context);
  await manifest("1.0.0");
  await run();
  const packagePath = path.join(localPath(root), "package.json");
  const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"));
  pkg.packageManager = "pnpm@11.18.0";
  await fs.writeFile(packagePath, JSON.stringify(pkg));
  const packageText = await fs.readFile(packagePath, "utf8");
  await run();
  const steps = (await fs.readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(
    steps.map((item) => item.args[0]),
    ["install", "import", "install"],
  );
  assert.equal((await run()).cached, true);
  const lock = await fs.readFile(
    path.join(localPath(root), "pnpm-lock.yaml"),
    "utf8",
  );
  await run({ packages: ["code-inspector-plugin"], persistLock: false });
  assert.equal(await fs.readFile(packagePath, "utf8"), packageText);
  assert.equal(
    await fs.readFile(path.join(localPath(root), "pnpm-lock.yaml"), "utf8"),
    lock,
  );
  pkg.packageManager = "pnpm@10.0.0";
  await fs.writeFile(packagePath, JSON.stringify(pkg));
  await assert.rejects(() => run(), /产物要求 pnpm@10\.0\.0/u);
});

test("真实 pnpm 在快速存储共享包内容，移动安装目录后链接与 CLI 仍可用", async (context) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "artifact-real-pnpm-"),
  );
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const version = spawnSync(command, ["--version"], {
    cwd: directory,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (version.error?.code === "ENOENT" || version.status !== 0) {
    context.skip("需要已安装 pnpm");
    return;
  }
  const store = path.join(directory, "ssd");
  const roots = [
    path.join(directory, "nas", "a"),
    path.join(directory, "nas", "b"),
  ];
  for (const root of roots) {
    await fs.mkdir(root, { recursive: true });
    const manifest = {
      name: "pnpm-artifact",
      version: "1.0.0",
      dependencies: { semver: "7.7.2" },
      scripts: { prepare: "exit 99" },
    };
    if (root === roots[0]) {
      await fs.writeFile(
        path.join(localPath(root), "package.json"),
        JSON.stringify(manifest),
      );
      await installer(
        remotePath(root),
        remotePath(store),
        {},
        (await sandboxFixture(context)).sandbox,
      );
      assert.ok(
        JSON.parse(
          await fs.readFile(
            path.join(localPath(root), "package-lock.json"),
            "utf8",
          ),
        ).lockfileVersion,
      );
    }
    await fs.writeFile(
      path.join(localPath(root), "package.json"),
      JSON.stringify({
        ...manifest,
        packageManager: `pnpm@${version.stdout.trim()}`,
      }),
    );
    await installer(
      remotePath(root),
      remotePath(store),
      {},
      (await sandboxFixture(context)).sandbox,
    );
    assert.ok(
      (
        await fs.lstat(path.join(localPath(root), "node_modules"))
      ).isSymbolicLink(),
    );
    assert.ok(
      !(
        await fs.lstat(path.join(localPath(root), "node_modules", "semver"))
      ).isSymbolicLink(),
      "pnpm 使用 hoisted 布局兼容现有预览",
    );
    assert.match(
      await fs.readFile(path.join(localPath(root), "pnpm-lock.yaml"), "utf8"),
      /7\.7\.2/u,
    );
    const loaded = spawnSync(
      process.execPath,
      ["-e", 'console.log(require("semver").valid("1.2.3"))'],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(loaded.status, 0, loaded.stderr);
    assert.equal(loaded.stdout.trim(), "1.2.3");
    const bin = path.join(
      root,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "semver.cmd" : "semver",
    );
    const cli = spawnSync(bin, ["1.2.3"], {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout.trim(), "1.2.3");
  }
  const files = await Promise.all(
    roots.map((root) =>
      fs.stat(path.join(localPath(root), "node_modules", "semver", "index.js")),
    ),
  );
  assert.equal(files[0].dev, files[1].dev);
  assert.equal(
    files[0].ino,
    files[1].ino,
    "相同包在不同产物中通过硬链接共享文件",
  );
  assert.ok(files[0].nlink >= 2);
});

test("沙箱临时依赖丢失后，持久化清单与 lockfile 保留并严格恢复链接", async (context) => {
  const { root, store, manifest, run } = await fixture(context);
  await manifest("1.0.0");
  const first = await run();
  const source = await fs.readFile(localPath(root + "/package.json"), "utf8");
  const lock = await fs.readFile(
    localPath(root + "/package-lock.json"),
    "utf8",
  );
  assert.ok(first.directory.startsWith(store + "/"));
  await fs.rm(localPath(store), { recursive: true, force: true });
  const restored = await run({ mode: "restore" });
  assert.equal(restored.cached, false);
  assert.equal(
    await fs.readFile(
      localPath(root + "/node_modules/example/version"),
      "utf8",
    ),
    "1.0.0",
  );
  assert.equal(
    await fs.readFile(localPath(root + "/package.json"), "utf8"),
    source,
  );
  assert.equal(
    await fs.readFile(localPath(root + "/package-lock.json"), "utf8"),
    lock,
  );
});

test("有完成标记但缺少依赖包的缓存会重新安装，而不是误报就绪", async (context) => {
  const { manifest, run } = await fixture(context);
  await manifest("1.0.0");
  const first = await run();
  await fs.rm(localPath(first.directory + "/example"), {
    recursive: true,
    force: true,
  });
  const restored = await run({ mode: "restore" });
  assert.equal(restored.cached, false);
  assert.equal(
    await fs.readFile(
      localPath(restored.directory + "/example/version"),
      "utf8",
    ),
    "1.0.0",
  );
});

test("严格恢复拒绝缺少或不匹配的 lockfile，不悄悄升级依赖", async (context) => {
  const { root, manifest, run } = await fixture(context);
  await manifest("1.0.0");
  await assert.rejects(run({ mode: "restore" }), /缺少 lockfile/u);
  await run();
  const lock = await fs.readFile(
    localPath(root + "/package-lock.json"),
    "utf8",
  );
  await manifest("2.0.0");
  await assert.rejects(run({ mode: "restore" }), /lockfile/u);
  assert.equal(
    await fs.readFile(localPath(root + "/package-lock.json"), "utf8"),
    lock,
  );
  assert.equal(
    await fs.readFile(
      localPath(root + "/node_modules/example/version"),
      "utf8",
    ),
    "1.0.0",
  );
});

test("pnpm 恢复使用冻结 lockfile，编辑安装仍允许更新", async (context) => {
  const { manifest, run, log } = await fixture(context);
  await manifest("1.0.0");
  const first = await run({ packageManager: "pnpm" });
  await fs.rm(localPath(first.directory + "/example"), {
    recursive: true,
    force: true,
  });
  await run({ packageManager: "pnpm", mode: "restore" });
  const installs = (await fs.readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.ok(installs[0].args.includes("--no-frozen-lockfile"));
  assert.ok(installs[1].args.includes("--frozen-lockfile"));
});

test("严格恢复不能复用更新模式由不匹配 lockfile 生成的缓存", async (context) => {
  const { root, manifest, run } = await fixture(context);
  await manifest("1.0.0");
  await run();
  const lockPath = localPath(root + "/package-lock.json");
  const original = await fs.readFile(lockPath, "utf8");
  await manifest("2.0.0");
  await run({ persistLock: false });
  assert.equal(await fs.readFile(lockPath, "utf8"), original);
  await assert.rejects(run({ mode: "restore" }), /lockfile/u);
});
