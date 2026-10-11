import assert from "node:assert/strict";
import test from "node:test";
import {
  GitVersions,
  requireSuccess,
  shellCommand,
} from "@artifact-editor/sdk/server";
import { ArtifactWorkspace } from "../src/modules/artifacts/models/artifact-workspace.model.js";
import { AgentToolsService } from "../src/modules/agent/services/agent-tools.service.js";
import {
  fixture as sandboxFixture,
  faultSandbox,
} from "../../../packages/sdk/test/server/fixtures.js";

const toolService = new AgentToolsService();

function workspaceFor({ sandbox, ...options }) {
  return new ArtifactWorkspace({
    ...options,
    files: sandbox,
    execute: (command, opts) => sandbox.bash(command, opts),
  });
}

async function fixture(context, options = {}) {
  const value = await sandboxFixture(context);
  return {
    ...value,
    workspace: workspaceFor({
      sandbox: value.sandbox,
      root: value.root,
      ...options,
    }),
  };
}

test(
  "Agent 在编辑中安装依赖使用注入能力，且不会重复等待工作区锁",
  { timeout: 20_000 },
  async (context) => {
    const installations = [];
    const controller = new AbortController();
    const { root, workspace } = await fixture(context, {
      prepareDependencies: async (current, options) => {
        installations.push({ root: current.root, signal: options?.signal });
        assert.equal((await current.files.read("index.html")).content, "V2");
        return { cached: true };
      },
    });
    await workspace.files.write("index.html", "V1");
    await workspace.versions.initialize();
    const result = await workspace.edit(
      { message: "更新并安装依赖" },
      async (current) => {
        await current.files.write("index.html", "V2");
        const install = toolService
          .forWorkspace(current)
          .find((tool) => tool.name === "install_dependencies");
        return install.execute({}, { signal: controller.signal });
      },
    );
    assert.deepEqual(result.value, { cached: true });
    assert.equal(result.checkpoint.version, 2);
    assert.deepEqual(installations, [
      { root, signal: controller.signal },
      { root, signal: undefined },
    ]);
  },
);

test("Agent 和业务修正先提交，宿主只为校验后的最终提交发布版本", async (context) => {
  const { sandbox, root, workspace } = await fixture(context);
  await workspace.files.write(
    "data.json",
    JSON.stringify({ title: "原文案", protectedValue: 100 }),
  );
  await workspace.versions.initialize();
  await workspace.execute(
    shellCommand(["git", "config", "user.name", "SDK Test"]),
  );
  await workspace.execute(
    shellCommand(["git", "config", "user.email", "sdk-test@example.invalid"]),
  );
  const versions = new GitVersions(sandbox, root);
  let draft, final;
  const result = await workspace.edit(
    {
      message: "发布业务校验后的内容",
      verify: async (current) => {
        const candidate = JSON.parse(
          (await current.files.read("data.json")).content,
        );
        assert.equal(candidate.protectedValue, 999);
        await current.files.write(
          "data.json",
          JSON.stringify({ ...candidate, protectedValue: 100 }),
        );
        final = await versions.commit("恢复受保护数据");
        assert.deepEqual(
          (await versions.list()).map((version) => version.version),
          ["checkpoint/v1"],
        );
      },
    },
    async (current) => {
      await current.files.write(
        "data.json",
        JSON.stringify({ title: "新文案", protectedValue: 999 }),
      );
      draft = await versions.commit("Agent 修改");
    },
  );
  assert.equal(result.changed, true);
  assert.equal(result.checkpoint.version, 2);
  assert.equal(result.checkpoint.commitSha, final);
  assert.equal(
    requireSuccess(
      await workspace.execute("git rev-parse HEAD^"),
    ).stdout.trim(),
    draft,
  );
  assert.equal(
    requireSuccess(
      await workspace.execute("git rev-list --count HEAD"),
    ).stdout.trim(),
    "3",
  );
  await workspace.versions.checkout(1);
  assert.deepEqual(
    JSON.parse((await workspace.files.read("data.json")).content),
    { title: "原文案", protectedValue: 100 },
  );
  await workspace.versions.resume();
  assert.deepEqual(
    JSON.parse((await workspace.files.read("data.json")).content),
    { title: "新文案", protectedValue: 100 },
  );
});

