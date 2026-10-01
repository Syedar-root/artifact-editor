import type { FileTreeNode } from "../types";
import type { ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Folder,
  FileCode2,
} from "lucide-react";

interface Props {
  nodes: FileTreeNode[];
  selectedFile: string;
  expandedDirectories: Set<string>;
  onSelectFile(path: string): void;
  onToggleDirectory(path: string): void;
}

export function FileTree({
  nodes,
  selectedFile,
  expandedDirectories,
  onSelectFile,
  onToggleDirectory,
}: Props) {
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
              isDirectory
                ? onToggleDirectory(node.path)
                : onSelectFile(node.path)
            }
            aria-expanded={isDirectory ? isExpanded : undefined}
            title={node.path}
          >
            {isDirectory ? (
              <>
                {isExpanded ? (
                  <ChevronDown size={13} />
                ) : (
                  <ChevronRight size={13} />
                )}
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
  return <>{renderFileTree(nodes)}</>;
}
