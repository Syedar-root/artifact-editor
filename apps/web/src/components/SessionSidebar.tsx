import type { Workbench } from "../hooks/use-workbench";
import { X, Plus, MessageSquare } from "lucide-react";
import { formatSessionTime } from "../format";

type Props = Pick<
  Workbench,
  | "sidebarOpen"
  | "setSidebarOpen"
  | "isThinking"
  | "activeArtifact"
  | "startNewSession"
  | "sessionsLoading"
  | "sessionsError"
  | "sessions"
  | "activeSessionId"
  | "openSession"
>;

export function SessionSidebar(props: Props) {
  const {
    sidebarOpen,
    setSidebarOpen,
    isThinking,
    activeArtifact,
    startNewSession,
    sessionsLoading,
    sessionsError,
    sessions,
    activeSessionId,
    openSession,
  } = props;

  return (
    <aside
      className={`history-rail ${sidebarOpen ? "is-open" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setSidebarOpen(false);
          document.querySelector<HTMLButtonElement>(".mobile-only")?.focus();
        }
      }}
    >
      <div className="history-heading">
        <div>
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
            disabled={isThinking || !activeArtifact}
            onClick={startNewSession}
          >
            <Plus size={17} />
          </button>
        </div>
      </div>

      <div className="session-list" aria-label="对话列表">
        {sessionsLoading && (
          <div className="session-list-state">正在加载对话…</div>
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
            <span className="session-item-topline" title={session.title}>
              <MessageSquare size={14} aria-hidden="true" />
              <strong>{session.title}</strong>
              <time>{formatSessionTime(session.updatedAt)}</time>
            </span>
            <span className="session-preview">{session.preview}</span>
          </button>
        ))}
      </div>

      <div className={`history-status ${activeArtifact ? "is-connected" : ""}`}>
        <span />{" "}
        {activeArtifact ? "工作区已连接" : "等待连接"}
      </div>
    </aside>
  );
}
