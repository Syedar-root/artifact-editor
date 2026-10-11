import type { ComponentProps } from "react";
import type { Workbench } from "../hooks/use-workbench";
import {
  Globe2,
  Code2,
  ScanSearch,
  RefreshCw,
  ExternalLink,
  Plus,
  Sparkles,
  MessageSquareText,
  X,
  Check,
} from "lucide-react";
import { CheckpointSwitcher } from "./CheckpointSwitcher";
import { ElementEditorPopover } from "./ElementEditorPopover";
import { CodeBrowser } from "./CodeBrowser";
import { formatElementSelector } from "../format";

type Props = Pick<
  Workbench,
  | "view"
  | "setView"
  | "isElementPicking"
  | "isHistoricalPreview"
  | "refreshPreview"
  | "refreshing"
  | "activeArtifact"
  | "checkpointError"
  | "checkpointState"
  | "checkpointLoading"
  | "changeCheckpoint"
  | "resumeLatestCheckpoint"
  | "previewKey"
  | "previewIframeRef"
  | "previewArtifactId"
  | "selectedElements"
  | "elementEditTarget"
  | "editSelectedElement"
  | "isThinking"
  | "applySelectionListToComposer"
  | "elementEditorState"
  | "elementEditorPosition"
  | "updateElementEditor"
  | "closeElementEditor"
  | "stopEditing"
  | "togglePicking"
  | "clearDrafts"
  | "removeDraft"
  | "openArtifactDialog"
  | "artifactsLoading"
  | "creatingArtifact"
  | "shareUrl"
  | "shareError"
> &
  ComponentProps<typeof CodeBrowser> &
  ComponentProps<typeof CheckpointSwitcher>;

