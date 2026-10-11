import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { LlmAdapter, ToolCallId } from "@deepseek-ai/dsh-llm";
import { DshRuntimeService } from "../src/modules/agent/services/dsh-runtime.service.js";
import { SessionViewService } from "../src/modules/agent/services/session-view.service.js";
import { AgentToolsService } from "../src/modules/agent/services/agent-tools.service.js";
import { ArtifactWorkspace } from "../src/modules/artifacts/models/artifact-workspace.model.js";
import { fixture as sandboxFixture } from "../../../packages/sdk/test/server/fixtures.js";

const sessionView = new SessionViewService();

const toolService = new AgentToolsService();

const runOptions = (workspace, sessionId, signal) => ({
  cwd: workspace.root,
  tools: toolService.forWorkspace(workspace),
  systemPrompt: toolService.prompt(workspace.root),
  sessionId,
  signal,
});
const sessions = async (runtime, id, root) =>
  sessionView.read((await runtime.context()).sessionPersistence, id, root);
const testModel = (adapter) => ({ model: "test-model", adapter });

class ScriptedModel extends LlmAdapter {
  constructor(steps) {
    super();
    this.steps = steps;
    this.requests = [];
  }
  async *stream(options) {
    this.requests.push(options);
    const block = this.steps.shift();
    if (block instanceof Error) throw block;
    assert.ok(block, "model received an unexpected request");
    yield { type: "block-start", index: 0, blockType: block.type };
    if (block.type === "text")
      yield { type: "text-delta", index: 0, text: block.text };
    else
      yield {
        type: "tool-call-delta",
        index: 0,
        id: block.id,
        name: block.name,
        argumentsDelta: block.arguments,
      };
    yield { type: "block-end", index: 0, block };
    yield {
      type: "finish",
      reason: { kind: block.type === "text" ? "stop" : "tool-calls" },
    };
  }
}

test(
  "DSH 检查和构建工具在当前产物编辑中执行，依赖留在注入能力中",
  { timeout: 20_000 },
  async (context) => {
    const { sandbox, root } = await sandboxFixture(context);
    const calls = [];
    const workspace = new ArtifactWorkspace({
      files: sandbox,
      execute: (command, options) => sandbox.bash(command, options),
      root,
      buildCommand: "cat index.html",
      prepareDependencies: async (current, options) => {
        calls.push({ root: current.root, signal: options?.signal });
        return { cached: true };
      },
    });
    await workspace.files.write("index.html", "<h1>标题</h1>");
    await workspace.versions.initialize();
    const model = new ScriptedModel([
      {
        type: "tool-call",
        id: ToolCallId("inspect-current"),
        name: "inspect_artifact",
        arguments: "{}",
      },
      {
        type: "tool-call",
        id: ToolCallId("build-current"),
        name: "build",
        arguments: "{}",
      },
      { type: "text", text: "当前产物构建成功。" },
    ]);
    const sessionRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "artifact-dsh-build-"),
    );
    const runtime = new DshRuntimeService({
      sessionRoot,
      model: testModel(model),
    });
    context.after(async () => {
      await runtime.close();
      await fs.rm(sessionRoot, { recursive: true, force: true });
    });
    const result = await workspace.edit({}, (current) =>
      runtime.run("检查并构建", {
        cwd: root,
        sessionId: randomUUID(),
        tools: toolService.forWorkspace(current, {
          inspect: async (signal) => {
            assert.ok(signal instanceof AbortSignal);
            return { id: "current-artifact", detectedStack: "html" };
          },
        }),
      }),
    );
    assert.equal(result.value, "当前产物构建成功。");
    assert.equal(result.changed, false);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].signal instanceof AbortSignal);
    assert.ok(calls.every((call) => call.root === root));
    const inspect = model.requests[0].tools.find(
      (tool) => tool.name === "inspect_artifact",
    );
    assert.deepEqual(inspect.parameters.properties, {});
    const messages = model.requests[2].messages.filter(
      (message) => message.role === "tool",
    );
    assert.ok(
      messages.some((message) =>
        JSON.stringify(message).includes("current-artifact"),
      ),
    );
    assert.ok(
      messages.some((message) => JSON.stringify(message).includes("标题")),
    );
  },
);

