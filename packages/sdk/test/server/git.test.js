import assert from "node:assert/strict";
import test from "node:test";
import { runGit, requireSuccess } from "../../dist/server/index.js";
import { fixture } from "./fixtures.js";

test("Git 封装允许调用方选择分支、提交及标签，不产生额外版本规则", async context => {
  const { sandbox, root } = await fixture(context);
  const options = { cwd: root };
  const git = async (...args) => requireSuccess(await runGit(sandbox, args, options)).stdout.trim();
  await git("init", "--initial-branch=caller-main");
  await git("config", "user.name", "SDK Test");
  await git("config", "user.email", "sdk-test@example.invalid");
  const filename = "caller ' $(echo injected).txt";
  await sandbox.write(filename, "first", options);
  await git("add", "--", filename);
  const message = "调用方提交 ' $HOME `echo injected` $(echo injected)";
  await git("commit", "-m", message);
  assert.equal(await git("log", "-1", "--format=%s"), message);
  assert.equal(await git("branch", "--show-current"), "caller-main");
  await git("tag", "release-v1");
  await git("switch", "-c", "caller-edit");
  await sandbox.write(filename, "second", options);
  assert.match(await git("status", "--porcelain"), /caller/u);
  assert.equal(await git("tag", "--list"), "release-v1");
  assert.equal(await git("rev-list", "--count", "HEAD"), "1");
  const failed = await runGit(sandbox, ["rev-parse", "--verify", "missing-ref"], options);
  assert.notEqual(failed.exitCode, 0);
  assert.throws(() => requireSuccess(failed));
});