test("历史版本形成新的全局版本，旧 tag 和真实父提交保留", async (context) => {
  const { workspace } = await fixture(context);
  await workspace.files.write("index.html", "V1\n");
  let snapshot = await workspace.versions.initialize();
  const v1 = snapshot.checkpoints[0].commitSha;
  assert.equal(snapshot.state.latestVersion, 1);
  const first = await workspace.edit({ message: "create V2" }, (current) =>
    current.files.write("index.html", "V2\n"),
  );
  assert.equal(first.checkpoint.version, 2);
  snapshot = await workspace.versions.checkout(1);
  assert.equal(snapshot.state.mode, "historical-preview");
  await assert.rejects(
    workspace.edit({}, async () => {}),
    /只读/u,
  );
  assert.equal((await workspace.files.read("index.html")).content, "V1\n");
  await workspace.versions.beginEdit(1);
  const result = await workspace.edit(
    { message: "create V3 from V1" },
    (current) => current.files.write("index.html", "V3 from V1\n"),
  );
  assert.equal(result.state.mode, "latest");
  assert.equal(result.state.workspaceVersion, 3);
  assert.deepEqual(
    result.checkpoints.map((item) => item.version),
    [3, 2, 1],
  );
  assert.equal(
    requireSuccess(
      await workspace.execute("git rev-parse checkpoint/v3^"),
    ).stdout.trim(),
    v1,
  );
  assert.match(await workspace.versions.diff(1, 2), /\+V2/u);
  await workspace.versions.checkout(2);
  assert.equal((await workspace.files.read("index.html")).content, "V2\n");
  await workspace.versions.resume();
  assert.equal(
    (await workspace.files.read("index.html")).content,
    "V3 from V1\n",
  );
  const noop = await workspace.edit({}, async () => "answer");
  assert.equal(noop.changed, false);
  assert.equal(noop.checkpoint, null);
  assert.equal(noop.value, "answer");
});

test("查询不初始化仓库，初始化不改源码，空工作区可保存 V1", async (context) => {
  const { workspace } = await fixture(context);
  await assert.rejects(workspace.versions.inspect());
  await workspace.versions.initialize();
  assert.deepEqual((await workspace.files.list()).tree, []);
  await workspace.files.write("node_modules/ignored.txt", "dependency");
  assert.equal((await workspace.versions.status()).dirty, false);
  const again = await workspace.versions.initialize();
  assert.equal(again.state.latestVersion, 1);
});

test("过期 revision 拒绝执行；失败默认保留修改，显式回滚恢复文件", async (context) => {
  const { workspace } = await fixture(context);
  await workspace.files.write("index.html", "original");
  await workspace.versions.initialize();
  let invoked = false;
  await assert.rejects(
    workspace.edit({ expectedRevision: "stale" }, async () => {
      invoked = true;
    }),
    /版本已经变化/u,
  );
  assert.equal(invoked, false);
  await assert.rejects(
    workspace.edit({}, async (current) => {
      await current.files.write("index.html", "failed but retained");
      throw new Error("Agent failed");
    }),
    /Agent failed/u,
  );
  assert.equal(
    (await workspace.files.read("index.html")).content,
    "failed but retained",
  );
  await workspace.versions.checkpoint({ message: "keep edits" });
  await assert.rejects(
    workspace.edit({ onError: "rollback" }, async (current) => {
      await current.files.write("index.html", "broken");
      await current.files.write("new.txt", "untracked");
      await current.files.write("node_modules/keep.txt", "dependency");
      throw new Error("Agent failed");
    }),
    /Agent failed/u,
  );
  assert.equal(
    (await workspace.files.read("index.html")).content,
    "failed but retained",
  );
  await assert.rejects(workspace.files.read("new.txt"));
  assert.equal(
    (await workspace.files.read("node_modules/keep.txt")).content,
    "dependency",
  );
  assert.equal((await workspace.versions.status()).dirty, false);
  assert.equal((await workspace.versions.status()).latestVersion, 2);
});

