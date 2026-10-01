import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const stylesheetUrl = pathToFileURL(resolve(currentDirectory, "../src/styles.css")).href;
const browserCandidates = process.platform === "win32"
  ? [
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    ]
  : ["/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium"];

test("发送列表内容滚动且 Apply 按钮固定可见", (context) => {
  const browser = browserCandidates.find(existsSync);
  if (!browser) {
    context.skip("当前环境没有可用的 Chromium 浏览器");
    return;
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "artifact-selection-tray-"));
  const fixturePath = join(temporaryDirectory, "fixture.html");
  const profilePath = join(temporaryDirectory, "profile");
  const items = Array.from({ length: 12 }, (_, index) => `
    <div class="element-selection-tray-item">
      <button class="element-selection-target"><span></span><span><code>section.card-${index}</code></span></button>
    </div>`).join("");
  writeFileSync(fixturePath, `<!doctype html>
    <link rel="stylesheet" href="${stylesheetUrl}">
    <style>
      .browser-frame { width: 380px; height: 420px; }
      .element-selection-tray { position: relative; inset: auto; height: 180px; max-height: 180px; }
    </style>
    <div class="browser-frame">
      <aside class="element-selection-tray">
        <section class="element-selection-queue">
          <div class="element-selection-tray-heading"><span>发送列表 <b>12</b></span></div>
          <div class="element-selection-tray-list">${items}</div>
          <button class="element-selection-apply">Apply 到对话</button>
        </section>
      </aside>
    </div>
    <pre id="result"></pre>
    <script>
      requestAnimationFrame(() => {
        const tray = document.querySelector('.element-selection-tray');
        const list = document.querySelector('.element-selection-tray-list');
        const apply = document.querySelector('.element-selection-apply');
        document.querySelector('#result').textContent = JSON.stringify({
          overflowY: getComputedStyle(list).overflowY,
          clientHeight: list.clientHeight,
          scrollHeight: list.scrollHeight,
          applyBottom: apply.getBoundingClientRect().bottom,
          trayBottom: tray.getBoundingClientRect().bottom,
        });
      });
    </script>`);

  try {
    const result = spawnSync(browser, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--virtual-time-budget=1000",
      `--user-data-dir=${profilePath}`,
      "--dump-dom",
      pathToFileURL(fixturePath).href,
    ], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    const measurement = result.stdout.match(/<pre id="result">(\{[^<]+\})<\/pre>/u);
    assert.ok(measurement, "没有取得发送列表布局测量结果");
    const layout = JSON.parse(measurement[1]);
    assert.equal(layout.overflowY, "auto");
    assert.ok(layout.scrollHeight > layout.clientHeight, "列表内容没有形成可滚动区域");
    assert.ok(layout.applyBottom <= layout.trayBottom, "Apply 按钮超出了发送列表容器");
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
