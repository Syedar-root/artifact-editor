import type { Workbench } from "../hooks/use-workbench";
import { useState, useRef, useEffect } from "react";
import type { FocusEvent as ReactFocusEvent } from "react";
import { RefreshCw, History, ChevronDown } from "lucide-react";

type Props = Pick<
  Workbench,
  | "checkpointState"
  | "checkpointLoading"
  | "isThinking"
  | "checkpoints"
  | "resumeLatestCheckpoint"
  | "changeCheckpoint"
  | "activeArtifactId"
>;

export function CheckpointSwitcher(props: Props) {
  const {
    checkpointState,
    checkpointLoading,
    isThinking,
    checkpoints,
    resumeLatestCheckpoint,
    changeCheckpoint,
    activeArtifactId,
  } = props;
  const [checkpointMenuOpen, setCheckpointMenuOpen] = useState(false);

  const checkpointMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!checkpointMenuOpen) return undefined;
    function closeCheckpointMenuOnOutsidePointer(event: PointerEvent) {
      if (!checkpointMenuRef.current?.contains(event.target as Node)) {
        setCheckpointMenuOpen(false);
      }
    }
    document.addEventListener(
      "pointerdown",
      closeCheckpointMenuOnOutsidePointer,
    );
    return () =>
      document.removeEventListener(
        "pointerdown",
        closeCheckpointMenuOnOutsidePointer,
      );
  }, [checkpointMenuOpen]);

  useEffect(() => setCheckpointMenuOpen(false), [activeArtifactId]);

  function closeCheckpointMenuOnBlur(event: ReactFocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (!nextTarget || !event.currentTarget.contains(nextTarget as Node)) {
      setCheckpointMenuOpen(false);
    }
  }
  return (
    <div
      ref={checkpointMenuRef}
      className="checkpoint-switcher"
      onBlur={closeCheckpointMenuOnBlur}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setCheckpointMenuOpen(false);
          checkpointMenuRef.current?.querySelector<HTMLButtonElement>(".checkpoint-button")?.focus();
        }
      }}
    >
      <button
        type="button"
        className="checkpoint-button"
        disabled={!checkpointState || checkpointLoading || isThinking}
        aria-busy={checkpointLoading}
        aria-expanded={checkpointMenuOpen}
        aria-haspopup="menu"
        title="切换版本"
        onClick={() => setCheckpointMenuOpen((current) => !current)}
      >
        {checkpointLoading ? (
          <RefreshCw className="checkpoint-spinner" size={15} />
        ) : (
          <History size={15} />
        )}
        V
        {checkpointState?.activeVersion ??
          checkpointState?.workspaceVersion ??
          "—"}
        <ChevronDown size={13} />
      </button>
      {checkpointMenuOpen && (
        <div
          className="checkpoint-menu"
          role="menu"
          aria-label="Checkpoint 版本"
        >
          <div className="checkpoint-menu-heading">
            <strong>版本记录</strong>
            <span>当前版本 V{checkpointState?.workspaceVersion ?? "—"}</span>
          </div>
          {checkpoints.map((checkpoint) => {
            const isActive =
              checkpoint.version === checkpointState?.activeVersion;
            const isWorkspace =
              checkpoint.version === checkpointState?.workspaceVersion;
            return (
              <button
                type="button"
                role="menuitem"
                className={isActive ? "is-active" : ""}
                key={checkpoint.tag}
                disabled={isActive || checkpointLoading}
                onClick={() => {
                  setCheckpointMenuOpen(false);
                  if (isWorkspace) resumeLatestCheckpoint();
                  else changeCheckpoint(checkpoint.version, "preview");
                }}
              >
                <span className="checkpoint-version">
                  V{checkpoint.version}
                </span>
                <span className="checkpoint-description">
                  <b>{checkpoint.message}</b>
                  <small>
                    {new Date(checkpoint.createdAt).toLocaleString("zh-CN")}
                  </small>
                </span>
                {isWorkspace && <em>当前</em>}
                {isActive && !isWorkspace && <em>正在查看</em>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
