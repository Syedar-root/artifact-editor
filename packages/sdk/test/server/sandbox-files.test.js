import assert from "node:assert/strict";
import test from "node:test";
import { requireSuccess } from "../../dist/server/index.js";
import { fixture } from "./fixtures.js";

test("只实现 bash 即可读写、编辑、列出和搜索文件，参数保持原样", async context => {
  const { sandbox, root } = await fixture(context);
  const options = { cwd: root };
  const file = "src/hello ' 世界.txt";
  const content = "你好\n'$HOME' `echo injected` $(echo injected)\n";
  await sandbox.write(file, content, options);
  assert.equal((await sandbox.read(file, options)).content, content);
  await sandbox.edit(file, "你好", "$& 标题", options);
  assert.ok((await sandbox.read(file, options)).content.startsWith("$& 标题"));
  const tree = await sandbox.list(".", options);
  assert.equal(tree.tree[0].children[0].path, file);
  assert.equal(tree.truncated, false);
  assert.deepEqual((await sandbox.search("$HOME", options)).matches, [{ path: file, line: 2,
    text: "'$HOME' `echo injected` $(echo injected)" }]);
  await assert.rejects(sandbox.edit(file, "missing", "other", options), /找不到/u);
  await sandbox.write("repeat.txt", "same same", options);
  await assert.rejects(sandbox.edit("repeat.txt", "same", "new", options), /多处/u);
  await sandbox.edit("repeat.txt", "same", "new", { ...options, replaceAll: true });
  assert.equal((await sandbox.read("repeat.txt", options)).content, "new new");
  await assert.rejects(sandbox.read("../outside.txt", options), /超出/u);
  await assert.rejects(sandbox.write("/outside.txt", "bad", options), /超出/u);
  await assert.rejects(sandbox.read(file, { ...options, maxBytes: 1 }), /大小限制/u);
});

test("文件操作拒绝通过符号链接越出工作区", {
  skip: process.platform === "win32" && !process.env.SDK_DOCKER_CONTAINER,
}, async context => {
  const { sandbox, root, execute } = await fixture(context);
  const options = { cwd: root };
  requireSuccess(await execute("ln -s /tmp escape"));
  await assert.rejects(sandbox.read("escape/no-such-file", options), /超出/u);
  await assert.rejects(sandbox.write("escape/no-such-file", "bad", options), /超出/u);
  assert.equal((await sandbox.list(".", options)).tree.some(item => item.name === "escape"), false);
});

test("Bash 文件操作保留特殊文件名、空文件、换行和替换文本", async context => {
  const { sandbox, root } = await fixture(context);
  const options = { cwd: root };
  const file = "nested/-name: ' $(echo injected)\n世界.txt";
  await sandbox.write(file, "same\r\nsame", options);
  await sandbox.edit(file, "same", "$& '$HOME'\n新行", { ...options, replaceAll: true });
  assert.equal((await sandbox.read(file, options)).content, "$& '$HOME'\n新行\r\n$& '$HOME'\n新行");
  assert.deepEqual((await sandbox.search("$HOME", options)).matches, [
    { path: file, line: 1, text: "$& '$HOME'" },
    { path: file, line: 3, text: "$& '$HOME'" },
  ]);
  assert.equal((await sandbox.list("nested", options)).tree[0].path, file);
  assert.equal((await sandbox.search("missing", options)).matches.length, 0);
  assert.equal((await sandbox.search("$HOME", { ...options, maxResults: 1 })).truncated, true);
  await sandbox.write("empty.txt", "", options);
  assert.deepEqual(await sandbox.read("empty.txt", options), { path: "empty.txt", size: 0, content: "" });
  await sandbox.write("binary.txt", "text\0data", options);
  await assert.rejects(sandbox.read("binary.txt", options), /二进制/u);
  assert.equal((await sandbox.search("data", options)).matches.length, 0);
  await sandbox.write("node_modules/ignored.txt", "hidden", options);
  assert.equal((await sandbox.search("hidden", options)).matches.length, 0);
  assert.equal((await sandbox.search("hidden", { ...options, ignore: [] })).matches.length, 1);
  assert.equal((await sandbox.list(".", { ...options, maxEntries: 1 })).truncated, true);
  assert.equal((await sandbox.list(".", { ...options, maxDepth: 0 })).truncated, true);
});

test("预定义文件方法可在没有 Node.js 的命令环境中运行", {
  skip: !process.env.SDK_DOCKER_CONTAINER,
}, async context => {
  const { sandbox, root } = await fixture(context);
  const options = { cwd: root, env: { PATH: "/usr/bin:/bin" } };
  assert.notEqual((await sandbox.bash("command -v node", options)).exitCode, 0);
  await sandbox.write("src/readme.txt", "old\n", options);
  await sandbox.edit("src/readme.txt", "old", "new", options);
  assert.equal((await sandbox.read("src/readme.txt", options)).content, "new\n");
  assert.equal((await sandbox.list(".", options)).tree[0].children[0].path, "src/readme.txt");
  assert.deepEqual((await sandbox.search("new", options)).matches, [{ path: "src/readme.txt", line: 1, text: "new" }]);
});
