import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Code2,
  Copy,
  ExternalLink,
  Globe2,
  History,
  Laptop,
  LayoutPanelLeft,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";

const initialMessages = [
  {
    id: 1,
    role: "user",
    text: "帮我做一个面向独立创作者的项目管理首页。要克制、清晰，重点展示本周进度。",
    time: "10:24",
  },
  {
    id: 2,
    role: "agent",
    text: "我先搭好了页面结构：顶部是问候和本周日期，中间用一条进度轨道串起关键节点，下面放正在进行的项目。",
    time: "10:25",
    details: ["建立页面布局", "整理视觉层级", "生成预览"],
  },
  {
    id: 3,
    role: "user",
    text: "不错。把整体变得更有编辑感，少一点传统仪表盘的感觉。",
    time: "10:27",
  },
  {
    id: 4,
    role: "agent",
    text: "已更新。我放大了排版比例，去掉多余卡片，并用杂志式编号来组织项目。右侧已经是最新版本。",
    time: "10:28",
    details: ["调整字体比例", "重组项目列表", "更新预览 · v3"],
  },
];

const codePreview = `export function WeeklyFocus() {
  return (
    <main className="weekly-focus">
      <header>
        <p>MONDAY · 20 MAY</p>
        <h1>Make room for the\nwork that matters.</h1>
      </header>

      <Progress value={68} />
      <ProjectList projects={projects} />
    </main>
  )
}`;

