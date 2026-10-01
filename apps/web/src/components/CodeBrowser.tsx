import type { Workbench } from "../hooks/use-workbench";
import { FileTree } from "./FileTree";
import { Check, Copy } from "lucide-react";

type Props = Pick<
  Workbench,
  | "activeArtifact"
  | "codeTree"
  | "selectedFile"
  | "expandedDirectories"
  | "fetchSandboxFile"
  | "toggleDirectory"
  | "codeLoading"
  | "copyCode"
  | "codeError"
  | "copied"
  | "fileContent"
>;

export function CodeBrowser(props: Props) {
  const {
    activeArtifact,
    codeTree,
    selectedFile,
    expandedDirectories,
    fetchSandboxFile,
    toggleDirectory,
    codeLoading,
    copyCode,
    codeError,
    copied,
    fileContent,
  } = props;

  return (
    <div className="code-frame">
      <aside className="code-sidebar" aria-label="沙箱代码目录">
        <div className="code-sidebar-heading">
          <strong title={activeArtifact?.name}>{activeArtifact?.name || "文件"}</strong>
        </div>
        <div className="file-tree">
          {codeTree.length > 0 ? (
            <FileTree
              nodes={codeTree}
              selectedFile={selectedFile}
              expandedDirectories={expandedDirectories}
              onSelectFile={fetchSandboxFile}
              onToggleDirectory={toggleDirectory}
            />
          ) : (
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
          <button
            onClick={copyCode}
            disabled={!selectedFile || codeLoading || !!codeError}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "已复制" : "复制"}
          </button>
        </div>
        <div className="code-content">
          {codeLoading && (
            <div className="code-empty-state">正在读取沙箱文件…</div>
          )}
          {!codeLoading && codeError && (
            <div className="code-empty-state is-error">{codeError}</div>
          )}
          {!codeLoading && !codeError && selectedFile && (
            <pre>
              <code>{fileContent}</code>
            </pre>
          )}
        </div>
      </section>
    </div>
  );
}
