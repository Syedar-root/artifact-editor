import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";
import { createServer } from "vite";
import webConfig from "../../vite.config.js";

const browser = [
  process.env.ARTIFACT_TEST_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find((candidate) => candidate && existsSync(candidate));
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

test(
  "工作台保留预览加载、元素草稿与版本菜单交互",
  {
    skip: !browser && "当前环境没有可用的 Chromium 浏览器",
    timeout: 40_000,
  },
  async () => {
    const artifact = {
      id: "preview-load-fixture",
      name: "预览加载测试",
      technologyStack: "html",
      detectedStack: "html",
      previewUrl: "/proxy/5173/",
      locatorMode: "runtime-hint",
    };
    const chatRequests = [];
    const fileRequests = [];
    const checkpoints = [1, 2].map((version) => ({
      version,
      tag: `checkpoint/v${version}`,
      commitSha: String(version).repeat(40),
      message: `测试版本 ${version}`,
      createdAt: "2026-01-01T00:00:00Z",
    }));
    const build = (version, status = "ready") => ({
      artifactId: artifact.id,
      version,
      commitSha: checkpoints[version - 1].commitSha,
      status,
      previewUrl: `/published/${artifact.id}/${checkpoints[version - 1].commitSha}/`,
    });
    const checkpointState = (version, mode = "latest") => ({
      mode,
      activeVersion: version,
      workspaceVersion: chatRequests.length ? 2 : 1,
      latestVersion: chatRequests.length ? 2 : 1,
      nextVersion: chatRequests.length ? 3 : 2,
      revision: "fixture:1",
    });
    const profile = await mkdtemp(join(tmpdir(), "artifact-preview-test-"));
    let server, child, socket;
    try {
      // 使用独立服务和固定响应，避免启动或切换用户的真实产物。
      server = await createServer({
        ...webConfig,
        configFile: false,
        root: fileURLToPath(new URL("../../", import.meta.url)),
        server: { host: "127.0.0.1", port: 0 },
        plugins: [
          ...webConfig.plugins,
          {
            name: "preview-load-fixture",
            configureServer(current) {
              current.middlewares.use((request, response, next) => {
                const pathname = new URL(request.url, "http://fixture")
                  .pathname;
                if (pathname === build(1).previewUrl) {
                  response.setHeader(
                    "content-type",
                    "text/html; charset=utf-8",
                  );
                  response.end("<!doctype html><h1>版本 1 快照</h1>");
                  return;
                }
                if (pathname === artifact.previewUrl) {
                  response.setHeader(
                    "content-type",
                    "text/html; charset=utf-8",
                  );
                  response.end(
                    '<!doctype html><h1 style="margin:24px;padding:16px;display:flex;gap:12px"><span>预览</span><span>已加载</span></h1>',
                  );
                  return;
                }
                if (!pathname.startsWith("/api/")) return next();
                if (pathname === "/api/chat") {
                  let body = "";
                  request.on("data", (chunk) => {
                    body += chunk.toString("utf8");
                  });
                  request.on("end", () => {
                    chatRequests.push(JSON.parse(body));
                    response.setHeader(
                      "content-type",
                      "application/json; charset=utf-8",
                    );
                    response.end(
                      JSON.stringify({
                        reply: "测试 Agent 回复",
                        sessionId: "fixture-session",
                        checkpoints: [checkpoints[1], checkpoints[0]],
                        checkpointState: checkpointState(2),
                        build: build(2, "queued"),
                      }),
                    );
                  });
                  return;
                }
                let payload;
                if (pathname === "/api/artifacts")
                  payload = { artifacts: [artifact] };
                else if (pathname === `/api/artifacts/${artifact.id}/start`)
                  payload = { artifact };
                else if (
                  pathname === `/api/artifacts/${artifact.id}/checkpoints`
                )
                  payload = {
                    checkpoints: [{ ...checkpoints[0], build: build(1) }],
                    state: checkpointState(1),
                  };
                else if (pathname === `/api/artifacts/${artifact.id}/builds`)
                  payload = { builds: [build(1), build(2)] };
                else if (pathname === `/api/artifacts/${artifact.id}/share`)
                  payload = { url: build(2).previewUrl, build: build(2) };
                else if (
                  pathname ===
                  `/api/artifacts/${artifact.id}/checkpoints/1/preview`
                )
                  payload = {
                    checkpoints: [checkpoints[1], checkpoints[0]],
                    state: checkpointState(1, "historical-preview"),
                    artifact: { ...artifact, previewUrl: build(1).previewUrl },
                    build: build(1),
                  };
                else if (
                  pathname ===
                  `/api/artifacts/${artifact.id}/checkpoints/resume`
                )
                  payload = {
                    checkpoints: [checkpoints[1], checkpoints[0]],
                    state: checkpointState(2),
                    artifact,
                  };
                else if (pathname === "/api/sessions")
                  payload = { sessions: [] };
                else if (pathname === "/api/sandbox/files")
                  payload = {
                    root: "/workspace/preview-load-fixture",
                    tree: [
                      { name: "index.html", path: "index.html", type: "file" },
                    ],
                    defaultFile: "index.html",
                    truncated: false,
                  };
                else if (pathname === "/api/sandbox/file") {
                  fileRequests.push(
                    new URL(request.url, "http://fixture").searchParams.get(
                      "version",
                    ),
                  );
                  payload = {
                    path: "index.html",
                    content:
                      fileRequests.at(-1) === "1"
                        ? "<h1>版本 1 源码</h1>"
                        : "<h1>代码浏览测试</h1>",
                    size: 27,
                  };
                } else {
                  response.statusCode = 404;
                  payload = { error: `未定义测试接口：${pathname}` };
                }
                response.setHeader(
                  "content-type",
                  "application/json; charset=utf-8",
                );
                response.end(JSON.stringify(payload));
              });
            },
          },
        ],
      });
      await server.listen();
      const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
      child = spawn(
        browser,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-sandbox",
          "--remote-debugging-port=0",
          `--user-data-dir=${profile}`,
          "about:blank",
        ],
        { stdio: "ignore", windowsHide: true },
      );
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      let debuggingPort;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
          debuggingPort = Number(
            (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split(
              "\n",
            )[0],
          );
          break;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          await delay(100);
        }
      }
      assert.ok(debuggingPort, "浏览器调试端口没有启动");
      const target = await fetch(
        `http://127.0.0.1:${debuggingPort}/json/new?about:blank`,
        {
          method: "PUT",
        },
      ).then((response) => response.json());
      socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      let commandId = 0;
      const pending = new Map();
      const previewDocuments = [];
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (pending.has(message.id)) {
          const { resolve, reject, timer } = pending.get(message.id);
          pending.delete(message.id);
          clearTimeout(timer);
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        }
        if (
          message.method === "Network.requestWillBeSent" &&
          message.params.type === "Document" &&
          message.params.request.url === `${baseUrl}${artifact.previewUrl}`
        ) {
          previewDocuments.push(message.params.request.url);
        }
      });
      const command = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const id = ++commandId;
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`浏览器命令超时：${method}`));
          }, 5000);
          pending.set(id, { resolve, reject, timer });
          socket.send(JSON.stringify({ id, method, params }));
        });
      const waitForPreview = async (expectedLoads) => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const result = await command("Runtime.evaluate", {
            expression:
              "document.querySelector('iframe.sandbox-preview')?.contentDocument?.querySelector('h1')?.textContent",
            returnByValue: true,
          });
          if (
            previewDocuments.length >= expectedLoads &&
            result.result.value === "预览已加载"
          ) {
            await delay(500);
            assert.equal(
              previewDocuments.length,
              expectedLoads,
              "每次打开页面，iframe 应只加载一次",
            );
            return;
          }
          await delay(100);
        }
        assert.fail("没有加载预览页面");
      };
      await command("Network.enable");
      await command("Page.enable");
      await command("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await command("Page.navigate", { url: baseUrl });
      await waitForPreview(1);
      await command("Page.reload", { ignoreCache: true });
      await waitForPreview(2);
      await command("Emulation.setFocusEmulationEnabled", { enabled: true });

      const evaluate = async (expression) => {
        const result = await command("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        assert.equal(
          result.exceptionDetails,
          undefined,
          JSON.stringify(result.exceptionDetails),
        );
        return result.result.value;
      };
      const waitFor = async (expression) => {
        for (let attempt = 0; attempt < 50; attempt += 1) {
          if (await evaluate(expression)) return;
          await delay(100);
        }
        assert.fail(`界面状态未满足：${expression}`);
      };

      const screenshot = async (name) => {
        const directory = process.env.ARTIFACT_UI_SCREENSHOT_DIR;
        if (!directory) return;
        await delay(300);
        await mkdir(directory, { recursive: true });
        const { data } = await command("Page.captureScreenshot", {
          format: "png",
        });
        await writeFile(
          join(directory, `${name}.png`),
          Buffer.from(data, "base64"),
        );
      };
      await screenshot("desktop-empty");

      await evaluate(
        "document.querySelector('.prompt-suggestions button').click()",
      );
      await waitFor(
        "document.querySelector('.composer textarea').value === '优化页面布局'",
      );
      assert.equal(
        await evaluate(
          "document.activeElement === document.querySelector('.composer textarea')",
        ),
        true,
      );
      await evaluate(`(() => {
        const input = document.querySelector('.composer textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);

      await evaluate("document.querySelector('.project-switcher').click()");
      await waitFor("!!document.querySelector('.artifact-menu')");
      await evaluate("document.querySelector('.project-switcher').focus()");
      await command("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
      });
      await waitFor("!document.querySelector('.artifact-menu')");
      await evaluate("document.querySelector('.project-switcher').click()");
      await waitFor("!!document.querySelector('.artifact-menu')");
      await evaluate(
        "document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))",
      );
      await waitFor("!document.querySelector('.artifact-menu')");

      await evaluate("document.querySelector('.checkpoint-button').click()");
      await waitFor("!!document.querySelector('.checkpoint-menu')");
      await evaluate(
        "document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))",
      );
      await waitFor("!document.querySelector('.checkpoint-menu')");
      await evaluate("document.querySelector('.checkpoint-button').click()");
      await waitFor("!!document.querySelector('.checkpoint-menu')");
      await evaluate(
        "document.querySelector('.checkpoint-button').focus(); document.querySelector('.composer textarea').focus()",
      );
      await waitFor("!document.querySelector('.checkpoint-menu')");

      await evaluate("document.querySelector('.edit-mode-button').click()");
      await waitFor(
        "document.querySelector('.edit-mode-button').getAttribute('aria-pressed') === 'true'",
      );
      const selectHeading = `(() => {
      const frame = document.querySelector('iframe.sandbox-preview');
      frame.contentDocument.querySelector('h1').dispatchEvent(new frame.contentWindow.MouseEvent('click', { bubbles: true, cancelable: true }));
    })()`;
      await evaluate(selectHeading);
      await waitFor("!!document.querySelector('.element-editor-popover')");
      await screenshot("element-editor");
      const selectionLayout = await evaluate(`(() => {
        const document = window.document.querySelector('iframe.sandbox-preview').contentDocument;
        const overlay = document.querySelector('[data-artifact-inspector="overlay"]');
        const label = overlay.querySelector('[data-artifact-inspector="label"]');
        const bounds = label.getBoundingClientRect();
        const popover = window.document.querySelector('.element-editor-popover');
        return { margin: overlay.querySelectorAll('[data-artifact-inspector="margin"]').length,
          padding: overlay.querySelectorAll('[data-artifact-inspector="padding"]').length,
          gap: overlay.querySelectorAll('[data-artifact-inspector="gap"]').length,
          left: bounds.left, right: bounds.right,
          top: bounds.top, bottom: bounds.bottom, width: document.defaultView.innerWidth,
          height: document.defaultView.innerHeight, editorWidth: popover.clientWidth,
          editorScrollWidth: popover.scrollWidth };
      })()`);
      assert.equal(selectionLayout.margin, 4, "应绘制四侧 margin");
      assert.equal(selectionLayout.padding, 4, "应绘制四侧 padding");
      assert.equal(selectionLayout.gap, 1, "应绘制子元素之间的 gap");
      assert.ok(
        selectionLayout.left >= 0 &&
          selectionLayout.right <= selectionLayout.width,
      );
      assert.ok(
        selectionLayout.top >= 0 &&
          selectionLayout.bottom <= selectionLayout.height,
      );
      assert.ok(
        selectionLayout.editorScrollWidth <= selectionLayout.editorWidth,
      );
      await evaluate(
        "document.querySelectorAll('.element-editor-tabs button')[1].click()",
      );
      await waitFor(
        "!!document.querySelector('.element-editor-comment textarea')",
      );
      await screenshot("element-ai-comment");
      await evaluate(
        "document.querySelectorAll('.element-editor-tabs button')[0].click()",
      );
      await waitFor("!!document.querySelector('.element-editor-fields')");
      await evaluate(
        "document.querySelector('.element-editor-group:not([open]) summary').click()",
      );
      assert.ok(
        await evaluate(
          "document.querySelectorAll('.element-editor-group[open]').length > 0",
        ),
        "属性分组可以展开",
      );
      await evaluate(
        "document.querySelector('.element-editor-actions .is-primary').click()",
      );
      await waitFor(
        "document.querySelectorAll('.element-selection-tray-item').length === 1",
      );
      await screenshot("element-selection-tray");
      assert.equal(
        await evaluate(
          "document.querySelector('.edit-mode-button').getAttribute('aria-pressed')",
        ),
        "true",
      );

      await evaluate(
        "document.querySelector('.element-selection-tray-heading > button').click()",
      );
      await waitFor("!document.querySelector('.element-selection-tray')");
      assert.equal(
        await evaluate(
          "document.querySelector('.edit-mode-button').getAttribute('aria-pressed')",
        ),
        "true",
      );

      await evaluate(selectHeading);
      await waitFor("!!document.querySelector('.element-editor-popover')");
      await evaluate(
        "document.querySelector('.element-editor-format-row button[aria-label=粗体]').click()",
      );
      await waitFor(
        "document.querySelector('iframe.sandbox-preview').contentDocument.querySelector('h1').style.fontWeight === '400'",
      );
      await evaluate(
        "document.querySelectorAll('.element-editor-tabs button')[1].click()",
      );
      await waitFor(
        "!!document.querySelector('.element-editor-comment textarea')",
      );
      await evaluate(`(() => {
        const input = document.querySelector('.element-editor-comment textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '降低标题字重，保留当前布局');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await waitFor(
        "document.querySelector('.element-editor-comment textarea').value === '降低标题字重，保留当前布局'",
      );
      await evaluate(
        "document.querySelector('.element-editor-actions .is-primary').click()",
      );
      await waitFor("!!document.querySelector('.element-selection-apply')");
      await evaluate(
        "document.querySelector('.element-selection-apply').click()",
      );
      await waitFor(
        "document.querySelector('.edit-mode-button').getAttribute('aria-pressed') === 'false'",
      );
      assert.equal(
        await evaluate(
          "document.querySelectorAll('.selected-element-item').length",
        ),
        1,
      );

      await evaluate("document.querySelector('.send-button').click()");
      await waitFor(
        "document.querySelector('.messages').textContent.includes('测试 Agent 回复')",
      );
      assert.equal(chatRequests.length, 1);
      assert.equal(chatRequests[0].artifactId, artifact.id);
      assert.equal(chatRequests[0].checkpointRevision, "fixture:1");
      assert.match(chatRequests[0].message, /<artifact-editor-context>/u);
      assert.match(chatRequests[0].message, /预览已加载/u);
      assert.match(chatRequests[0].message, /降低标题字重，保留当前布局/u);
      assert.match(chatRequests[0].message, /fontWeight/u);
      await waitForPreview(3);
      await screenshot("desktop-chat");

      await evaluate(
        "document.querySelectorAll('.view-tabs button')[1].click()",
      );
      await waitFor(
        "document.querySelector('.code-content code')?.textContent === '<h1>代码浏览测试</h1>'",
      );
      assert.equal(
        await evaluate("document.querySelectorAll('.file-tree-row').length"),
        1,
      );
      await screenshot("desktop-code");
      await evaluate(
        "document.querySelectorAll('.view-tabs button')[0].click()",
      );
      await waitForPreview(4);

      await waitFor(
        "document.querySelector('.header-actions [role=status]')?.textContent.includes('V2 已构建')",
      );
      await evaluate(
        "Array.from(document.querySelectorAll('.header-actions button')).find(button => button.textContent.includes('分享')).click()",
      );
      await waitFor("!!document.querySelector('.share-result input')");
      assert.equal(
        await evaluate("document.querySelector('.share-result input').value"),
        baseUrl + build(2).previewUrl,
      );
      await screenshot("share-version");
      await evaluate("document.querySelector('.checkpoint-button').click()");
      await waitFor("!!document.querySelector('.checkpoint-menu')");
      await evaluate(
        "Array.from(document.querySelectorAll('.checkpoint-menu button')).find(button => button.querySelector('.checkpoint-version')?.textContent === 'V1').click()",
      );
      await waitFor(
        "document.querySelector('iframe.sandbox-preview')?.contentDocument?.querySelector('h1')?.textContent === '版本 1 快照'",
      );
      assert.equal(
        await evaluate("document.querySelector('.edit-mode-button').disabled"),
        true,
      );
      assert.equal(
        await evaluate(
          "document.querySelector('.preview-live-state').textContent",
        ),
        "版本快照",
      );
      assert.equal(
        await evaluate("!!document.querySelector('.share-result')"),
        false,
      );
      await evaluate(
        "document.querySelectorAll('.view-tabs button')[1].click()",
      );
      await waitFor(
        "document.querySelector('.code-content code')?.textContent === '<h1>版本 1 源码</h1>'",
      );
      assert.equal(fileRequests.at(-1), "1");
      await evaluate(
        "document.querySelectorAll('.view-tabs button')[0].click()",
      );
      await waitFor("!!document.querySelector('.checkpoint-notice button')");
      await screenshot("historical-version");
      await evaluate(
        "Array.from(document.querySelectorAll('.checkpoint-notice button')).find(button => button.textContent.includes('返回')).click()",
      );
      await waitForPreview(5);
      assert.equal(
        await evaluate(
          "document.querySelector('.preview-live-state').textContent",
        ),
        "实时预览",
      );

      await evaluate("document.querySelector('.project-switcher').click()");
      await waitFor("!!document.querySelector('.artifact-create-button')");
      await evaluate(
        "document.querySelector('.artifact-create-button').click()",
      );
      await waitFor("!!document.querySelector('.artifact-dialog')");
      assert.equal(
        await evaluate("document.querySelector('.artifact-field input').value"),
        "",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('.technology-options input:checked').value",
        ),
        "html",
      );
      await screenshot("create-dialog");
      // 原生 Tab 按键验证焦点约束；不能只用合成事件模拟浏览器的焦点移动。
      await evaluate(
        "document.querySelector('.artifact-dialog-heading button').focus()",
      );
      await command("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Tab",
        code: "Tab",
        modifiers: 8,
      });
      assert.equal(
        await evaluate(
          "document.activeElement === document.querySelector('.artifact-dialog-actions button[type=button]')",
        ),
        true,
      );
      await command("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Tab",
        code: "Tab",
      });
      assert.equal(
        await evaluate(
          "document.activeElement === document.querySelector('.artifact-dialog-heading button')",
        ),
        true,
      );
      await command("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
      });
      await waitFor("!document.querySelector('.artifact-dialog')");
      assert.equal(
        await evaluate(
          "document.activeElement === document.querySelector('.project-switcher')",
        ),
        true,
      );
      await evaluate(
        "document.querySelector('.create-artifact-button').click()",
      );
      await waitFor("!!document.querySelector('.artifact-dialog')");
      await evaluate(
        "document.querySelector('.artifact-dialog-heading button').click()",
      );
      await waitFor("!document.querySelector('.artifact-dialog')");

      for (const width of [1024, 390, 320]) {
        await command("Emulation.setDeviceMetricsOverride", {
          width,
          height: 844,
          deviceScaleFactor: 1,
          mobile: width < 760,
        });
        await delay(300);
        const layout = await evaluate(`(() => {
        const preview = document.querySelector('.preview-panel').getBoundingClientRect();
        const toolbar = document.querySelector('.preview-toolbar');
        return { width: innerWidth, documentWidth: document.documentElement.scrollWidth,
          previewRight: preview.right, previewHeight: preview.height,
          toolbarWidth: toolbar.clientWidth, toolbarScrollWidth: toolbar.scrollWidth };
      })()`);
        assert.ok(
          layout.documentWidth <= layout.width,
          `页面横向溢出：${JSON.stringify(layout)}`,
        );
        assert.ok(
          layout.previewRight <= layout.width && layout.previewHeight > 0,
          "预览区域应可见",
        );
        assert.ok(
          layout.toolbarScrollWidth <= layout.toolbarWidth,
          `预览工具栏溢出：${JSON.stringify(layout)}`,
        );
        assert.equal(
          await evaluate(
            "getComputedStyle(document.querySelector('.composer-actions')).display",
          ),
          "flex",
        );
        if (width === 1024) {
          await evaluate("document.querySelector('.panel-resizer').focus()");
          await command("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "End",
            code: "End",
          });
          await delay(100);
          assert.ok(
            await evaluate(
              "document.querySelector('.preview-panel').getBoundingClientRect().width >= 320",
            ),
            "键盘调整宽度后预览应保留可用空间",
          );
          await command("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "Home",
            code: "Home",
          });
          await delay(100);
          assert.equal(
            await evaluate(
              "document.querySelector('.chat-panel').getBoundingClientRect().width",
            ),
            320,
          );
        }
        await screenshot(`viewport-${width}`);
        if (width === 390) {
          await evaluate("document.querySelector('.edit-mode-button').click()");
          await evaluate(selectHeading);
          await waitFor("!!document.querySelector('.element-editor-popover')");
          await screenshot("mobile-element-editor");
          const editorBounds = await evaluate(`(() => {
          const frame = document.querySelector('iframe.sandbox-preview').getBoundingClientRect();
          const editor = document.querySelector('.element-editor-popover').getBoundingClientRect();
          const footer = document.querySelector('.element-editor-actions').getBoundingClientRect();
          return { top: editor.top, bottom: editor.bottom, left: editor.left, right: editor.right,
            frameTop: frame.top, frameBottom: frame.bottom, frameLeft: frame.left,
            frameRight: frame.right, footerBottom: footer.bottom };
        })()`);
          assert.ok(
            editorBounds.top >= editorBounds.frameTop &&
              editorBounds.bottom <= editorBounds.frameBottom,
          );
          assert.ok(
            editorBounds.left >= editorBounds.frameLeft &&
              editorBounds.right <= editorBounds.frameRight,
          );
          assert.ok(editorBounds.footerBottom <= editorBounds.bottom);
          await evaluate(
            "document.querySelector('.element-editor-heading button').click()",
          );
          await waitFor("!document.querySelector('.element-editor-popover')");
          await evaluate("document.querySelector('.edit-mode-button').click()");
        }
      }
      await evaluate("document.querySelector('.mobile-only').click()");
      await waitFor(
        "document.querySelector('.history-rail').classList.contains('is-open')",
      );
      await evaluate("document.querySelector('.mobile-scrim').click()");
      await waitFor(
        "!document.querySelector('.history-rail').classList.contains('is-open')",
      );
      await command("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      assert.equal(
        await evaluate(
          "getComputedStyle(document.querySelector('.view-tabs'), '::before').transitionDuration",
        ),
        "1e-05s",
      );
    } finally {
      socket?.close();
      if (child && child.exitCode === null) {
        const stopped = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await Promise.race([stopped, delay(2000)]);
      }
      await server?.close();
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  },
);
