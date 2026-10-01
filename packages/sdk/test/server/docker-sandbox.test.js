import assert from "node:assert/strict";
import test from "node:test";
import { shellCommand, requireSuccess } from "../../dist/server/index.js";
import { fixture } from "./fixtures.js";

const dockerOnly = { skip: !process.env.SDK_DOCKER_CONTAINER };

test("Docker 执行保留 stdin、环境变量、输出流和非零退出码", dockerOnly, async context => {
  const { execute, readFile } = await fixture(context);
  const events = [];
  const result = await execute(`cat; printf '%s' "$SDK_VALUE"; ${shellCommand(["printf", "%s", "错误"])} >&2; exit 7`, {
    stdin: "输入\n", env: { SDK_VALUE: "'$HOME' $(echo injected)" },
    onOutput: (stream, text) => events.push({ stream, text }),
  });
  assert.equal(result.stdout, "输入\n'$HOME' $(echo injected)");
  assert.equal(result.stderr, "错误");
  assert.equal(result.exitCode, 7);
  assert.equal(result.truncated, false);
  assert.ok(events.some(event => event.stream === "stdout"));
  assert.ok(events.some(event => event.stream === "stderr"));
  assert.throws(() => requireSuccess(result), /错误/u);
});

test("Docker 输出截断有明确标志，命令仍执行完成", dockerOnly, async context => {
  const { execute, readFile } = await fixture(context);
  const result = await execute("printf '%010000d' 0; printf '%s' done > finished.txt", { maxOutputBytes: 50 });
  assert.equal(result.stdout.length, 50);
  assert.equal(result.truncated, true);
  assert.equal(result.exitCode, 0);
  assert.equal((await readFile("finished.txt")).content, "done");
});

test("Docker 取消终止远端进程组，不留下继续修改文件的 Agent", dockerOnly, async context => {
  const { execute, readFile } = await fixture(context);
  const controller = new AbortController();
  await assert.rejects(execute("printf started; sleep 0.8; printf bad > late.txt", {
    signal: controller.signal,
    onOutput: () => controller.abort(new Error("cancelled by test")),
  }), /cancelled by test/u);
  await new Promise(resolve => setTimeout(resolve, 1000));
  await assert.rejects(readFile("late.txt"));
  const falsyReason = new AbortController();
  await assert.rejects(execute("echo ready; sleep 10", {
    signal: falsyReason.signal, onOutput: () => falsyReason.abort(0),
  }), reason => reason === 0);
});

test("Docker 输出回调在分块传输时保留完整的中文字符", dockerOnly, async context => {
  const { execute, readFile } = await fixture(context);
  let output = "";
  const command = [...Buffer.from("你好")].map(byte =>
    `${shellCommand(["printf", `\\${byte.toString(8)}`])}; sleep 0.02`).join("; ");
  const result = await execute(command, {
    onOutput: (stream, text) => { if (stream === "stdout") output += text; },
  });
  assert.equal(result.stdout, "你好");
  assert.equal(output, "你好");
});

test("Docker 超时与预先取消都拒绝执行", dockerOnly, async context => {
  const { execute, readFile } = await fixture(context);
  await assert.rejects(execute("sleep 10", { timeoutMs: 200 }), /超时/u);
  const controller = new AbortController();
  controller.abort(new Error("already cancelled"));
  await assert.rejects(execute("touch should-not-exist", { signal: controller.signal }), /already cancelled/u);
  await assert.rejects(readFile("should-not-exist"));
});