test("保存历史编辑中途失败时恢复分支和标签，允许重试", async (context) => {
  const { sandbox, root, workspace } = await fixture(context);
  await workspace.files.write("index.html", "V1");
  await workspace.versions.initialize();
  await workspace.edit({}, (current) =>
    current.files.write("index.html", "V2"),
  );
  await workspace.versions.beginEdit(1);
  let failed = false;
  const failing = workspaceFor({
    root,
    sandbox: faultSandbox(sandbox, (command) => {
      if (!failed && command.includes("'update-ref' 'refs/heads/workspace'")) {
        failed = true;
        return true;
      }
      return false;
    }),
  });
  await assert.rejects(
    failing.edit({ onError: "rollback" }, (current) =>
      current.files.write("index.html", "broken V3"),
    ),
    /injected failure/u,
  );
  const after = await workspace.versions.inspect();
  assert.equal(after.state.mode, "editing-history");
  assert.equal(after.state.activeVersion, 1);
  assert.equal(after.state.workspaceVersion, 2);
  assert.deepEqual(
    after.checkpoints.map((item) => item.version),
    [2, 1],
  );
  assert.equal((await workspace.files.read("index.html")).content, "V1");
  assert.equal(after.state.dirty, false);
  const retry = await workspace.edit({}, (current) =>
    current.files.write("index.html", "valid V3"),
  );
  assert.equal(retry.checkpoint.version, 3);
});

test("成功保存后查询失败，不撤销已经保存的版本", async (context) => {
  const { sandbox, root, workspace } = await fixture(context);
  await workspace.files.write("index.html", "V1");
  await workspace.versions.initialize();
  let saved = false,
    failed = false;
  const failing = workspaceFor({
    root,
    sandbox: faultSandbox(sandbox, (command) => {
      if (command.includes("'tag' '-a' 'checkpoint/v2'")) saved = true;
      if (saved && !failed && command.includes("'for-each-ref'")) {
        failed = true;
        return true;
      }
      return false;
    }),
  });
  await assert.rejects(
    failing.edit({ onError: "rollback" }, (current) =>
      current.files.write("index.html", "V2"),
    ),
    /injected failure/u,
  );
  const after = await workspace.versions.inspect();
  assert.equal(after.state.latestVersion, 2);
  assert.equal(after.state.dirty, false);
  assert.equal((await workspace.files.read("index.html")).content, "V2");
});

test("远端已创建标签但返回失败时，也清理新标签并保留可重试的修改", async (context) => {
  const { sandbox, root, workspace } = await fixture(context);
  await workspace.files.write("index.html", "V1");
  await workspace.versions.initialize();
  let failed = false;
  const intercepted = Object.create(sandbox);
  intercepted.bash = async (command, options) => {
    const result = await sandbox.bash(command, options);
    if (!failed && command.includes("'tag' '-a' 'checkpoint/v2'")) {
      failed = true;
      throw new Error("lost acknowledgement");
    }
    return result;
  };
  const failing = workspaceFor({ sandbox: intercepted, root });
  await assert.rejects(
    failing.edit({}, (current) => current.files.write("index.html", "V2")),
    /lost acknowledgement/u,
  );
  assert.deepEqual(
    (await workspace.versions.list()).map((item) => item.version),
    [1],
  );
  assert.equal((await workspace.versions.status()).dirty, true);
  assert.equal((await workspace.files.read("index.html")).content, "V2");
  const saved = await workspace.versions.checkpoint();
  assert.equal(saved.version, 2);
});

test("共享文件存储的同目录实例串行编辑，其他目录独立执行", async (context) => {
  const { sandbox, root, workspace } = await fixture(context);
  await workspace.files.write("index.html", "V1");
  await workspace.versions.initialize();
  const otherDirectory = await fixture(context);
  const other = workspaceFor({ sandbox, root: otherDirectory.root });
  await other.files.write("index.html", "other");
  await other.versions.initialize();
  const same = workspaceFor({ sandbox, root: `${root}/./` });
  let entered, release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = workspace.edit({}, async (current) => {
    entered();
    await gate;
    await current.files.write("index.html", "first");
  });
  await started;
  let secondStarted = false;
  const second = same.edit({}, async (current) => {
    secondStarted = true;
    await current.files.write("index.html", "second");
  });
  await other.edit({}, (current) =>
    current.files.write("index.html", "independent"),
  );
  assert.equal(secondStarted, false);
  release();
  const results = await Promise.all([first, second]);
  assert.equal(
    results[1].checkpoint.version,
    results[0].checkpoint.version + 1,
  );
  assert.equal((await workspace.files.read("index.html")).content, "second");
});
