import assert from "node:assert/strict";
import test from "node:test";
import { GitVersions, runGit, requireSuccess } from "../../dist/server/index.js";
import { fixture, faultSandbox } from "./fixtures.js";

async function repository(context) {
  const value = await fixture(context);
  const { sandbox, root } = value;
  // 版本封装仅依赖 bash，不需要文件工具或其他运行时。
  const versions = new GitVersions({ bash: sandbox.bash.bind(sandbox) }, root);
  const git = async (...args) => requireSuccess(await runGit(sandbox, args, { cwd: root })).stdout.trim();
  await versions.initialize("caller-main");
  await git("config", "user.name", "SDK Test");
  await git("config", "user.email", "sdk-test@example.invalid");
  return { ...value, versions, git };
}

test("已有 V1、V2、V3，从 V1 提交并发布 V4，旧版本与原分支保留", async context => {
  const { sandbox, root, versions, git } = await repository(context);
  const options = { cwd: root };
  assert.deepEqual(await versions.list(), []);
  const message = "发布 v1\t' $HOME `echo injected` $(echo injected)";
  await sandbox.write("index.html", "V1", options);
  const v1 = await versions.commit(message);
  assert.deepEqual(await versions.list(), []);
  assert.equal(await versions.publish("release/v1", message), v1);
  await sandbox.write("index.html", "V2", options);
  const v2 = await versions.commit("第二次提交");
  await versions.publish("release/v2", "第二版发布");
  await sandbox.write("index.html", "V3", options);
  const v3 = await versions.commit("第三次提交");
  await versions.publish("release/v3", "第三版发布");
  const history = await versions.list();
  assert.deepEqual(history.map(({ version, commitSha, message }) => ({ version, commitSha, message })), [
    { version: "release/v3", commitSha: v3, message: "第三版发布" },
    { version: "release/v2", commitSha: v2, message: "第二版发布" },
    { version: "release/v1", commitSha: v1, message },
  ]);
  assert.ok(history.every(version => Number.isFinite(Date.parse(version.createdAt))));
  await versions.checkout("release/v1");
  assert.equal((await sandbox.read("index.html", options)).content, "V1");
  assert.equal(await git("branch", "--show-current"), "");
  await sandbox.write("index.html", "V4 from V1", options);
  const v4 = await versions.commit("基于历史版本修改");
  assert.equal((await versions.list()).length, 3);
  assert.equal(await versions.publish("release/v4", "第四版发布"), v4);
  assert.equal(await git("rev-parse", `${v4}^`), v1);
  assert.equal(await git("rev-parse", "refs/heads/caller-main"), v3);
  await versions.checkout("release/v2");
  assert.equal((await sandbox.read("index.html", options)).content, "V2");
  assert.equal(await git("for-each-ref", "--format=%(refname:short)", "refs/heads"), "caller-main");
  assert.deepEqual((await versions.list()).map(version => version.version), ["release/v4", "release/v3", "release/v2", "release/v1"]);
  await git("tag", "legacy", v1);
  assert.equal((await versions.list()).find(version => version.version === "legacy").commitSha, v1);
});

test("业务校验和修正可以跨多个提交，只有最终内容被发布为版本", async context => {
  const { sandbox, root, versions, git } = await repository(context);
  const options = { cwd: root };
  const write = value => sandbox.write("data.json", JSON.stringify(value), options);
  const read = async () => JSON.parse((await sandbox.read("data.json", options)).content);
  await write({ title: "原文案", protectedValue: 100 });
  await versions.commit("初始源码");
  await versions.publish("v1", "初版发布");
  await write({ title: "新文案", protectedValue: 999 });
  const draft = await versions.commit("Agent 修改");
  assert.deepEqual((await versions.list()).map(version => version.version), ["v1"]);
  const candidate = await read();
  assert.notEqual(candidate.protectedValue, 100);
  // 校验与修正属于宿主业务，不是 SDK 的自动流程。
  await write({ ...candidate, protectedValue: 100 });
  const final = await versions.commit("恢复受保护数据");
  assert.equal(await git("rev-parse", `${final}^`), draft);
  assert.deepEqual((await versions.list()).map(version => version.version), ["v1"]);
  assert.equal((await read()).protectedValue, 100);
  assert.equal(await versions.publish("v2", "业务校验通过"), final);
  assert.equal(await git("rev-list", "--count", "HEAD"), "3");
  const published = (await versions.list())[0];
  assert.equal(published.commitSha, final);
  assert.equal(published.message, "业务校验通过");
  await versions.checkout("v1");
  assert.deepEqual(await read(), { title: "原文案", protectedValue: 100 });
  await versions.checkout("v2");
  assert.deepEqual(await read(), { title: "新文案", protectedValue: 100 });
});

test("发布不会提交工作目录，重复和无效版本不影响提交或文件", async context => {
  const { sandbox, root, versions, git } = await repository(context);
  const options = { cwd: root };
  await assert.rejects(versions.publish("empty", "尚无提交"));
  await sandbox.write("index.html", "V1", options);
  const v1 = await versions.commit("第一版源码");
  await versions.publish("v1");
  await assert.rejects(versions.commit("没有修改"));
  // 发布标记已有提交，允许给同一提交使用调用方选择的不同标签。
  assert.equal(await versions.publish("v2", "另一版本标签"), v1);
  await sandbox.write("index.html", "pending", options);
  await assert.rejects(versions.publish("v1", "重复发布"), /版本已存在/u);
  await assert.rejects(versions.publish("bad..version", "无效版本"));
  await assert.rejects(versions.publish("-version", "无效版本"), /版本名无效/u);
  await assert.rejects(versions.publish("v3", "bad\0message"), /发布说明无效/u);
  await assert.rejects(versions.commit("bad\0message"), /提交说明无效/u);
  assert.equal(await versions.publish("v3", "只标记已提交的内容"), v1);
  assert.equal(await git("show", "v3:index.html"), "V1");
  assert.equal(await git("rev-parse", "HEAD"), v1);
  assert.equal(await git("diff", "--cached", "--name-only"), "");
  await assert.rejects(versions.checkout("missing-version"));
  assert.equal((await sandbox.read("index.html", options)).content, "pending");
  assert.equal(await git("branch", "--show-current"), "caller-main");
});

test("发布失败保留已提交内容，重试发布不会生成额外提交", async context => {
  const { sandbox, root, versions, git } = await repository(context);
  await sandbox.write("index.html", "V1", { cwd: root });
  await versions.commit("第一版源码");
  await versions.publish("v1");
  await sandbox.write("index.html", "V2", { cwd: root });
  const v2 = await versions.commit("第二版源码");
  const failing = new GitVersions(faultSandbox(sandbox, command => command.includes("'tag' '-a' 'v2'")), root);
  await assert.rejects(failing.publish("v2", "第二版发布"), /injected failure/u);
  assert.equal(await git("rev-parse", "HEAD"), v2);
  assert.equal(await git("status", "--porcelain"), "");
  assert.deepEqual((await versions.list()).map(version => version.version), ["v1"]);
  assert.equal(await versions.publish("v2", "第二版发布"), v2);
  assert.equal(await git("rev-list", "--count", "HEAD"), "2");
  assert.deepEqual((await versions.list()).map(version => version.version), ["v2", "v1"]);
});
