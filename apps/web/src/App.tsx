import { useWorkbench } from "./hooks/use-workbench";
import { AppHeader } from "./components/AppHeader";
import type { CSSProperties } from "react";
import { SessionSidebar } from "./components/SessionSidebar";
import { ChatPanel } from "./components/ChatPanel";
import { PanelResizer } from "./components/PanelResizer";
import { PreviewPanel } from "./components/PreviewPanel";
import { ArtifactCreationDialog } from "./components/ArtifactCreationDialog";

function App() {
  const workbench = useWorkbench();
  const {
    isResizing,
    workspaceRef,
    chatWidth,
    sidebarOpen,
    setSidebarOpen,
    artifactDialogOpen,
  } = workbench;
  return (
    <div className="app-shell">
      <AppHeader {...workbench} />

      <main
        inert={artifactDialogOpen}
        className={`workspace ${isResizing ? "is-resizing" : ""}`}
        ref={workspaceRef}
        style={{ "--chat-width": `${chatWidth}px` } as CSSProperties}
      >
        <SessionSidebar {...workbench} />

        {sidebarOpen && (
          <button
            className="mobile-scrim"
            aria-label="关闭项目列表"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <ChatPanel {...workbench} />

        <PanelResizer {...workbench} />

        <PreviewPanel {...workbench} />
      </main>

      {artifactDialogOpen && <ArtifactCreationDialog {...workbench} />}
    </div>
  );
}

export default App;