test("DSH 在宿主驱动沙箱工具，持久化会话并在重启后恢复", async (context) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "artifact-dsh-test-"),
  );
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sessionId = randomUUID();
  const writes = [];
  const workspace = {
    root: "/workspace/dsh-test",
    files: {
      write: async (file, content, options) => {
        writes.push({ file, content, signal: options.signal });
        return { path: file, size: Buffer.byteLength(content) };
      },
    },
    execute: async () => {
      throw new Error("should not launch an agent subprocess");
    },
  };
  const model = new ScriptedModel([
    {
      type: "tool-call",
      id: ToolCallId("write-title"),
      name: "write",
      arguments: JSON.stringify({
        path: "index.html",
        content: "<h1>新标题</h1>",
      }),
    },
    { type: "text", text: "已经修改标题。" },
  ]);
  let runtime = new DshRuntimeService({
    sessionRoot: directory,
    model: testModel(model),
  });
  context.after(() => runtime.close());
  assert.equal(
    await runtime.run("修改标题", runOptions(workspace, sessionId)),
    "已经修改标题。",
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0].file, "index.html");
  assert.ok(writes[0].signal instanceof AbortSignal);
  assert.ok(
    model.requests[0].tools.some(
      (tool) => tool.name === "install_dependencies",
    ),
  );
  assert.ok(
    model.requests[1].messages.some((message) => message.role === "tool"),
  );
  const first = await sessions(runtime, sessionId, workspace.root);
  assert.deepEqual(
    first.session.messages.map((message) => message.role),
    ["user", "agent"],
  );
  assert.deepEqual(await sessions(runtime, sessionId, "/workspace/other"), {
    session: null,
  });
  await assert.rejects(
    runtime.run(
      "错误产物",
      runOptions({ ...workspace, root: "/workspace/other" }, sessionId),
    ),
    /不属于/u,
  );
  await runtime.close();
  const resumedModel = new ScriptedModel([
    { type: "text", text: "已保留之前的修改。" },
  ]);
  runtime = new DshRuntimeService({
    sessionRoot: directory,
    model: testModel(resumedModel),
  });
  assert.equal(
    await runtime.run("继续", runOptions(workspace, sessionId)),
    "已保留之前的修改。",
  );
  assert.ok(
    resumedModel.requests[0].messages.some(
      (message) =>
        message.role === "user" &&
        message.content.some((block) => block.text === "修改标题"),
    ),
  );
  assert.equal(
    (await sessions(runtime, sessionId, workspace.root)).session.messageCount,
    4,
  );
});

test("DSH 模型错误与取消传回宿主，不生成假成功回复", async (context) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "artifact-dsh-failure-"),
  );
  const runtime = new DshRuntimeService({
    sessionRoot: directory,
    model: testModel(new ScriptedModel([new Error("model unavailable")])),
  });
  context.after(async () => {
    await runtime.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  await assert.rejects(
    runtime.run(
      "失败请求",
      runOptions({ root: "/workspace/failure" }, randomUUID()),
    ),
    /model unavailable/u,
  );
  const controller = new AbortController();
  controller.abort(new Error("取消测试"));
  await assert.rejects(
    runtime.run(
      "取消请求",
      runOptions(
        { root: "/workspace/failure" },
        randomUUID(),
        controller.signal,
      ),
    ),
    /取消测试/u,
  );
});

test("对话附件仍以用户可读内容呈现", () => {
  const element = {
    hint: "body > h1",
    comment: "改为红色",
    source: { file: "src/App.tsx", line: 2, column: 3 },
  };
  assert.deepEqual(
    sessionView.presentUserMessage(
      `修改颜色\n\n<artifact-editor-context>\n${JSON.stringify({ elements: [element] })}\n</artifact-editor-context>`,
    ),
    { text: "修改颜色", attachments: [element] },
  );
});

test("DSH 官方模型适配器在 Server 发起请求并执行沙箱工具", async (context) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "artifact-dsh-wire-"),
  );
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ headers: request.headers, body: JSON.parse(body) });
    const toolStep = requests.length === 1;
    response.writeHead(200, { "content-type": "text/event-stream" });
    const delta = toolStep
      ? {
          tool_calls: [
            {
              index: 0,
              id: "read-title",
              type: "function",
              function: { name: "read", arguments: '{"path":"index.html"}' },
            },
          ],
        }
      : { content: "读取完成。" };
    for (const chunk of [
      {
        choices: [
          { index: 0, delta: { role: "assistant" }, finish_reason: null },
        ],
      },
      { choices: [{ index: 0, delta, finish_reason: null }] },
      {
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: toolStep ? "tool_calls" : "stop",
          },
        ],
      },
    ])
      response.write(
        `data: ${JSON.stringify({ id: "completion-test", object: "chat.completion.chunk", model: "artifact-test-model", ...chunk })}\n\n`,
      );
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const runtime = new DshRuntimeService({
    sessionRoot: directory,
    model: () => ({
      apiKey: "test-key-for-local-mock",
      model: "artifact-test-model",
      baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    }),
  });
  context.after(async () => {
    await runtime.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const workspace = {
    root: "/workspace/wire-test",
    files: {
      read: async (file) => {
        assert.equal(file, "index.html");
        return { path: file, content: "<h1>标题</h1>", size: 15 };
      },
    },
  };
  assert.equal(
    await runtime.run("读取标题", runOptions(workspace, randomUUID())),
    "读取完成。",
  );
  assert.equal(requests.length, 2);
  assert.equal(
    requests[0].headers.authorization,
    "Bearer test-key-for-local-mock",
  );
  assert.ok(
    requests[1].body.messages.some(
      (message) => message.role === "tool" && message.content.includes("标题"),
    ),
  );
});

