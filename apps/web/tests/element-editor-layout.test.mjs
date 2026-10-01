import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("窄预览区域内的编辑弹层不会产生横向内容溢出", (context) => {
  const browser = browserCandidates.find(existsSync);
  if (!browser) {
    context.skip("当前环境没有可用的 Chromium 浏览器");
    return;
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "artifact-editor-layout-"));
  const fixturePath = join(temporaryDirectory, "fixture.html");
  const profilePath = join(temporaryDirectory, "profile");
  const fixture = `<!doctype html>
    <link rel="stylesheet" href="${stylesheetUrl}">
    <style>
      .browser-frame { width: 380px; height: 420px; }
      .element-editor-popover {
        position: relative;
        inset: auto;
        width: 348px;
        max-height: 300px;
        transform: none !important;
      }
    </style>
    <div class="browser-frame">
      <section class="element-editor-popover">
        <header class="element-editor-heading">
          <span class="element-editor-kind">T</span>
          <code>div.slide.is-active &gt; section.slide-inner &gt; div.powerful-content</code>
          <button type="button">×</button>
        </header>
        <div class="element-editor-tabs">
          <button>样式</button><button>AI Comment</button>
        </div>
        <div class="element-editor-fields">
          <section class="element-editor-group">
            <div class="element-editor-grid">
              <label class="element-editor-field"><span>边框宽度</span><input value="1px"></label>
              <label class="element-editor-field"><span>边框样式</span><input value="solid"></label>
              <label class="element-editor-field"><span>圆角</span><input value="18px"></label>
              <label class="element-editor-field"><span>透明度</span><input value="1"></label>
            </div>
          </section>
        </div>
        <footer class="element-editor-actions"><button>取消</button><button>应用</button></footer>
      </section>
    </div>
    <pre id="result"></pre>
    <script>
      requestAnimationFrame(() => {
        const popover = document.querySelector('.element-editor-popover');
        document.querySelector('#result').textContent = JSON.stringify({
          clientWidth: popover.clientWidth,
          scrollWidth: popover.scrollWidth,
        });
      });
    </script>`;
  writeFileSync(fixturePath, fixture);

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
    const html = result.stdout || readFileSync(fixturePath, "utf8");
    const measurement = html.match(/<pre id="result">(\{[^<]+\})<\/pre>/u);
    assert.ok(measurement, "没有取得弹层布局测量结果");
    const { clientWidth, scrollWidth } = JSON.parse(measurement[1]);
    assert.ok(
      scrollWidth <= clientWidth,
      `弹层内容横向溢出：clientWidth=${clientWidth}, scrollWidth=${scrollWidth}`,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
