import type { Workbench } from "../hooks/use-workbench";
import { useEffect, useRef } from "react";
import {
  Menu,
  ChevronDown,
  Layers2,
  Plus,
  X,
  Share2,
  RefreshCw,
} from "lucide-react";
import { technologyLabel } from "../artifact-config";

type Props = Pick<
  Workbench,
  | "setSidebarOpen"
  | "artifactMenuOpen"
  | "setArtifactMenuOpen"
  | "artifactsLoading"
  | "activeArtifact"
  | "artifacts"
  | "activeArtifactId"
  | "activateArtifact"
  | "creatingArtifact"
  | "openArtifactDialog"
  | "artifactsError"
  | "isThinking"
  | "artifactDialogOpen"
  | "shareArtifact"
  | "shareLoading"
  | "activeBuild"
>;

export function AppHeader(props: Props) {
  const {
    setSidebarOpen,
    artifactMenuOpen,
    setArtifactMenuOpen,
    artifactsLoading,
    activeArtifact,
    artifacts,
    activeArtifactId,
    activateArtifact,
    creatingArtifact,
    openArtifactDialog,
    artifactsError,
    isThinking,
    artifactDialogOpen,
    shareArtifact,
    shareLoading,
    activeBuild,
  } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const switcherRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!artifactMenuOpen) return;
    function dismiss(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setArtifactMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [artifactMenuOpen, setArtifactMenuOpen]);

  return (
    <header className="app-header" inert={artifactDialogOpen}>
      <div className="brand-cluster">
        <button
          className="icon-button mobile-only"
          aria-label="打开项目列表"
          onClick={() => setSidebarOpen(true)}
        >
          <Menu size={19} />
        </button>
        <div className="brand" aria-label="Artifact 工作台">
          <span className="brand-mark">
            <Layers2 size={18} strokeWidth={1.8} />
          </span>
          <span>Artifact</span>
        </div>
        <span className="header-separator" />
        <div
          className="artifact-switcher"
          ref={menuRef}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setArtifactMenuOpen(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setArtifactMenuOpen(false);
              switcherRef.current?.focus();
            }
          }}
        >
          <button
            ref={switcherRef}
            className="project-switcher"
            disabled={isThinking || creatingArtifact}
            aria-haspopup="menu"
            aria-expanded={artifactMenuOpen}
            onClick={() => setArtifactMenuOpen((current) => !current)}
          >
            <span>
              {artifactsLoading
                ? "正在加载…"
                : activeArtifact?.name || "选择产物"}
            </span>
            <ChevronDown size={14} />
          </button>
          {artifactMenuOpen && (
            <div className="artifact-menu" role="menu">
              <div className="artifact-menu-label">产物</div>
              {artifacts.map((artifact) => (
                <button
                  type="button"
                  role="menuitem"
                  className={
                    artifact.id === activeArtifactId ? "is-active" : ""
                  }
                  onClick={() => activateArtifact(artifact.id)}
                  key={artifact.id}
                >
                  <span>{artifact.name}</span>
                  {artifact.id === activeArtifactId && (
                    <span className="menu-selected-dot" />
                  )}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                className="artifact-create-button"
                disabled={creatingArtifact || isThinking}
                onClick={openArtifactDialog}
              >
                <Plus size={14} />
                {creatingArtifact ? "正在创建…" : "创建产物"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="header-actions">
        {activeBuild && (
          <span
            className={`save-state build-state ${activeBuild.status === "failed" ? "is-error" : ""}`}
            title={activeBuild.error}
            role="status"
          >
            {activeBuild.status === "ready"
              ? `V${activeBuild.version} 已构建`
              : activeBuild.status === "failed"
                ? `V${activeBuild.version} 构建失败`
                : `V${activeBuild.version} 构建中…`}
          </span>
        )}
        <button
          className="share-artifact-button"
          aria-label={shareLoading ? "正在准备分享" : "分享产物"}
          title="分享已保存版本"
          onClick={shareArtifact}
          disabled={!activeArtifact || shareLoading || isThinking}
        >
          {shareLoading ? (
            <RefreshCw size={15} className="spin" />
          ) : (
            <Share2 size={15} />
          )}
          <span>{shareLoading ? "正在准备…" : "分享"}</span>
        </button>
        {artifactsError ? (
          <span
            className="save-state is-error"
            role="alert"
            title={artifactsError}
          >
            <X size={13} />
            {artifactsError}
          </span>
        ) : (
          activeArtifact && (
            <span className="stack-badge">
              {technologyLabel(activeArtifact.detectedStack)}
            </span>
          )
        )}
        <button
          className="create-artifact-button"
          aria-label="新建产物"
          disabled={creatingArtifact || isThinking}
          onClick={openArtifactDialog}
        >
          <Plus size={15} /> <span>新建产物</span>
        </button>
      </div>
    </header>
  );
}
