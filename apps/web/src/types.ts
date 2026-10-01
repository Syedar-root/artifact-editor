import type { ElementSelection } from "@artifact-editor/sdk/web/element-inspector";
import type { ElementChangeSet } from "@artifact-editor/sdk/web/element-editor";

export type MessageRole = "user" | "agent";

export interface ChatMessage {
  id: string | number;
  role: MessageRole;
  text: string;
  time: string;
  details?: string[];
  attachments?: MessageElementAttachment[];
  error?: boolean;
}

export interface ApiMessage {
  id: string | number;
  role: MessageRole;
  text: string;
  timestamp: string;
  attachments?: MessageElementAttachment[];
  error?: boolean;
}

export interface SessionSummary {
  id: string;
  artifactId: string;
  title: string;
  preview: string;
  updatedAt: string;
  messageCount: number;
}

export interface ArtifactSummary {
  id: string;
  name: string;
  status: "creating" | "ready" | "failed";
  previewUrl: string;
  createdAt: string;
  updatedAt: string;
  requestedStack: TechnologyStack;
  detectedStack: TechnologyStack;
  stackChanged: boolean;
  locatorMode: "runtime-hint" | "code-inspector";
}

export interface CheckpointSummary {
  version: number;
  tag: string;
  commitSha: string;
  createdAt: string;
  message: string;
}

export type CheckpointMode =
  "latest" | "historical-preview" | "editing-history";

export interface CheckpointState {
  mode: CheckpointMode;
  activeVersion: number | null;
  workspaceVersion: number | null;
  latestVersion: number;
  nextVersion: number;
  revision: string;
}

export interface CheckpointPayload {
  checkpoints: CheckpointSummary[];
  state: CheckpointState;
  artifact?: ArtifactSummary;
  error?: string;
}

export type TechnologyStack = "html" | "react" | "vue";

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

export interface MessageElementAttachment {
  tagName?: string;
  id?: string;
  classNames?: string[];
  hint: string;
  domHint?: ElementSelection["domHint"];
  source?: ElementSelection["source"];
  comment?: string;
  changes?: ElementChangeSet["changes"];
}

export type ArtifactCreationPhase =
  | "idle"
  | "workspace"
  | "dependencies"
  | "locator"
  | "preview"
  | "ready"
  | "error";

export interface ArtifactProgressEvent {
  type: "progress" | "complete" | "error";
  phase?: Exclude<ArtifactCreationPhase, "idle" | "ready" | "error">;
  artifact?: ArtifactSummary;
  error?: string;
}
