import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  ExternalLink,
  FileCode2,
  Folder,
  FolderOpen,
  Globe2,
  Laptop,
  Menu,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  ScanSearch,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import {
  createElementInspectorOverlay,
  figmaInspectorTheme,
} from "./element-inspector-overlay";
import type { ElementInspectorOverlay } from "./element-inspector-overlay";
import { createElementInspector } from "./sdk/element-inspector";
import type { ElementInspector, ElementSelection } from "./sdk/element-inspector";

type MessageRole = "user" | "agent";

interface ChatMessage {
  id: string | number;
  role: MessageRole;
  text: string;
  time: string;
  details?: string[];
  error?: boolean;
}

interface ApiMessage {
  id: string | number;
  role: MessageRole;
  text: string;
  timestamp: string;
  error?: boolean;
}

interface SessionSummary {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  messageCount: number;
}

interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

interface SelectedElementItem extends ElementSelection {
  key: number;
}

const initialMessages: ChatMessage[] = [];

const SANDBOX_PREVIEW_URL = "/proxy/5173/";

const DEFAULT_CHAT_WIDTH = 420;
const MIN_CHAT_WIDTH = 320;
const MAX_CHAT_WIDTH = 640;
const MIN_PREVIEW_WIDTH = 560;
const RAIL_WIDTH = 220;
const RESIZER_WIDTH = 7;

