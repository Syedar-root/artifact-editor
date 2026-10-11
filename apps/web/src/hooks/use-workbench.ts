import type {
  ChatMessage,
  ArtifactSummary,
  ArtifactCreationPhase,
  TechnologyStack,
  CheckpointSummary,
  CheckpointState,
  SessionSummary,
  ApiMessage,
  CheckpointPayload,
  ArtifactBuild,
} from "../types";
import { useState, useRef, useMemo, useEffect } from "react";
import { useElementDrafts } from "./use-element-drafts";
import { useCodeBrowser } from "./use-code-browser";
import { usePanelResize } from "./use-panel-resize";
import { formatMessageTime } from "../format";
import { readArtifactProgress } from "../artifact-progress";
import { readJsonResponse } from "../api-response";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  DEFAULT_ELEMENT_PROMPT,
  toMessageElementAttachment,
} from "../element-edit-workflow";

const initialMessages: ChatMessage[] = [];

export function useWorkbench() {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);

  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);

  const [artifactsLoading, setArtifactsLoading] = useState(true);

  const [artifactsError, setArtifactsError] = useState("");

  const [artifactMenuOpen, setArtifactMenuOpen] = useState(false);

  const [creatingArtifact, setCreatingArtifact] = useState(false);

  const [artifactCreationPhase, setArtifactCreationPhase] =
    useState<ArtifactCreationPhase>("idle");

  const [artifactCreationError, setArtifactCreationError] = useState("");

  const [artifactDialogOpen, setArtifactDialogOpen] = useState(false);

  const [artifactDraftName, setArtifactDraftName] = useState("");

  const [artifactDraftStack, setArtifactDraftStack] =
    useState<TechnologyStack>("html");

  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);

  const [checkpointState, setCheckpointState] =
    useState<CheckpointState | null>(null);

  const [checkpointLoading, setCheckpointLoading] = useState(false);

  const [checkpointError, setCheckpointError] = useState("");

  const [shareLoading, setShareLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareError, setShareError] = useState("");
  const shareRequest = useRef<AbortController | null>(null);

  useEffect(() => () => shareRequest.current?.abort(), []);

  const [messages, setMessages] = useState(initialMessages);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [sessionsLoading, setSessionsLoading] = useState(true);

  const [sessionLoading, setSessionLoading] = useState(false);

  const [sessionsError, setSessionsError] = useState("");

  const [isThinking, setIsThinking] = useState(false);

  const [view, setView] = useState<"preview" | "code">("preview");

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [refreshing, setRefreshing] = useState(false);

  const [previewArtifactId, setPreviewArtifactId] = useState<string | null>(
    null,
  );

  const [previewKey, setPreviewKey] = useState(0);

  const [codeRefreshKey, setCodeRefreshKey] = useState(0);

  const sendMessageRef = useRef<
    ((messageOverride?: string) => Promise<string | null>) | null
  >(null);

  const drafts = useElementDrafts({ view, previewKey });
  const { input, setInput, composerElements, setComposerElements } = drafts;
  const codeBrowser = useCodeBrowser({
    activeArtifactId,
    view,
    codeRefreshKey,
    version:
      checkpointState?.mode === "historical-preview"
        ? (checkpointState.activeVersion ?? undefined)
        : undefined,
  });

  const layout = usePanelResize();

  const isHistoricalPreview = checkpointState?.mode === "historical-preview";

  const canSend =
    (input.trim().length > 0 || composerElements.length > 0) &&
    !isThinking &&
    !!activeArtifactId &&
    !isHistoricalPreview;

  const activeArtifact = useMemo(
    () =>
      artifacts.find((artifact) => artifact.id === activeArtifactId) || null,
    [activeArtifactId, artifacts],
  );

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || null,
    [activeSessionId, sessions],
  );

  useEffect(() => {
    const lifecycle = new AbortController();

    async function hydrateArtifacts() {
      try {
        const response = await fetch("/api/artifacts", {
          signal: lifecycle.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "无法读取产物列表");
        const nextArtifacts: ArtifactSummary[] = Array.isArray(
          payload.artifacts,
        )
          ? payload.artifacts
          : [];
        setArtifacts(nextArtifacts);
        const savedArtifactId =
          window.localStorage.getItem("active-artifact-id");
        const initialArtifact =
          nextArtifacts.find((artifact) => artifact.id === savedArtifactId) ||
          nextArtifacts[0];
        if (initialArtifact)
          await activateArtifact(initialArtifact.id, lifecycle.signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setArtifactsError(
          error instanceof Error ? error.message : "无法读取产物列表",
        );
      } finally {
        if (!lifecycle.signal.aborted) {
          setArtifactsLoading(false);
          setSessionsLoading(false);
        }
      }
    }

    hydrateArtifacts();
    return () => lifecycle.abort();
  }, []);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return undefined;

    const lifecycle = new AbortController();
    const registration = context.registerTool(
      {
        name: "send_agent_message",
        title: "给 DSH Agent 发消息",
        description: "向服务端 DSH Agent 发送一条消息，并等待完整回复。",
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
          if (
            !input ||
            typeof input.message !== "string" ||
            !input.message.trim()
          ) {
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

  async function fetchSessionList(
    artifactId = activeArtifactId,
    signal?: AbortSignal,
  ): Promise<SessionSummary[]> {
    if (!artifactId) return [];
    const response = await fetch(
      `/api/sessions?artifactId=${encodeURIComponent(artifactId)}`,
      { signal },
    );
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "无法读取会话历史");
    const nextSessions: SessionSummary[] = Array.isArray(payload.sessions)
      ? payload.sessions
      : [];
    setSessions(nextSessions);
    setSessionsError("");
    return nextSessions;
  }

  async function openSession(
    sessionId: string,
    signal?: AbortSignal,
    artifactId = activeArtifactId,
  ) {
    if (!sessionId || !artifactId || isThinking) return;
    drafts.reset();
    setActiveSessionId(sessionId);
    setSessionLoading(true);
    setSessionsError("");
    setSidebarOpen(false);

    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}?artifactId=${encodeURIComponent(artifactId)}`,
        { signal },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法读取这个会话");
      const nextMessages = Array.isArray(payload.session?.messages)
        ? payload.session.messages.map((message: ApiMessage) => ({
            ...message,
            time: formatMessageTime(message.timestamp),
            details:
              message.role === "agent" ? ["来自服务端 DSH Agent"] : undefined,
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

  async function activateArtifact(
    artifactId: string,
    signal?: AbortSignal,
    onProgress?: (
      phase: Exclude<ArtifactCreationPhase, "idle" | "ready" | "error">,
    ) => void,
  ) {
    if (!artifactId || isThinking) return;
    drafts.reset();
    shareRequest.current?.abort();
    setShareLoading(false);
    setActiveArtifactId(artifactId);
    window.localStorage.setItem("active-artifact-id", artifactId);
    setArtifactMenuOpen(false);
    setCheckpoints([]);
    setCheckpointState(null);
    setCheckpointError("");
    setShareUrl("");
    setShareError("");
    setActiveSessionId(null);
    setPreviewArtifactId(null);
    setMessages([]);
    setSessions([]);
    codeBrowser.reset();
    setSessionsLoading(true);
    setSessionsError("");
    setArtifactsError("");

    try {
      const response = await fetch(
        `/api/artifacts/${encodeURIComponent(artifactId)}/start`,
        {
          method: "POST",
          headers: onProgress ? { accept: "application/x-ndjson" } : undefined,
          signal,
        },
      );
      const startedArtifact = onProgress
        ? await readArtifactProgress(response, onProgress)
        : await response.json().then((payload) => {
            if (!response.ok) throw new Error(payload.error || "无法启动产物");
            return payload.artifact as ArtifactSummary;
          });
      if (startedArtifact) {
        setArtifacts((current) =>
          current.map((artifact) =>
            artifact.id === artifactId ? startedArtifact : artifact,
          ),
        );
      }
      const checkpointResponse = await fetch(
        `/api/artifacts/${encodeURIComponent(artifactId)}/checkpoints`,
        { signal },
      );
      const checkpointPayload =
        await readJsonResponse<CheckpointPayload>(checkpointResponse);
      if (!checkpointResponse.ok) {
        throw new Error(checkpointPayload.error || "无法读取版本记录");
      }
      setCheckpoints(checkpointPayload.checkpoints);
      setCheckpointState(checkpointPayload.state);
      setPreviewKey((current) => current + 1);
      const nextSessions = await fetchSessionList(artifactId, signal);
      if (nextSessions[0])
        await openSession(nextSessions[0].id, signal, artifactId);
      if (!signal?.aborted) setPreviewArtifactId(artifactId);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setArtifactsError(
        error instanceof Error ? error.message : "无法打开产物",
      );
      if (onProgress) throw error;
    } finally {
      if (!signal?.aborted) setSessionsLoading(false);
    }
  }

  function applyCheckpointPayload(payload: CheckpointPayload) {
    shareRequest.current?.abort();
    setShareLoading(false);
    setShareUrl("");
    setShareError("");
    setCheckpoints((current) =>
      payload.checkpoints.map((checkpoint) => ({
        ...checkpoint,
        build:
          payload.build?.commitSha === checkpoint.commitSha
            ? payload.build
            : (checkpoint.build ??
              current.find((item) => item.commitSha === checkpoint.commitSha)
                ?.build),
      })),
    );
    setCheckpointState(payload.state);
    if (payload.artifact) {
      const updatedArtifact = payload.artifact;
      setArtifacts((current) =>
        current.map((artifact) =>
          artifact.id === updatedArtifact.id ? updatedArtifact : artifact,
        ),
      );
    }
    setPreviewArtifactId(activeArtifactId);
    setPreviewKey((current) => current + 1);
    setCodeRefreshKey((current) => current + 1);
  }

  async function changeCheckpoint(version: number, action: "preview" | "edit") {
    if (!activeArtifactId || isThinking || checkpointLoading) return;
    drafts.stopEditing();
    setCheckpointLoading(true);
    setCheckpointError("");
    try {
      const response = await fetch(
        `/api/artifacts/${encodeURIComponent(activeArtifactId)}/checkpoints/${version}/${action}`,
        { method: "POST" },
      );
      const payload = await readJsonResponse<CheckpointPayload>(response);
      if (!response.ok) throw new Error(payload.error || "无法切换版本");
      applyCheckpointPayload(payload);
    } catch (error) {
      setCheckpointError(
        error instanceof Error ? error.message : "无法切换版本",
      );
    } finally {
      setCheckpointLoading(false);
    }
  }

  async function resumeLatestCheckpoint() {
    if (!activeArtifactId || isThinking || checkpointLoading) return;
    drafts.stopEditing();
    setCheckpointLoading(true);
    setCheckpointError("");
    try {
      const response = await fetch(
        `/api/artifacts/${encodeURIComponent(activeArtifactId)}/checkpoints/resume`,
        { method: "POST" },
      );
      const payload = await readJsonResponse<CheckpointPayload>(response);
      if (!response.ok) throw new Error(payload.error || "无法返回当前版本");
      applyCheckpointPayload(payload);
    } catch (error) {
      setCheckpointError(
        error instanceof Error ? error.message : "无法返回当前版本",
      );
    } finally {
      setCheckpointLoading(false);
    }
  }

  const hasPendingBuild = checkpoints.some(
    (item) =>
      item.build?.status === "queued" || item.build?.status === "building",
  );
  useEffect(() => {
    if (!activeArtifactId || !hasPendingBuild) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refreshBuilds() {
      try {
        const response = await fetch(
          `/api/artifacts/${encodeURIComponent(activeArtifactId!)}/builds`,
          { signal: controller.signal },
        );
        const payload = await readJsonResponse<{ builds: ArtifactBuild[] }>(
          response,
        );
        if (!response.ok) throw new Error("无法读取构建状态");
        if (!controller.signal.aborted)
          setCheckpoints((current) =>
            current.map((checkpoint) => ({
              ...checkpoint,
              build:
                payload.builds.find(
                  (build) => build.commitSha === checkpoint.commitSha,
                ) ?? checkpoint.build,
            })),
          );
      } catch {
        /* 暂时不可用时保留已保存版本，稍后再检查。 */
      }
      if (!controller.signal.aborted) timer = setTimeout(refreshBuilds, 2000);
    }
    void refreshBuilds();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [activeArtifactId, hasPendingBuild]);

  const activeBuild = checkpoints.find(
    (item) =>
      item.version ===
      (checkpointState?.activeVersion ?? checkpointState?.workspaceVersion),
  )?.build;

  async function shareArtifact() {
    const artifactId = activeArtifactId;
    const version =
      checkpointState?.activeVersion ?? checkpointState?.workspaceVersion;
    if (!artifactId || !version || shareLoading || isThinking) return;
    const request = new AbortController();
    shareRequest.current = request;
    setShareLoading(true);
    setShareError("");
    setShareUrl("");
    try {
      const response = await fetch(
        `/api/artifacts/${encodeURIComponent(artifactId)}/share`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version }),
          signal: request.signal,
        },
      );
      const payload = await readJsonResponse<{
        url: string;
        build: ArtifactBuild;
        error?: string;
      }>(response);
      if (!response.ok) throw new Error(payload.error || "无法准备分享页面");
      if (request.signal.aborted) return;
      setShareUrl(new URL(payload.url, window.location.origin).href);
      setCheckpoints((current) =>
        current.map((checkpoint) =>
          checkpoint.commitSha === payload.build.commitSha
            ? { ...checkpoint, build: payload.build }
            : checkpoint,
        ),
      );
    } catch (error) {
      if (!request.signal.aborted)
        setShareError(
          error instanceof Error ? error.message : "无法准备分享页面",
        );
    } finally {
      if (!request.signal.aborted) setShareLoading(false);
    }
  }

  function openArtifactDialog() {
    if (creatingArtifact || isThinking) return;
    setArtifactMenuOpen(false);
    setArtifactDraftName("");
    setArtifactDraftStack("html");
    setArtifactCreationPhase("idle");
    setArtifactCreationError("");
    setArtifactDialogOpen(true);
  }

  async function createNewArtifact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingArtifact || isThinking) return;
    const name = artifactDraftName.trim();
    if (!name) return;
    setCreatingArtifact(true);
    setArtifactCreationPhase("workspace");
    setArtifactCreationError("");
    setArtifactMenuOpen(false);
    setArtifactsError("");
    try {
      const response = await fetch("/api/artifacts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/x-ndjson",
        },
        body: JSON.stringify({ name, technologyStack: artifactDraftStack }),
      });
      const artifact = await readArtifactProgress(
        response,
        setArtifactCreationPhase,
      );
      setArtifacts((current) => [...current, artifact]);
      await activateArtifact(artifact.id, undefined, setArtifactCreationPhase);
      setArtifactCreationPhase("ready");
      await new Promise((resolve) => window.setTimeout(resolve, 550));
      setArtifactDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法创建产物";
      setArtifactCreationError(message);
      setArtifactsError(message);
    } finally {
      setCreatingArtifact(false);
      setArtifactsLoading(false);
    }
  }

  function startNewSession() {
    if (isThinking) return;
    drafts.reset();
    setActiveSessionId(null);
    setMessages([]);
    setInput("");
    setSessionsError("");
    setSidebarOpen(false);
  }

  async function sendMessage(messageOverride?: string): Promise<string | null> {
    const messageElements = [...composerElements];
    const requestedText =
      typeof messageOverride === "string"
        ? messageOverride.trim()
        : input.trim();
    const text =
      requestedText ||
      (messageElements.length > 0 ? DEFAULT_ELEMENT_PROMPT : "");
    if (!text || isThinking || !activeArtifactId || isHistoricalPreview)
      return null;
    const targetSessionId = activeSessionId;
    const messageAttachments = messageElements.map(toMessageElementAttachment);
    const agentMessage =
      messageAttachments.length > 0
        ? `${text}\n\n<artifact-editor-context>\n${JSON.stringify(
            {
              instruction:
                "根据这些预览元素的 DOM 上下文、用户评论和预览修改完成请求。",
              elements: messageAttachments,
            },
            null,
            2,
          )}\n</artifact-editor-context>`
        : text;
    const now = new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    setMessages((current) => [
      ...current,
      {
        id: Date.now(),
        role: "user",
        text,
        time: now,
        attachments: messageAttachments,
      },
    ]);
    setInput("");
    setComposerElements([]);
    setIsThinking(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: agentMessage,
          sessionId: targetSessionId,
          artifactId: activeArtifactId,
          checkpointRevision: checkpointState?.revision,
        }),
      });
      const payload = await readJsonResponse<{
        reply: string;
        sessionId: string;
        error?: string;
        artifact?: ArtifactSummary;
        runtimeWarning?: string;
        checkpoints?: CheckpointSummary[];
        checkpointState?: CheckpointState;
        build?: ArtifactBuild;
      }>(response);
      if (!response.ok) throw new Error(payload.error || "DSH Agent 调用失败");

      setActiveSessionId(payload.sessionId);
      if (payload.artifact) {
        const updatedArtifact = payload.artifact;
        setArtifacts((current) =>
          current.map((artifact) =>
            artifact.id === updatedArtifact.id ? updatedArtifact : artifact,
          ),
        );
      }
      if (payload.runtimeWarning) setArtifactsError(payload.runtimeWarning);
      if (payload.checkpoints)
        setCheckpoints((current) =>
          payload.checkpoints!.map((checkpoint) => ({
            ...checkpoint,
            build:
              payload.build?.commitSha === checkpoint.commitSha
                ? payload.build
                : current.find(
                    (item) => item.commitSha === checkpoint.commitSha,
                  )?.build,
          })),
        );
      if (payload.checkpointState) setCheckpointState(payload.checkpointState);

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
          details: ["来自服务端 DSH Agent"],
        },
      ]);
      fetchSessionList(activeArtifactId).catch((error) => {
        setSessionsError(
          error instanceof Error ? error.message : "无法刷新会话历史",
        );
      });
      return payload.reply;
    } catch (error) {
      setInput((current) => (current.trim() ? current : text));
      setComposerElements((current) =>
        current.length > 0 ? current : messageElements,
      );
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: "agent",
          error: true,
          text: error instanceof Error ? error.message : "DSH Agent 调用失败",
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
    drafts.stopEditing();
    setRefreshing(true);
    setPreviewKey((current) => current + 1);
    window.setTimeout(() => setRefreshing(false), 650);
  }

  return {
    shareArtifact,
    shareLoading,
    shareUrl,
    shareError,
    activeBuild,
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
    sidebarOpen,
    isThinking,
    startNewSession,
    sessionsLoading,
    sessionsError,
    sessions,
    activeSessionId,
    openSession,
    activeSession,
    sessionLoading,
    messages,
    handleKeyDown,
    isHistoricalPreview,
    canSend,
    sendMessage,
    view,
    setView,
    checkpointState,
    checkpointLoading,
    checkpoints,
    resumeLatestCheckpoint,
    changeCheckpoint,
    refreshPreview,
    refreshing,
    checkpointError,
    previewKey,
    previewArtifactId,
    artifactDialogOpen,
    setArtifactDialogOpen,
    createNewArtifact,
    artifactDraftName,
    setArtifactDraftName,
    artifactDraftStack,
    setArtifactDraftStack,
    artifactCreationPhase,
    artifactCreationError,
    ...drafts,
    ...codeBrowser,
    ...layout,
  };
}

export type Workbench = ReturnType<typeof useWorkbench>;
