import type {
  ArtifactCreationPhase,
  ArtifactSummary,
  ArtifactProgressEvent,
} from "./types";

export async function readArtifactProgress(
  response: Response,
  onProgress: (
    phase: Exclude<ArtifactCreationPhase, "idle" | "ready" | "error">,
  ) => void,
): Promise<ArtifactSummary> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/x-ndjson")) {
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "产物操作失败");
    return payload.artifact;
  }
  if (!response.body) throw new Error("无法读取产物创建进度");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let artifact: ArtifactSummary | null = null;

  function consume(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ArtifactProgressEvent;
    if (event.type === "progress" && event.phase) onProgress(event.phase);
    if (event.type === "complete" && event.artifact) artifact = event.artifact;
    if (event.type === "error") throw new Error(event.error || "产物操作失败");
  }

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) consume(line);
    if (done) break;
  }
  consume(buffer);
  if (!artifact) throw new Error("产物操作结束，但没有返回产物信息");
  return artifact;
}