function formatMessageTime(timestamp: string | number | Date) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatSessionTime(timestamp: string | number | Date) {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return formatMessageTime(timestamp);
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function treeContainsFile(nodes: FileTreeNode[], filePath: string): boolean {
  return nodes.some(
    (node) =>
      (node.type === "file" && node.path === filePath) ||
      (node.type === "directory" && treeContainsFile(node.children || [], filePath)),
  );
}

function firstFilePath(nodes: FileTreeNode[]): string {
  for (const node of nodes) {
    if (node.type === "file") return node.path;
    if (node.type === "directory") {
      const nestedFile = firstFilePath(node.children || []);
      if (nestedFile) return nestedFile;
    }
  }
  return "";
}

function App() {
  const [messages, setMessages] = useState(initialMessages);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [view, setView] = useState<"preview" | "code">("preview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isElementPicking, setIsElementPicking] = useState(false);
  const [selectedElements, setSelectedElements] = useState<SelectedElementItem[]>([]);
  const [previewKey, setPreviewKey] = useState(0);
  const [codeTree, setCodeTree] = useState<FileTreeNode[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState("");
  const [codeRefreshKey, setCodeRefreshKey] = useState(0);
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    () => new Set(["src", "public"]),
  );
  const [version, setVersion] = useState(3);
  const [chatWidth, setChatWidth] = useState(() => {
    const savedWidth = Number(window.localStorage.getItem("artifact-chat-width"));
    return Number.isFinite(savedWidth) && savedWidth >= MIN_CHAT_WIDTH
      ? savedWidth
      : DEFAULT_CHAT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const sendMessageRef = useRef<((messageOverride?: string) => Promise<string | null>) | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const elementInspectorRef = useRef<ElementInspector | null>(null);
  const elementInspectorOverlayRef = useRef<ElementInspectorOverlay | null>(null);
  const selectedElementKeyRef = useRef(0);

  const canSend = input.trim().length > 0 && !isThinking;

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || null,
    [activeSessionId, sessions],
  );

  useEffect(() => {
    const lifecycle = new AbortController();

    async function hydrateSessions() {
      try {
        const nextSessions = await fetchSessionList(lifecycle.signal);
        if (nextSessions[0]) await openSession(nextSessions[0].id, lifecycle.signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSessionsError(error instanceof Error ? error.message : "无法读取会话历史");
      } finally {
        if (!lifecycle.signal.aborted) setSessionsLoading(false);
      }
    }

    hydrateSessions();
    return () => lifecycle.abort();
  }, []);

  useEffect(() => {
    const container = messagesRef.current;
    container?.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

  useEffect(() => {
    window.localStorage.setItem("artifact-chat-width", String(chatWidth));
  }, [chatWidth]);

  useEffect(() => {
    if (view !== "preview") return undefined;
    const iframe = previewIframeRef.current;
    if (!iframe) return undefined;

    const overlay = createElementInspectorOverlay({
      iframe,
      theme: figmaInspectorTheme,
    });
    const inspector = createElementInspector({
      iframe,
      onInspect: overlay.render,
      onSelect(selection: ElementSelection) {
        selectedElementKeyRef.current += 1;
        setSelectedElements((current) => [
          ...current,
          { ...selection, key: selectedElementKeyRef.current },
        ]);
      },
      onCancel() {
        setIsElementPicking(false);
      },
    });

    elementInspectorRef.current = inspector;
    elementInspectorOverlayRef.current = overlay;
    return () => {
      inspector.destroy();
      overlay.destroy();
      if (elementInspectorRef.current === inspector) elementInspectorRef.current = null;
      if (elementInspectorOverlayRef.current === overlay) elementInspectorOverlayRef.current = null;
    };
  }, [previewKey, view]);

  useEffect(() => {
    const active = isElementPicking && view === "preview";
    elementInspectorOverlayRef.current?.setActive(active);
    elementInspectorRef.current?.setEnabled(active);
  }, [isElementPicking, previewKey, view]);

  useEffect(() => {
    if (view !== "code") return undefined;
    const lifecycle = new AbortController();
    loadSandboxCode(lifecycle.signal);
    return () => lifecycle.abort();
  }, [view, codeRefreshKey]);

  useEffect(() => {
    if (!isResizing) return undefined;

    document.body.classList.add("is-resizing-panels");
    const handlePointerMove = (event: PointerEvent) => {
      const bounds = workspaceRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const availableMax = bounds.width - RAIL_WIDTH - RESIZER_WIDTH - MIN_PREVIEW_WIDTH;
      const nextWidth = event.clientX - bounds.left - RAIL_WIDTH;
      setChatWidth(Math.min(Math.max(nextWidth, MIN_CHAT_WIDTH), Math.min(MAX_CHAT_WIDTH, availableMax)));
    };
    const stopResizing = () => setIsResizing(false);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing, { once: true });
    window.addEventListener("pointercancel", stopResizing, { once: true });

    return () => {
      document.body.classList.remove("is-resizing-panels");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [isResizing]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return undefined;

    const lifecycle = new AbortController();
    const registration = context.registerTool(
      {
        name: "send_agent_message",
        title: "给 pi Agent 发消息",
        description: "向沙箱中的 pi Agent 发送一条消息，并等待完整回复。",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string", minLength: 1 },
          },
          required: ["message"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        async execute(input) {
          if (!input || typeof input.message !== "string" || !input.message.trim()) {
            throw new Error("message 必须是非空字符串");
          }
          const reply = await sendMessageRef.current?.(input.message);
          if (!reply) throw new Error("Agent 正在处理上一条消息，请稍后再试");
          return { status: "completed", reply };
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

  async function fetchSessionList(signal?: AbortSignal): Promise<SessionSummary[]> {
    const response = await fetch("/api/sessions", { signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "无法读取会话历史");
    const nextSessions: SessionSummary[] = Array.isArray(payload.sessions) ? payload.sessions : [];
    setSessions(nextSessions);
    setSessionsError("");
    return nextSessions;
  }

  async function openSession(sessionId: string, signal?: AbortSignal) {
    if (!sessionId || isThinking) return;
    setActiveSessionId(sessionId);
    setSelectedElements([]);
    setSessionLoading(true);
    setSessionsError("");
    setSidebarOpen(false);

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法读取这个会话");
      const nextMessages = Array.isArray(payload.session?.messages)
        ? payload.session.messages.map((message: ApiMessage) => ({
            ...message,
            time: formatMessageTime(message.timestamp),
            details: message.role === "agent" ? ["来自沙箱中的 pi Agent"] : undefined,
          }))
        : [];
      setMessages(nextMessages);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessages([
        {
          id: `session-error-${Date.now()}`,
          role: "agent",
          error: true,
          text: error instanceof Error ? error.message : "无法读取这个会话",
          time: formatMessageTime(Date.now()),
        },
      ]);
    } finally {
      if (!signal?.aborted) setSessionLoading(false);
    }
  }

  function startNewSession() {
    if (isThinking) return;
    setActiveSessionId(null);
    setMessages([]);
    setInput("");
    setSelectedElements([]);
    setSessionsError("");
    setSidebarOpen(false);
  }

  async function fetchSandboxFile(
    filePath: string,
    signal?: AbortSignal,
    manageLoading = true,
  ) {
    if (!filePath) return;
    if (manageLoading) setCodeLoading(true);
    setCodeError("");
    setSelectedFile(filePath);

    try {
      const response = await fetch(
        `/api/sandbox/file?path=${encodeURIComponent(filePath)}`,
        { signal },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法读取文件内容");
      setFileContent(payload.content || "");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFileContent("");
      setCodeError(error instanceof Error ? error.message : "无法读取文件内容");
    } finally {
      if (manageLoading && !signal?.aborted) setCodeLoading(false);
    }
  }

  async function loadSandboxCode(signal?: AbortSignal) {
    setCodeLoading(true);
    setCodeError("");
    try {
      const response = await fetch("/api/sandbox/files", { signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法读取沙箱代码目录");
      const nextTree: FileTreeNode[] = Array.isArray(payload.tree) ? payload.tree : [];
      setCodeTree(nextTree);
      const nextFile = treeContainsFile(nextTree, selectedFile)
        ? selectedFile
        : payload.defaultFile || firstFilePath(nextTree);
      if (nextFile) await fetchSandboxFile(nextFile, signal, false);
      else {
        setSelectedFile("");
        setFileContent("");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setCodeError(error instanceof Error ? error.message : "无法读取沙箱代码目录");
    } finally {
      if (!signal?.aborted) setCodeLoading(false);
    }
  }

  function toggleDirectory(directoryPath: string) {
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(directoryPath)) next.delete(directoryPath);
      else next.add(directoryPath);
      return next;
    });
  }

  function renderFileTree(nodes: FileTreeNode[], depth = 0): ReactNode[] {
    return nodes.map((node) => {
      const isDirectory = node.type === "directory";
      const isExpanded = isDirectory && expandedDirectories.has(node.path);
      const children = node.children ?? [];
      return (
        <div className="file-tree-node" key={node.path}>
          <button
            className={`file-tree-row ${node.path === selectedFile ? "is-active" : ""}`}
            style={{ paddingLeft: `${10 + depth * 15}px` }}
            onClick={() =>
              isDirectory ? toggleDirectory(node.path) : fetchSandboxFile(node.path)
            }
            aria-expanded={isDirectory ? isExpanded : undefined}
            title={node.path}
          >
            {isDirectory ? (
              <>
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
              </>
            ) : (
              <>
                <span className="file-tree-spacer" />
                <FileCode2 size={14} />
              </>
            )}
            <span>{node.name}</span>
          </button>
          {isDirectory && isExpanded && children.length > 0 && (
            <div>{renderFileTree(children, depth + 1)}</div>
          )}
        </div>
      );
    });
  }

  async function sendMessage(messageOverride?: string): Promise<string | null> {
    const text = typeof messageOverride === "string" ? messageOverride.trim() : input.trim();
    if (!text || isThinking) return null;
    const targetSessionId = activeSessionId;
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
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, sessionId: targetSessionId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "pi Agent 调用失败");

      setActiveSessionId(payload.sessionId);

      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: "agent",
          text: payload.reply,
          time: new Date().toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
          details: ["来自沙箱中的 pi Agent"],
        },
      ]);
      fetchSessionList().catch((error) => {
        setSessionsError(error instanceof Error ? error.message : "无法刷新会话历史");
      });
      return payload.reply;
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: "agent",
          error: true,
          text: error instanceof Error ? error.message : "pi Agent 调用失败",
          time: new Date().toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
        },
      ]);
      return null;
    } finally {
      setIsThinking(false);
      setPreviewKey((current) => current + 1);
      setCodeRefreshKey((current) => current + 1);
    }
  }

  sendMessageRef.current = sendMessage;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  function refreshPreview() {
    setRefreshing(true);
    setPreviewKey((current) => current + 1);
    window.setTimeout(() => setRefreshing(false), 650);
  }

  async function copyCode() {
    await navigator.clipboard?.writeText(fileContent);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") return setChatWidth(MIN_CHAT_WIDTH);
    if (event.key === "End") return setChatWidth(MAX_CHAT_WIDTH);
    setChatWidth((current) =>
      Math.min(
        MAX_CHAT_WIDTH,
        Math.max(MIN_CHAT_WIDTH, current + (event.key === "ArrowRight" ? 24 : -24)),
      ),
    );
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

      <main
        className={`workspace ${isResizing ? "is-resizing" : ""}`}
        ref={workspaceRef}
        style={{ "--chat-width": `${chatWidth}px` } as CSSProperties}
      >
        <aside className={`history-rail ${sidebarOpen ? "is-open" : ""}`}>
          <div className="history-heading">
            <div>
              <span className="history-kicker">PI AGENT</span>
              <strong>对话历史</strong>
            </div>
            <div className="history-heading-actions">
              <button
                className="icon-button close-history"
                aria-label="关闭对话历史"
                onClick={() => setSidebarOpen(false)}
              >
                <X size={17} />
              </button>
              <button
                className="new-session-button"
                aria-label="新建对话"
                title="新建对话"
                disabled={isThinking}
                onClick={startNewSession}
              >
                <Plus size={17} />
              </button>
            </div>
          </div>

          <div className="session-list" aria-label="pi Agent sessions">
            {sessionsLoading && (
              <div className="session-list-state">正在读取 session…</div>
            )}
            {!sessionsLoading && sessionsError && (
              <div className="session-list-state is-error">{sessionsError}</div>
            )}
            {!sessionsLoading && !sessionsError && sessions.length === 0 && (
              <div className="session-list-state">还没有保存的对话</div>
            )}
            {sessions.map((session) => (
              <button
                className={`session-item ${session.id === activeSessionId ? "is-active" : ""}`}
                key={session.id}
                disabled={isThinking}
                onClick={() => openSession(session.id)}
              >
                <span className="session-item-topline">
                  <strong>{session.title}</strong>
                  <time>{formatSessionTime(session.updatedAt)}</time>
                </span>
                <span className="session-preview">{session.preview}</span>
                <span className="session-count">{session.messageCount} 条消息</span>
              </button>
            ))}
          </div>

          <div className="history-status">
            <span /> 沙箱 session 已连接
          </div>
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
              <p className="eyebrow">沙箱对话</p>
              <h1>{activeSession?.title || "新对话"}</h1>
            </div>
            <button className="icon-button" aria-label="更多对话操作">
              <MoreHorizontal size={19} />
            </button>
          </div>

          <div className="messages" aria-live="polite" ref={messagesRef}>
            <div className="day-divider"><span>会话记录</span></div>
            {sessionLoading && (
              <div className="connection-note">
                <span><RefreshCw className="spin" size={16} /></span>
                <div>
                  <strong>正在读取 session</strong>
                  <p>马上显示这个对话的真实历史消息。</p>
                </div>
              </div>
            )}
            {!sessionLoading && messages.length === 0 && (
              <div className="connection-note">
                <span><Sparkles size={16} /></span>
                <div>
                  <strong>{activeSessionId ? "这个 session 暂无消息" : "开始一个新对话"}</strong>
                  <p>消息会保存到沙箱，并可以从左侧继续原来的 session。</p>
                </div>
              </div>
            )}
            {!sessionLoading && messages.map((message) => (
              <article className={`message ${message.role} ${message.error ? "is-error" : ""}`} key={message.id}>
                <div className="message-meta">
                  <span className={`message-avatar ${message.role}`}>
                    {message.role === "agent" ? <Sparkles size={15} /> : "你"}
                  </span>
                  <strong>{message.role === "agent" ? "pi Agent" : "你"}</strong>
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
                  <strong>pi Agent</strong>
                  <span className="thinking-label">正在沙箱中处理</span>
                </div>
                <div className="thinking-dots"><i /><i /><i /></div>
              </article>
            )}
          </div>

          <div className="composer-wrap">
            {selectedElements.length > 0 && (
              <section className="selected-elements-panel" aria-label="已选元素">
                <div className="selected-elements-heading">
                  <span>
                    <ScanSearch size={14} />
                    已选元素
                    <b>{selectedElements.length}</b>
                  </span>
                  <button type="button" onClick={() => setSelectedElements([])}>
                    清空
                  </button>
                </div>
                <div className="selected-elements-list" role="list">
                  {selectedElements.map((element) => (
                    <div className="selected-element-item" role="listitem" key={element.key}>
                      <span className="selected-element-icon" aria-hidden="true">
                        <Code2 size={13} />
                      </span>
                      <code title={element.hint}>{element.hint}</code>
                      <button
                        type="button"
                        aria-label={`移除 ${element.hint}`}
                        title="移除"
                        onClick={() => {
                          setSelectedElements((current) =>
                            current.filter((item) => item.key !== element.key),
                          );
                        }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <div className="composer">
              <textarea
                ref={composerInputRef}
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
                  <button
                    className={`composer-icon ${isElementPicking ? "is-active" : ""}`}
                    aria-label={isElementPicking ? "取消选择元素" : "选择预览元素"}
                    aria-pressed={isElementPicking}
                    title={isElementPicking ? "取消选择元素" : "选择预览元素"}
                    onClick={() => {
                      if (view !== "preview") setView("preview");
                      setIsElementPicking((current) => !current);
                    }}
                  >
                    <ScanSearch size={17} />
                  </button>
                  <button className="model-button">
                    <WandSparkles size={15} /> pi Agent
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
            <p className="composer-hint">
              {isElementPicking
                ? "点击预览中的元素，可连续选择 · Esc 完成"
                : "Enter 发送 · Shift + Enter 换行"}
            </p>
          </div>
        </section>

        <div
          className="panel-resizer"
          role="separator"
          aria-label="调整对话与预览区域宽度"
          aria-orientation="vertical"
          aria-valuemin={MIN_CHAT_WIDTH}
          aria-valuemax={MAX_CHAT_WIDTH}
          aria-valuenow={Math.round(chatWidth)}
          tabIndex={0}
          title="拖动调整宽度 · 双击复位"
          onPointerDown={(event) => {
            event.preventDefault();
            setIsResizing(true);
          }}
          onDoubleClick={() => setChatWidth(DEFAULT_CHAT_WIDTH)}
          onKeyDown={resizeWithKeyboard}
        >
          <span />
        </div>

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
                onClick={() => {
                  setIsElementPicking(false);
                  setView("code");
                }}
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
              <button
                className="icon-button"
                aria-label="在新窗口打开"
                onClick={() => window.open(SANDBOX_PREVIEW_URL, "_blank", "noopener,noreferrer")}
              >
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
                    <span className="secure-dot" /> {window.location.host}/proxy/5173
                  </div>
                  <MoreHorizontal size={16} />
                </div>
                <iframe
                  key={previewKey}
                  ref={previewIframeRef}
                  className="sandbox-preview"
                  src={SANDBOX_PREVIEW_URL}
                  title="沙箱中的原生 HTML 项目"
                />
              </div>
            ) : (
              <div className="code-frame">
                <aside className="code-sidebar" aria-label="沙箱代码目录">
                  <div className="code-sidebar-heading">
                    <span>EXPLORER</span>
                    <strong>html-app</strong>
                  </div>
                  <div className="file-tree">
                    {codeTree.length > 0 ? renderFileTree(codeTree) : (
                      <div className="code-empty-state">
                        {codeLoading ? "正在读取目录…" : "目录为空"}
                      </div>
                    )}
                  </div>
                </aside>

                <section className="code-editor" aria-label="文件内容">
                  <div className="code-heading">
                    <div>
                      <span className="file-dot" />
                      <span title={selectedFile}>{selectedFile || "选择一个文件"}</span>
                    </div>
                    <button onClick={copyCode} disabled={!selectedFile || codeLoading || !!codeError}>
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                      {copied ? "已复制" : "复制"}
                    </button>
                  </div>
                  <div className="code-content">
                    {codeLoading && <div className="code-empty-state">正在读取沙箱文件…</div>}
                    {!codeLoading && codeError && (
                      <div className="code-empty-state is-error">{codeError}</div>
                    )}
                    {!codeLoading && !codeError && selectedFile && (
                      <pre><code>{fileContent}</code></pre>
                    )}
                  </div>
                </section>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