test("运行中取消 DSH 会传播到沙箱工具并等待工具结束", async (context) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "artifact-dsh-cancel-"),
  );
  const model = new ScriptedModel([
    {
      type: "tool-call",
      id: ToolCallId("waiting-command"),
      name: "bash",
      arguments: '{"command":"sleep 10"}',
    },
  ]);
  const runtime = new DshRuntimeService({
    sessionRoot: directory,
    model: testModel(model),
  });
  context.after(async () => {
    await runtime.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  let started;
  const toolStarted = new Promise((resolve) => {
    started = resolve;
  });
  let settled = false;
  const workspace = {
    root: "/workspace/cancel-test",
    execute: async (_command, { signal, env }) => {
      assert.equal(env.PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN, "false");
      started();
      await new Promise((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            settled = true;
            reject(signal.reason);
          },
          { once: true },
        );
      });
    },
  };
  const controller = new AbortController();
  const operation = runtime.run(
    "等待命令",
    runOptions(workspace, randomUUID(), controller.signal),
  );
  await toolStarted;
  controller.abort(new Error("用户取消"));
  await assert.rejects(operation, /用户取消/u);
  assert.equal(settled, true);
  assert.equal(model.requests.length, 1);
});

test("直接注入 model、tools 和插件，工具随会话隔离且模型只初始化一次", async (context) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "artifact-dsh-injection-"),
  );
  const calls = [];
  const tool = (name, value) => ({
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    output: {
      schema: {},
      render: (_args, result) => [{ type: "text", text: result }],
    },
    execute: async () => {
      calls.push(value);
      return value;
    },
  });
  let pluginStarts = 0;
  const plugin = {
    name: "test-sandbox-plugin",
    inject: ["tools"],
    apply(ctx, config) {
      pluginStarts++;
      ctx.tools.register(tool("plugin_tool", config.label));
    },
  };
  const call = (name) => ({
    type: "tool-call",
    id: ToolCallId(randomUUID()),
    name,
    arguments: "{}",
  });
  const model = new ScriptedModel([
    call("plugin_tool"),
    call("read"),
    { type: "text", text: "A 完成" },
    call("read"),
    { type: "text", text: "B 完成" },
  ]);
  let modelStarts = 0;
  const runtime = new DshRuntimeService({
    sessionRoot: directory,
    model: async () => {
      modelStarts++;
      return testModel(model);
    },
    plugins: [[plugin, { label: "plugin result" }]],
  });
  context.after(async () => {
    await runtime.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  assert.equal(
    await runtime.run("处理 A", {
      cwd: "/workspace/a",
      sessionId: randomUUID(),
      tools: [tool("read", "sandbox A"), tool("only_a", "A only")],
      systemPrompt: "A instructions",
    }),
    "A 完成",
  );
  assert.equal(
    await runtime.run("处理 B", {
      cwd: "/workspace/b",
      sessionId: randomUUID(),
      tools: [tool("read", "sandbox B")],
      systemPrompt: "B instructions",
    }),
    "B 完成",
  );
  assert.deepEqual(calls, ["plugin result", "sandbox A", "sandbox B"]);
  assert.equal(modelStarts, 1);
  assert.equal(pluginStarts, 1);
  assert.ok(model.requests[0].tools.some((item) => item.name === "only_a"));
  assert.ok(!model.requests[3].tools.some((item) => item.name === "only_a"));
  const prompt = model.requests[3].messages.find(
    (message) => message.role === "system",
  ).content[0].text;
  assert.ok(prompt.includes("B instructions"));
  assert.ok(!prompt.includes("A instructions"));
});