function App() {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [view, setView] = useState("preview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(3);
  const messagesEndRef = useRef(null);
  const sendMessageRef = useRef(null);

  const canSend = input.trim().length > 0 && !isThinking;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return undefined;

    const lifecycle = new AbortController();
    const registration = context.registerTool(
      {
        name: "send_agent_message",
        title: "给设计 Agent 发消息",
        description: "向当前设计对话发送一条修改要求，并在界面中开始生成新版本。",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string", minLength: 1 },
          },
          required: ["message"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute(input) {
          if (!input || typeof input.message !== "string" || !input.message.trim()) {
            throw new Error("message 必须是非空字符串");
          }
          const accepted = sendMessageRef.current?.(input.message);
          if (!accepted) throw new Error("Agent 正在处理上一条消息，请稍后再试");
          return { status: "queued", message: input.message.trim() };
        },
      },
      { signal: lifecycle.signal },
    );

    Promise.resolve(registration).catch(() => {});
    return () => lifecycle.abort();
  }, []);

  const projectTitle = useMemo(
    () => (version > 3 ? `Creator workspace · v${version}` : "Creator workspace"),
    [version],
  );

  function sendMessage(messageOverride) {
    const text = typeof messageOverride === "string" ? messageOverride.trim() : input.trim();
    if (!text || isThinking) return false;
    const now = new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    setMessages((current) => [
      ...current,
      { id: Date.now(), role: "user", text, time: now },
    ]);
    setInput("");
    setIsThinking(true);

    window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: "agent",
          text: "明白。我已经根据你的描述调整了页面节奏与内容层级，预览也同步到了新版本。",
          time: new Date().toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
          details: ["理解修改意图", "应用界面调整", `生成预览 · v${version + 1}`],
        },
      ]);
      setVersion((current) => current + 1);
      setIsThinking(false);
    }, 1200);
    return true;
  }

  sendMessageRef.current = sendMessage;

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  function refreshPreview() {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 650);
  }

  async function copyCode() {
    await navigator.clipboard?.writeText(codePreview);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-cluster">
          <button
            className="icon-button mobile-only"
            aria-label="打开项目列表"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={19} />
          </button>
          <a className="brand" href="#" aria-label="Artifact 首页">
            <span className="brand-mark">A</span>
            <span>Artifact</span>
          </a>
          <span className="header-separator" />
          <button className="project-switcher">
            <span>{projectTitle}</span>
            <ChevronDown size={14} />
          </button>
        </div>

        <div className="header-actions">
          <span className="save-state"><Check size={13} /> 已保存</span>
          <button className="share-button">分享</button>
          <button className="avatar" aria-label="账户菜单">林</button>
        </div>
      </header>

      <main className="workspace">
        <aside className={`history-rail ${sidebarOpen ? "is-open" : ""}`}>
          <div className="history-top">
            <button
              className="icon-button close-history"
              aria-label="关闭项目列表"
              onClick={() => setSidebarOpen(false)}
            >
              <X size={18} />
            </button>
            <button className="new-project" aria-label="新建项目">
              <Plus size={18} />
            </button>
            <button className="rail-button is-active" aria-label="当前对话">
              <MessageSquareText size={18} />
            </button>
            <button className="rail-button" aria-label="历史记录">
              <History size={18} />
            </button>
          </div>
          <button className="rail-button rail-bottom" aria-label="布局设置">
            <LayoutPanelLeft size={18} />
          </button>
        </aside>

        {sidebarOpen && (
          <button
            className="mobile-scrim"
            aria-label="关闭项目列表"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <section className="chat-panel" aria-label="Agent 对话">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">设计对话</p>
              <h1>Creator workspace</h1>
            </div>
            <button className="icon-button" aria-label="更多对话操作">
              <MoreHorizontal size={19} />
            </button>
          </div>

          <div className="messages" aria-live="polite">
            <div className="day-divider"><span>今天</span></div>
            {messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="message-meta">
                  <span className={`message-avatar ${message.role}`}>
                    {message.role === "agent" ? <Sparkles size={15} /> : "你"}
                  </span>
                  <strong>{message.role === "agent" ? "Artifact" : "你"}</strong>
                  <time>{message.time}</time>
                </div>
                <p>{message.text}</p>
                {message.details && (
                  <div className="agent-steps">
                    {message.details.map((detail) => (
                      <span key={detail}><Check size={12} /> {detail}</span>
                    ))}
                  </div>
                )}
              </article>
            ))}

            {isThinking && (
              <article className="message agent thinking-message">
                <div className="message-meta">
                  <span className="message-avatar agent"><Sparkles size={15} /></span>
                  <strong>Artifact</strong>
                  <span className="thinking-label">正在构思</span>
                </div>
                <div className="thinking-dots"><i /><i /><i /></div>
              </article>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="composer-wrap">
            <div className="composer">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="描述你想修改的内容…"
                rows={2}
                aria-label="给 Agent 发消息"
              />
              <div className="composer-actions">
                <div>
                  <button className="composer-icon" aria-label="添加附件">
                    <Paperclip size={17} />
                  </button>
                  <button className="model-button">
                    <WandSparkles size={15} /> Agent
                    <ChevronDown size={13} />
                  </button>
                </div>
                <button
                  className="send-button"
                  aria-label="发送消息"
                  disabled={!canSend}
                onClick={() => sendMessage()}
                >
                  <ArrowUp size={18} />
                </button>
              </div>
            </div>
            <p className="composer-hint">Enter 发送 · Shift + Enter 换行</p>
          </div>
        </section>

        <section className="preview-panel" aria-label="产物预览">
          <div className="preview-toolbar">
            <div className="view-tabs" role="tablist" aria-label="预览模式">
              <button
                className={view === "preview" ? "is-active" : ""}
                onClick={() => setView("preview")}
                role="tab"
                aria-selected={view === "preview"}
              >
                <Globe2 size={15} /> 预览
              </button>
              <button
                className={view === "code" ? "is-active" : ""}
                onClick={() => setView("code")}
                role="tab"
                aria-selected={view === "code"}
              >
                <Code2 size={15} /> 代码
              </button>
            </div>

            <div className="preview-tools">
              <span className="desktop-label"><Laptop size={15} /> 桌面</span>
              <span className="toolbar-rule" />
              <button className="icon-button" onClick={refreshPreview} aria-label="刷新预览">
                <RefreshCw size={16} className={refreshing ? "spin" : ""} />
              </button>
              <button className="icon-button" aria-label="在新窗口打开">
                <ExternalLink size={16} />
              </button>
            </div>
          </div>

          <div className="canvas-area">
            {view === "preview" ? (
              <div className="browser-frame">
                <div className="browser-bar">
                  <div className="traffic-lights"><i /><i /><i /></div>
                  <div className="address-bar">
                    <span className="secure-dot" /> preview.artifact.local
                  </div>
                  <MoreHorizontal size={16} />
                </div>
                <ArtifactPreview version={version} />
              </div>
            ) : (
              <div className="code-frame">
                <div className="code-heading">
                  <div>
                    <span className="file-dot" /> src/pages/WeeklyFocus.jsx
                  </div>
                  <button onClick={copyCode}>
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                    {copied ? "已复制" : "复制"}
                  </button>
                </div>
                <pre><code>{codePreview}</code></pre>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function ArtifactPreview({ version }) {
  return (
    <div className="artifact-page">
      <nav className="artifact-nav">
        <a href="#">STILL/FORM</a>
        <div>
          <a href="#work">Work</a>
          <a href="#notes">Notes</a>
          <button>New project <Plus size={13} /></button>
        </div>
      </nav>

      <header className="artifact-hero">
        <div className="artifact-kicker">
          <span>MONDAY</span>
          <span>20 MAY</span>
        </div>
        <h2>Make room for<br />the work that matters.</h2>
        <p>Your week, edited down to what deserves your attention.</p>
      </header>

      <section className="week-section">
        <div className="week-heading">
          <div>
            <span>THIS WEEK</span>
            <strong>68%</strong>
          </div>
          <p>4 of 6 milestones complete</p>
        </div>
        <div className="progress-track"><span style={{ width: `${68 + Math.min(version - 3, 3) * 4}%` }} /></div>
        <div className="week-days">
          {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
            <div className={index === 2 ? "today" : index < 4 ? "done" : ""} key={`${day}-${index}`}>
              <i>{index < 4 && index !== 2 ? <Check size={10} /> : index + 1}</i>
              <span>{day}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="project-section" id="work">
        <div className="section-label">
          <span>IN PROGRESS</span>
          <span>03 PROJECTS</span>
        </div>
        <ProjectRow number="01" title="Edition No. 04" meta="Editorial · Due Wed" accent="#ff5d47" />
        <ProjectRow number="02" title="Field Notes" meta="Research · Due Fri" accent="#6457e6" />
        <ProjectRow number="03" title="Studio Refresh" meta="Identity · Next week" accent="#c6d82e" />
      </section>

      <footer className="artifact-footer" id="notes">
        <span>STILL/FORM © 2026</span>
        <span>Make less. Make it count.</span>
      </footer>
    </div>
  );
}

function ProjectRow({ number, title, meta, accent }) {
  return (
    <article className="project-row">
      <span className="project-number">{number}</span>
      <span className="project-accent" style={{ background: accent }} />
      <div>
        <h3>{title}</h3>
        <p>{meta}</p>
      </div>
      <button aria-label={`打开 ${title}`}>↗</button>
    </article>
  );
}

export default App;
