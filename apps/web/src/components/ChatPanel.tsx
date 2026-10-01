import type { Workbench } from "../hooks/use-workbench";
import { useRef, useEffect } from "react";
import {
  RefreshCw,
  Sparkles,
  ScanSearch,
  MessageSquareText,
  Code2,
  X,
  MessageSquare,
  ArrowUp,
} from "lucide-react";
import { resizeComposerInput } from "../composer-input";
import { formatElementSelector } from "../format";

type Props = Pick<
  Workbench,
  | "activeSession"
  | "sessionLoading"
  | "messages"
  | "activeSessionId"
  | "isThinking"
  | "composerElements"
  | "setComposerElements"
  | "composerInputRef"
  | "input"
  | "setInput"
  | "handleKeyDown"
  | "isHistoricalPreview"
  | "canSend"
  | "sendMessage"
>;

export function ChatPanel(props: Props) {
  const {
    activeSession,
    sessionLoading,
    messages,
    activeSessionId,
    isThinking,
    composerElements,
    setComposerElements,
    composerInputRef,
    input,
    setInput,
    handleKeyDown,
    isHistoricalPreview,
    canSend,
    sendMessage,
  } = props;
  const messagesRef = useRef<HTMLDivElement>(null);
  const followMessagesRef = useRef(true);

  useEffect(() => {
    const container = messagesRef.current;
    if (followMessagesRef.current) {
      container?.scrollTo({
        top: container.scrollHeight,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    }
  }, [messages, isThinking]);

  useEffect(() => {
    followMessagesRef.current = true;
  }, [activeSessionId]);

  useEffect(() => {
    if (composerInputRef.current) resizeComposerInput(composerInputRef.current);
  }, [input, composerInputRef]);
  return (
    <section className="chat-panel" aria-label="Agent 对话">
      <div className="panel-heading">
        <div>
          <MessageSquare size={16} aria-hidden="true" />
          <h1>{activeSession?.title || "新对话"}</h1>
        </div>
        {isThinking && <span className="chat-working-dot" aria-label="正在处理" />}
      </div>

      <div
        className={`messages ${!sessionLoading && messages.length === 0 ? "is-empty" : ""}`}
        aria-live="polite"
        ref={messagesRef}
        onScroll={(event) => {
          const container = event.currentTarget;
          followMessagesRef.current =
            container.scrollHeight - container.scrollTop - container.clientHeight < 80;
        }}
      >
        {sessionLoading && (
          <div className="connection-note">
            <span>
              <RefreshCw className="spin" size={16} />
            </span>
            <div>
              <strong>正在加载对话…</strong>
            </div>
          </div>
        )}
        {!sessionLoading && messages.length === 0 && (
          <div className="chat-empty-state">
            <span className="empty-state-mark">
              <Sparkles size={25} strokeWidth={1.5} />
            </span>
            <h2>{activeSessionId ? "继续你的创作" : "从一个想法开始"}</h2>
            <p>描述需求，让想法成为页面。</p>
            <div className="prompt-suggestions">
              {["优化页面布局", "调整配色与字体", "添加交互效果"].map((prompt) => (
                <button
                  key={prompt}
                  disabled={isThinking || isHistoricalPreview}
                  onClick={() => {
                    setInput(prompt);
                    composerInputRef.current?.focus();
                  }}
                >
                  {prompt}<ArrowUp size={13} />
                </button>
              ))}
            </div>
          </div>
        )}
        {!sessionLoading &&
          messages.map((message) => (
            <article
              className={`message ${message.role} ${message.error ? "is-error" : ""}`}
              key={message.id}
            >
              <div className="message-meta">
                <span className={`message-avatar ${message.role}`}>
                  {message.role === "agent" ? <Sparkles size={15} /> : "你"}
                </span>
                <strong>{message.role === "agent" ? "Agent" : "你"}</strong>
                <time>{message.time}</time>
              </div>
              <p>{message.text}</p>
              {message.attachments && message.attachments.length > 0 && (
                <section
                  className="message-element-attachments"
                  aria-label="消息附带的预览元素"
                >
                  <div className="message-element-attachments-heading">
                    <ScanSearch size={13} />
                    <span>附带 {message.attachments.length} 个预览元素</span>
                  </div>
                  <div className="message-element-attachments-list">
                    {message.attachments.map((attachment, index) => (
                      <article
                        className="message-element-attachment"
                        key={`${attachment.hint}-${index}`}
                      >
                        <span
                          className="message-element-attachment-icon"
                          aria-hidden="true"
                        >
                          {attachment.comment ? (
                            <MessageSquareText size={12} />
                          ) : (
                            <Code2 size={12} />
                          )}
                        </span>
                        <span className="message-element-attachment-body">
                          <code title={attachment.hint}>{formatElementSelector(attachment)}</code>
                          {attachment.comment && (
                            <small>{attachment.comment}</small>
                          )}
                          {!attachment.comment &&
                            attachment.changes &&
                            attachment.changes.length > 0 && (
                              <small>
                                已应用 {attachment.changes.length} 项预览修改
                              </small>
                            )}
                          {attachment.source && (
                            <small className="is-source">
                              {attachment.source.file}:{attachment.source.line}
                            </small>
                          )}
                        </span>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </article>
          ))}

        {isThinking && (
          <article className="message agent thinking-message">
            <div className="message-meta">
              <span className="message-avatar agent">
                <Sparkles size={15} />
              </span>
              <strong>Agent</strong>
              <span className="thinking-label">正在处理…</span>
            </div>
            <div className="thinking-dots">
              <i />
              <i />
              <i />
            </div>
          </article>
        )}
      </div>

      <div className="composer-wrap">
        {composerElements.length > 0 && (
          <section
            className="selected-elements-panel"
            aria-label="本次消息附带的元素"
          >
            <div className="selected-elements-heading">
              <span>
                <ScanSearch size={13} />
                已附加到本次消息
                <b>{composerElements.length}</b>
              </span>
              <button type="button" onClick={() => setComposerElements([])}>
                清空
              </button>
            </div>
            <div className="selected-elements-list">
              {composerElements.map((element) => (
                <div className="selected-element-item" key={element.key}>
                  <span className="selected-element-icon" aria-hidden="true">
                    {element.comment ? (
                      <MessageSquareText size={12} />
                    ) : (
                      <Code2 size={12} />
                    )}
                  </span>
                  <code title={element.hint}>
                    {formatElementSelector(element)}
                    {element.comment && <small>{element.comment}</small>}
                    {!element.comment && element.changes && (
                      <small>已应用 {element.changes.length} 项样式修改</small>
                    )}
                  </code>
                  <button
                    type="button"
                    aria-label={`从本次消息移除 ${element.hint}`}
                    title="移除"
                    onClick={() =>
                      setComposerElements((current) =>
                        current.filter((item) => item.key !== element.key),
                      )
                    }
                  >
                    <X size={12} />
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
            onChange={(event) => {
              setInput(event.target.value);
              resizeComposerInput(event.currentTarget);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              isHistoricalPreview
                ? "历史版本为只读，请先基于此版本编辑"
                : "描述你想修改的内容…"
            }
            rows={1}
            aria-label="给 Agent 发消息"
            title="Enter 发送 · Shift + Enter 换行"
            disabled={isHistoricalPreview}
          />
          <div className="composer-actions">
            <div>
              <span className={`composer-agent ${isThinking ? "is-working" : ""}`}>
                <Sparkles size={14} /> Agent
              </span>
            </div>
            <button
              className="send-button"
              aria-label="发送消息"
              title="发送消息（Enter）"
              disabled={!canSend}
              onClick={() => sendMessage()}
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </div>
        {isHistoricalPreview && <p className="composer-hint">当前版本为只读</p>}
      </div>
    </section>
  );
}