export function PreviewPanel(props: Props) {
  const {
    view,
    setView,
    isElementPicking,
    isHistoricalPreview,
    refreshPreview,
    refreshing,
    activeArtifact,
    checkpointError,
    checkpointState,
    checkpointLoading,
    changeCheckpoint,
    resumeLatestCheckpoint,
    previewKey,
    previewIframeRef,
    previewArtifactId,
    selectedElements,
    elementEditTarget,
    editSelectedElement,
    isThinking,
    applySelectionListToComposer,
    elementEditorState,
    elementEditorPosition,
    updateElementEditor,
    closeElementEditor,
    stopEditing,
    togglePicking,
    clearDrafts,
    removeDraft,
    openArtifactDialog,
    artifactsLoading,
    creatingArtifact,
    shareUrl,
    shareError,
  } = props;

  return (
    <section className="preview-panel" aria-label="产物预览">
      <div className="preview-toolbar">
        <div
          className="view-tabs"
          data-view={view}
          role="tablist"
          aria-label="预览模式"
        >
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
              stopEditing();
              setView("code");
            }}
            role="tab"
            aria-selected={view === "code"}
          >
            <Code2 size={15} /> 代码
          </button>
        </div>

        <div className="preview-tools">
          <CheckpointSwitcher {...props} />
          <button
            type="button"
            className={`edit-mode-button ${isElementPicking ? "is-active" : ""}`}
            aria-label={
              isElementPicking ? "退出元素编辑模式" : "进入元素编辑模式"
            }
            aria-pressed={isElementPicking}
            title={isElementPicking ? "退出元素编辑模式" : "进入元素编辑模式"}
            disabled={isHistoricalPreview}
            onClick={() => {
              if (view !== "preview") setView("preview");
              togglePicking();
            }}
          >
            <ScanSearch size={15} />
            <span className="edit-mode-label">
              {isElementPicking ? "退出编辑" : "编辑页面"}
            </span>
          </button>
          <span className="toolbar-rule" />
          <button
            className="icon-button"
            onClick={refreshPreview}
            aria-label="刷新预览"
            title="刷新预览"
            disabled={!activeArtifact || refreshing || checkpointLoading}
          >
            <RefreshCw size={16} className={refreshing ? "spin" : ""} />
          </button>
          <button
            className="icon-button"
            aria-label="在新窗口打开"
            title="在新窗口打开"
            disabled={!activeArtifact}
            onClick={() =>
              activeArtifact &&
              window.open(
                activeArtifact.previewUrl,
                "_blank",
                "noopener,noreferrer",
              )
            }
          >
            <ExternalLink size={16} />
          </button>
        </div>
      </div>

      {shareUrl && (
        <div className="share-result" role="status">
          <span>此链接固定展示已保存版本</span>
          <input
            aria-label="分享链接"
            value={shareUrl}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <a href={shareUrl} target="_blank" rel="noopener noreferrer">
            打开分享页
          </a>
        </div>
      )}
      {shareError && (
        <div className="checkpoint-error" role="alert">
          {shareError}
        </div>
      )}
      {checkpointError && (
        <div className="checkpoint-error" role="alert">
          {checkpointError}
        </div>
      )}

      <div className="canvas-area">
        {view === "preview" ? (
          <div className="browser-frame">
            <div className="browser-bar">
              <div className="preview-document" title={activeArtifact?.name}>
                <Globe2 size={13} />
                <span>{activeArtifact?.name || "预览"}</span>
              </div>
              {activeArtifact && (
                <span className="preview-live-state">
                  <i />
                  {isHistoricalPreview ? "版本快照" : "实时预览"}
                </span>
              )}
            </div>
            {checkpointState?.mode === "historical-preview" && (
              <div className="checkpoint-notice is-history">
                <span>
                  正在只读查看 <b>V{checkpointState.activeVersion}</b>
                </span>
                <div>
                  <button
                    type="button"
                    disabled={checkpointLoading}
                    onClick={() =>
                      changeCheckpoint(
                        checkpointState.activeVersion || 0,
                        "edit",
                      )
                    }
                  >
                    基于此版本编辑
                  </button>
                  <button
                    type="button"
                    disabled={checkpointLoading}
                    onClick={resumeLatestCheckpoint}
                  >
                    返回 V{checkpointState.workspaceVersion}
                  </button>
                </div>
              </div>
            )}
            {checkpointState?.mode === "editing-history" && (
              <div className="checkpoint-notice is-editing">
                <span>
                  正在基于 <b>V{checkpointState.activeVersion}</b>{" "}
                  编辑，保存后将成为 <b>V{checkpointState.nextVersion}</b>
                </span>
                <button
                  type="button"
                  disabled={checkpointLoading}
                  onClick={resumeLatestCheckpoint}
                >
                  放弃并返回 V{checkpointState.workspaceVersion}
                </button>
              </div>
            )}
            <iframe
              key={previewKey}
              ref={previewIframeRef}
              className="sandbox-preview"
              src={
                activeArtifact && previewArtifactId === activeArtifact.id
                  ? activeArtifact.previewUrl
                  : "about:blank"
              }
              title={
                activeArtifact ? `${activeArtifact.name} 预览` : "产物预览"
              }
            />
            {(!activeArtifact || previewArtifactId !== activeArtifact.id) && (
              <div className="preview-empty-state" role="status">
                <span className="empty-state-mark">
                  <Globe2 size={26} strokeWidth={1.4} />
                </span>
                <h2>
                  {artifactsLoading || activeArtifact
                    ? "正在准备预览…"
                    : "你的创作空间"}
                </h2>
                {!artifactsLoading && !activeArtifact && (
                  <button
                    className="create-artifact-button"
                    disabled={creatingArtifact || isThinking}
                    onClick={openArtifactDialog}
                  >
                    <Plus size={15} /> 创建产物
                  </button>
                )}
              </div>
            )}
            {selectedElements.length > 0 && (
              <aside
                className="element-selection-tray"
                aria-label="元素发送列表"
              >
                <section className="element-selection-queue">
                  <div className="element-selection-tray-heading">
                    <span>
                      <Sparkles size={14} />
                      发送列表
                      <b>{selectedElements.length}</b>
                    </span>
                    <button type="button" onClick={clearDrafts}>
                      清空
                    </button>
                  </div>
                  <div className="element-selection-tray-list" role="list">
                    {selectedElements.map((element) => (
                      <div
                        className={`element-selection-tray-item ${elementEditTarget?.kind === "queue-item" && elementEditTarget.key === element.key ? "is-focused" : ""}`}
                        role="listitem"
                        key={element.key}
                      >
                        <button
                          type="button"
                          className="element-selection-target"
                          onClick={() => editSelectedElement(element)}
                        >
                          <span
                            className="selected-element-icon"
                            aria-hidden="true"
                          >
                            {element.comment ? (
                              <MessageSquareText size={13} />
                            ) : (
                              <Code2 size={13} />
                            )}
                          </span>
                          <span>
                            <code title={element.hint}>
                              {formatElementSelector(element)}
                            </code>
                            {element.comment && (
                              <small>{element.comment}</small>
                            )}
                            {!element.comment && element.changes && (
                              <small>
                                已应用 {element.changes.length} 项样式修改
                              </small>
                            )}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="element-selection-remove"
                          aria-label={`移除 ${element.hint}`}
                          title="移除"
                          onClick={() => removeDraft(element.key)}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="element-selection-apply"
                    disabled={isThinking}
                    onClick={applySelectionListToComposer}
                  >
                    <Check size={14} />
                    添加到对话
                  </button>
                </section>
              </aside>
            )}
            {elementEditorState.status === "editing" &&
              elementEditTarget &&
              (() => {
                const placement = elementEditorPosition();
                return placement ? (
                  <ElementEditorPopover
                    key={
                      elementEditTarget.kind === "queue-item"
                        ? `queue-${elementEditTarget.key}`
                        : "preview-selection"
                    }
                    state={elementEditorState}
                    initialComment={
                      elementEditTarget.kind === "queue-item"
                        ? elementEditTarget.element.comment
                        : ""
                    }
                    position={placement.position}
                    placement={placement.placement}
                    onUpdate={updateElementEditor}
                    onCancel={() => closeElementEditor(false)}
                    onCommit={(comment) => closeElementEditor(true, comment)}
                  />
                ) : null;
              })()}
          </div>
        ) : (
          <CodeBrowser {...props} />
        )}
        {checkpointLoading && (
          <div
            className="checkpoint-loading-overlay"
            role="status"
            aria-live="polite"
          >
            <span>
              <RefreshCw className="checkpoint-spinner" size={17} />
              正在切换版本…
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
