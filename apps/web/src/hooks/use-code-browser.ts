import type { FileTreeNode } from "../types";
import { useState, useEffect } from "react";

function treeContainsFile(nodes: FileTreeNode[], filePath: string): boolean {
  return nodes.some(
    (node) =>
      (node.type === "file" && node.path === filePath) ||
      (node.type === "directory" &&
        treeContainsFile(node.children || [], filePath)),
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

export function useCodeBrowser({
  activeArtifactId,
  view,
  codeRefreshKey,
  version,
}: {
  activeArtifactId: string | null;
  view: "preview" | "code";
  codeRefreshKey: number;
  version?: number;
}) {
  const [copied, setCopied] = useState(false);

  const [codeTree, setCodeTree] = useState<FileTreeNode[]>([]);

  const [selectedFile, setSelectedFile] = useState("");

  const [fileContent, setFileContent] = useState("");

  const [codeLoading, setCodeLoading] = useState(false);

  const [codeError, setCodeError] = useState("");

  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    () => new Set(["src", "public"]),
  );

  useEffect(() => {
    if (view !== "code") return undefined;
    const lifecycle = new AbortController();
    loadSandboxCode(lifecycle.signal);
    return () => lifecycle.abort();
  }, [activeArtifactId, view, codeRefreshKey, version]);

  async function fetchSandboxFile(
    filePath: string,
    signal?: AbortSignal,
    manageLoading = true,
  ) {
    if (!filePath || !activeArtifactId) return;
    if (manageLoading) setCodeLoading(true);
    setCodeError("");
    setSelectedFile(filePath);

    try {
      const response = await fetch(
        `/api/sandbox/file?artifactId=${encodeURIComponent(activeArtifactId)}&path=${encodeURIComponent(filePath)}${version ? `&version=${version}` : ""}`,
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
    if (!activeArtifactId) return;
    setCodeLoading(true);
    setCodeError("");
    try {
      const response = await fetch(
        `/api/sandbox/files?artifactId=${encodeURIComponent(activeArtifactId)}${version ? `&version=${version}` : ""}`,
        { signal },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "无法读取沙箱代码目录");
      const nextTree: FileTreeNode[] = Array.isArray(payload.tree)
        ? payload.tree
        : [];
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
      setCodeError(
        error instanceof Error ? error.message : "无法读取沙箱代码目录",
      );
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

  async function copyCode() {
    await navigator.clipboard?.writeText(fileContent);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function reset() {
    setCodeTree([]);
    setSelectedFile("");
    setFileContent("");
  }

  return {
    copied,
    codeTree,
    selectedFile,
    fileContent,
    codeLoading,
    codeError,
    expandedDirectories,
    fetchSandboxFile,
    toggleDirectory,
    copyCode,
    reset,
  };
}
