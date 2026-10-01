import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { requireSuccess, shellCommand } from "@artifact-editor/sdk/server";
import { DockerSandbox } from "@artifact-editor/sdk/server/docker";
import { createArtifactWorkspace } from "../src/artifact-workspace.js";

const baseUrl = process.env.ARTIFACT_SERVER_TEST_URL;
const containerId = process.env.ARTIFACT_SANDBOX_CONTAINER;

test("宿主通过薄 SDK 保留 HTTP 文件、版本与 Vite 预览", {
  skip: !baseUrl || !containerId,
}, async context => {
  const sandbox = new DockerSandbox({ containerId });
  const runNode = async (script, args = []) => requireSuccess(await sandbox.bash(shellCommand(["node", "-e", script, ...args]))).stdout;
  const environment = JSON.parse(await runNode(String.raw`
const fs = require("node:fs"), path = require("node:path");
const dependencies = fs.readdirSync("/workspace", { withFileTypes: true }).filter(entry => entry.isDirectory())
  .map(entry => path.join("/workspace", entry.name, "node_modules"))
  .find(directory => fs.existsSync(path.join(directory, "vite", "package.json")));
const previews = fs.readdirSync("/proc").filter(id => /^\d+$/u.test(id)).flatMap(id => {
  try { const args = fs.readFileSync("/proc/" + id + "/cmdline", "utf8").split("\0").filter(Boolean);
    return args.some(arg => arg.startsWith("/workspace/") && arg.endsWith("/node_modules/.bin/vite"))
      && args.includes(".artifact/vite.config.mjs") ? [id] : []; } catch { return []; }
});
process.stdout.write(JSON.stringify({ dependencies, previews }));
`));
  if (!environment.dependencies || environment.previews.length) {
    context.skip("需要已有 Vite 依赖和空闲的宿主预览槽位");
    return;
  }
  const id = `sdk-smoke-${randomUUID()}`;
  const root = `/workspace/${id}`;
  requireSuccess(await sandbox.bash(shellCommand(["mkdir", "--", root])));
  context.after(async () => {
    await runNode(String.raw`
const fs = require("node:fs");
const root = process.argv[1];
if (!/^\/workspace\/sdk-smoke-[0-9a-f-]+$/u.test(root) || fs.realpathSync(root) !== root) throw new Error("清理目录无效");
for (const id of fs.readdirSync("/proc").filter(id => /^\d+$/u.test(id))) {
  try { const args = fs.readFileSync("/proc/" + id + "/cmdline", "utf8").split("\0");
    if (args.includes(root + "/node_modules/.bin/vite")) process.kill(Number(id), "SIGTERM");
  } catch {}
}
fs.rmSync(root, { recursive: true, force: true });
`, [root]);
  });
  // Copy dependencies into the fixture so preview caches cannot change another artifact.
  requireSuccess(await sandbox.bash(shellCommand(["cp", "-a", environment.dependencies, `${root}/node_modules`])));
  const workspace = createArtifactWorkspace({ sandbox, root, buildCommand: "npm run build" });
  await workspace.files.write("package.json", JSON.stringify({ name: id, type: "module", scripts: { build: "vite build" } }));
  await workspace.files.write("index.html", "<!doctype html><html><body><h1>SDK V1</h1></body></html>");
  const json = async (route, options) => {
    const response = await fetch(`${baseUrl}${route}`, options);
    const value = await response.json();
    assert.equal(response.status, 200, JSON.stringify(value));
    return value;
  };
  const initial = await json(`/api/artifacts/${id}/checkpoints`);
  assert.equal(initial.state.latestVersion, 1);
  const files = await json(`/api/sandbox/files?artifactId=${id}`);
  assert.equal(files.root, root);
  assert.ok(files.tree.some(file => file.name === "index.html"));
  const file = await json(`/api/sandbox/file?artifactId=${id}&path=index.html`);
  assert.match(file.content, /SDK V1/u);
  await json(`/api/artifacts/${id}/start`, { method: "POST" });
  let preview = await fetch(`${baseUrl}/proxy/5173/`).then(response => response.text());
  assert.match(preview, /SDK V1/u);
  await workspace.build();
  await workspace.edit({ message: "SDK V2" }, current => current.files.edit("index.html", "SDK V1", "SDK V2"));
  const historical = await json(`/api/artifacts/${id}/checkpoints/1/preview`, { method: "POST" });
  assert.equal(historical.state.mode, "historical-preview");
  preview = await fetch(`${baseUrl}/proxy/5173/`).then(response => response.text());
  assert.match(preview, /SDK V1/u);
  const resumed = await json(`/api/artifacts/${id}/checkpoints/resume`, { method: "POST" });
  assert.equal(resumed.state.workspaceVersion, 2);
  preview = await fetch(`${baseUrl}/proxy/5173/`).then(response => response.text());
  assert.match(preview, /SDK V2/u);
  const sessions = await json(`/api/sessions?artifactId=${id}`);
  assert.deepEqual(sessions.sessions, []);
});
