import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from "react";
import {
  ArrowUp,
  Bold,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  ExternalLink,
  FileCode2,
  Folder,
  FolderOpen,
  Globe2,
  History,
  ImageIcon,
  Italic,
  Laptop,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  ScanSearch,
  Sparkles,
  Type,
  WandSparkles,
  X,
} from "lucide-react";
import { useArtifactElementTools } from "@artifact-editor/sdk/web/react";
import type { ElementSelection } from "@artifact-editor/sdk/web/element-inspector";
import { readJsonResponse } from "./api-response";
import {
  editingQueueItem,
  editingTargetForSelection,
  mergeEditedElement,
} from "./element-edit-workflow";
import type {
  ElementEditTarget,
  SelectedElementItem,
} from "./element-edit-workflow";
import { calculateElementEditorPosition } from "./element-editor-position";
import { resizeComposerInput } from "./composer-input";
import type {
  ElementChangeSet,
  ElementEditGroup,
  ElementEditProperty,
  ElementEditPropertyId,
  ElementEditPropertyKey,
  ElementEditPropertyValue,
  ElementEditorEditingState,
} from "@artifact-editor/sdk/web/element-editor";

type MessageRole = "user" | "agent";

interface ChatMessage {
  id: string | number;
  role: MessageRole;
  text: string;
  time: string;
  details?: string[];
  attachments?: MessageElementAttachment[];
  error?: boolean;
}

interface ApiMessage {
  id: string | number;
  role: MessageRole;
  text: string;
  timestamp: string;
  attachments?: MessageElementAttachment[];
  error?: boolean;
}

interface SessionSummary {
  id: string;
  artifactId: string;
  title: string;
  preview: string;
  updatedAt: string;
  messageCount: number;
}

interface ArtifactSummary {
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

interface CheckpointSummary {
  version: number;
  tag: string;
  commitSha: string;
  createdAt: string;
  message: string;
}

type CheckpointMode = "latest" | "historical-preview" | "editing-history";

interface CheckpointState {
  mode: CheckpointMode;
  activeVersion: number | null;
  workspaceVersion: number | null;
  latestVersion: number;
  nextVersion: number;
  revision: string;
}

interface CheckpointPayload {
  checkpoints: CheckpointSummary[];
  state: CheckpointState;
  artifact?: ArtifactSummary;
  error?: string;
}

type TechnologyStack = "html" | "react" | "vue";

interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

interface MessageElementAttachment {
  tagName?: string;
  id?: string;
  classNames?: string[];
  hint: string;
  domHint?: ElementSelection["domHint"];
  source?: ElementSelection["source"];
  comment?: string;
  changes?: ElementChangeSet["changes"];
}

type ArtifactCreationPhase = "idle" | "workspace" | "dependencies" | "locator" | "preview" | "ready" | "error";

interface ArtifactProgressEvent {
  type: "progress" | "complete" | "error";
  phase?: Exclude<ArtifactCreationPhase, "idle" | "ready" | "error">;
  artifact?: ArtifactSummary;
  error?: string;
}

const initialMessages: ChatMessage[] = [];

const DEFAULT_ELEMENT_PROMPT = "请结合这些元素的评论和已应用修改统一调整页面，并保持整体视觉风格一致。";

const DEFAULT_CHAT_WIDTH = 420;
const MIN_CHAT_WIDTH = 320;
const MAX_CHAT_WIDTH = 640;
const MIN_PREVIEW_WIDTH = 560;
const RAIL_WIDTH = 220;
const RESIZER_WIDTH = 7;
const TECHNOLOGY_OPTIONS: Array<{
  value: TechnologyStack;
  label: string;
  description: string;
}> = [
  { value: "html", label: "HTML + JavaScript", description: "无侵入运行时 DOM hint" },
  { value: "react", label: "React", description: "Vite + Code Inspector 精确定位" },
  { value: "vue", label: "Vue", description: "Vite + Code Inspector 精确定位" },
];

const ARTIFACT_CREATION_STEPS = [
  { phase: "workspace", label: "创建工作区", description: "生成目录和初始文件" },
  { phase: "dependencies", label: "安装项目依赖", description: "准备框架与构建工具" },
  { phase: "locator", label: "配置元素定位", description: "接入 DOM hint 或 Code Inspector" },
  { phase: "preview", label: "启动预览服务", description: "生成配置并连接预览" },
] as const;

function artifactCreationStepState(
  phase: ArtifactCreationPhase,
  stepPhase: (typeof ARTIFACT_CREATION_STEPS)[number]["phase"],
  hasError: boolean,
): "pending" | "active" | "complete" | "error" {
  if (phase === "ready") return "complete";
  const currentIndex = ARTIFACT_CREATION_STEPS.findIndex((step) => step.phase === phase);
  const stepIndex = ARTIFACT_CREATION_STEPS.findIndex((step) => step.phase === stepPhase);
  if (currentIndex < 0 || stepIndex > currentIndex) return "pending";
  if (stepIndex < currentIndex) return "complete";
  return hasError ? "error" : "active";
}

function technologyLabel(stack: TechnologyStack): string {
  return TECHNOLOGY_OPTIONS.find((option) => option.value === stack)?.label || stack;
}

function toMessageElementAttachment(element: SelectedElementItem): MessageElementAttachment {
  return {
    tagName: element.tagName,
    id: element.id,
    classNames: element.classNames,
    hint: element.hint,
    domHint: element.domHint,
    source: element.source,
    comment: element.comment,
    changes: element.changes,
  };
}

function editorProperty(
  state: ElementEditorEditingState,
  key: ElementEditPropertyKey,
) {
  return state.properties.find((property) => property.key === key);
}

function colorInputValue(value: ElementEditPropertyValue | undefined): string {
  if (typeof value !== "string") return "#222222";
  if (/^#[\da-f]{6}$/iu.test(value)) return value;
  if (/^#[\da-f]{3}$/iu.test(value)) {
    return `#${value.slice(1).split("").map((character) => character.repeat(2)).join("")}`;
  }
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/iu);
  if (!rgb) return "#222222";
  return `#${rgb
    .slice(1, 4)
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

interface ElementEditorPopoverProps {
  state: ElementEditorEditingState;
  initialComment?: string;
  position: CSSProperties;
  placement: "above" | "below";
  onUpdate(property: ElementEditPropertyId, value: ElementEditPropertyValue): void;
  onCancel(): void;
  onCommit(comment: string): void;
}

const ELEMENT_PROPERTY_LABELS: Record<ElementEditPropertyKey, string> = {
  "content.text": "文本",
  "form.value": "内容",
  "form.placeholder": "占位文字",
  "form.checked": "选中",
  "form.disabled": "禁用",
  "link.href": "链接",
  "link.target": "打开方式",
  "media.src": "图片地址",
  "media.alt": "替代文本",
  "media.objectFit": "适应",
  "media.backgroundImage": "背景图片",
  "typography.fontFamily": "字体",
  "typography.fontSize": "字号",
  "typography.fontWeight": "字重",
  "typography.fontStyle": "字形",
  "typography.lineHeight": "行高",
  "typography.textAlign": "对齐",
  "typography.color": "文字颜色",
  "size.width": "宽度",
  "size.height": "高度",
  "size.aspectRatio": "比例",
  "layout.display": "显示",
  "layout.flexDirection": "排列方向",
  "layout.justifyContent": "主轴对齐",
  "layout.alignItems": "交叉轴对齐",
  "layout.gap": "间距",
  "spacing.marginTop": "上外边距",
  "spacing.marginRight": "右外边距",
  "spacing.marginBottom": "下外边距",
  "spacing.marginLeft": "左外边距",
  "spacing.paddingTop": "上内边距",
  "spacing.paddingRight": "右内边距",
  "spacing.paddingBottom": "下内边距",
  "spacing.paddingLeft": "左内边距",
  "appearance.backgroundColor": "背景颜色",
  "appearance.borderColor": "边框颜色",
  "appearance.borderWidth": "边框宽度",
  "appearance.borderStyle": "边框样式",
  "appearance.borderRadius": "圆角",
  "appearance.opacity": "透明度",
};

const ELEMENT_GROUP_LABELS: Record<ElementEditGroup, string> = {
  content: "内容",
  form: "表单",
  link: "链接",
  media: "媒体",
  typography: "排版",
  size: "尺寸",
  layout: "布局",
  spacing: "间距",
  appearance: "外观",
};

function lengthNumber(value: ElementEditPropertyValue): number {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function GenericElementEditorField({
  property,
  onUpdate,
}: {
  property: ElementEditProperty;
  onUpdate(property: ElementEditPropertyId, value: ElementEditPropertyValue): void;
}) {
  const label = ELEMENT_PROPERTY_LABELS[property.key];
  if (property.schema.kind === "boolean") {
    return (
      <label className="element-editor-toggle">
        <span>{label}</span>
        <input
          type="checkbox"
          checked={Boolean(property.value)}
          onChange={(event) => onUpdate(property.id, event.target.checked)}
        />
      </label>
    );
  }
  if (property.schema.kind === "choice") {
    return (
      <label className="element-editor-field">
        <span>{label}</span>
        <select
          value={String(property.value ?? "")}
          onChange={(event) => onUpdate(property.id, event.target.value)}
        >
          {property.schema.options.map((option) => (
            <option value={String(option)} key={String(option)}>{String(option)}</option>
          ))}
        </select>
      </label>
    );
  }
  if (property.schema.kind === "color") {
    return (
      <label className="element-editor-field">
        <span>{label}</span>
        <div className="element-editor-color-field">
          <input
            type="color"
            value={colorInputValue(property.value)}
            onChange={(event) => onUpdate(property.id, event.target.value)}
          />
          <code>{String(property.value)}</code>
        </div>
      </label>
    );
  }
  return (
    <label className="element-editor-field">
      <span>{label}</span>
      <input
        type={property.schema.kind === "number" ? "number" : "text"}
        min={property.schema.kind === "number" ? property.schema.min : undefined}
        max={property.schema.kind === "number" ? property.schema.max : undefined}
        step={property.schema.kind === "number" ? property.schema.step : undefined}
        value={String(property.value ?? "")}
        onChange={(event) => onUpdate(
          property.id,
          property.schema.kind === "number" ? Number(event.target.value) : event.target.value,
        )}
      />
    </label>
  );
}

function ElementEditorPopover({
  state,
  initialComment = "",
  position,
  placement,
  onUpdate,
  onCancel,
  onCommit,
}: ElementEditorPopoverProps) {
  const [activeTab, setActiveTab] = useState<"style" | "comment">("style");
  const [comment, setComment] = useState(initialComment);
  const text = editorProperty(state, "content.text");
  const fontSize = editorProperty(state, "typography.fontSize");
  const fontWeight = editorProperty(state, "typography.fontWeight");
  const fontStyle = editorProperty(state, "typography.fontStyle");
  const color = editorProperty(state, "typography.color");
  const imageSource = editorProperty(state, "media.src");
  const imageAlt = editorProperty(state, "media.alt");
  const objectFit = editorProperty(state, "media.objectFit");
  const width = editorProperty(state, "size.width");
  const height = editorProperty(state, "size.height");
  const aspectRatio = editorProperty(state, "size.aspectRatio");
  const isText = !!text;
  const isImage = !!imageSource;
  const aspectRatioOptions = aspectRatio
    ? [...new Set([String(aspectRatio.value), "auto", "1 / 1", "4 / 3", "16 / 9"])]
    : [];
  const primaryPropertyIds = new Set(
    [
      ...(isText ? [text, fontSize, fontWeight, fontStyle, color] : []),
      ...(isImage ? [imageSource, imageAlt, objectFit, width, height, aspectRatio] : []),
    ]
      .filter((property): property is ElementEditProperty => !!property)
      .map((property) => property.id),
  );
  const detailGroups = state.properties
    .filter((property) => !primaryPropertyIds.has(property.id))
    .reduce((groups, property) => {
      const entries = groups.get(property.group) ?? [];
      entries.push(property);
      groups.set(property.group, entries);
      return groups;
    }, new Map<ElementEditGroup, ElementEditProperty[]>());

  useEffect(() => {
    setActiveTab("style");
    setComment(initialComment);
  }, [
    initialComment,
    state.target.hint,
    state.target.source?.file,
    state.target.source?.line,
    state.target.source?.column,
  ]);

  return (
    <section
      className={`element-editor-popover is-${placement}`}
      style={position}
      aria-label={`编辑 ${state.target.hint}`}
    >
      <header className="element-editor-heading">
        <span className="element-editor-kind" aria-hidden="true">
          {isImage ? <ImageIcon size={14} /> : <Type size={14} />}
        </span>
        <code title={state.target.hint}>{state.target.hint}</code>
        <button type="button" onClick={onCancel} aria-label="取消编辑" title="取消编辑">
          <X size={14} />
        </button>
      </header>

      <div className="element-editor-tabs" role="tablist" aria-label="元素操作方式">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "style"}
          className={activeTab === "style" ? "is-active" : ""}
          onClick={() => setActiveTab("style")}
        >
          <Type size={13} />样式
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "comment"}
          className={activeTab === "comment" ? "is-active" : ""}
          onClick={() => setActiveTab("comment")}
        >
          <MessageSquareText size={13} />AI Comment
        </button>
      </div>

      {activeTab === "style" ? (
        <div className="element-editor-fields">
        {text && (
          <label className="element-editor-field is-wide">
            <span>文本</span>
            <input
              type="text"
              value={String(text.value)}
              onChange={(event) => onUpdate(text.id, event.target.value)}
            />
          </label>
        )}

        {isText && (
          <div className="element-editor-format-row">
            {fontWeight && (
              <button
                type="button"
                className={Number(fontWeight.value) >= 600 ? "is-active" : ""}
                aria-label="粗体"
                aria-pressed={Number(fontWeight.value) >= 600}
                title="粗体"
                onClick={() => onUpdate(fontWeight.id, Number(fontWeight.value) >= 600 ? 400 : 700)}
              >
                <Bold size={15} />
              </button>
            )}
            {fontStyle && (
              <button
                type="button"
                className={fontStyle.value !== "normal" ? "is-active" : ""}
                aria-label="斜体"
                aria-pressed={fontStyle.value !== "normal"}
                title="斜体"
                onClick={() => onUpdate(fontStyle.id, fontStyle.value === "normal" ? "italic" : "normal")}
              >
                <Italic size={15} />
              </button>
            )}
            {fontSize && (
              <label className="element-editor-compact-field" title="字号">
                <input
                  type="number"
                  min={1}
                  max={512}
                  value={lengthNumber(fontSize.value)}
                  onChange={(event) => onUpdate(fontSize.id, `${event.target.value}px`)}
                />
                <span>px</span>
              </label>
            )}
            {color && (
              <label className="element-editor-color" title="文字颜色">
                <input
                  type="color"
                  value={colorInputValue(color.value)}
                  onChange={(event) => onUpdate(color.id, event.target.value)}
                />
              </label>
            )}
          </div>
        )}

        {imageSource && (
          <label className="element-editor-field is-wide">
            <span>图片地址</span>
            <input
              type="text"
              value={String(imageSource.value)}
              onChange={(event) => onUpdate(imageSource.id, event.target.value)}
            />
          </label>
        )}
        {imageAlt && (
          <label className="element-editor-field is-wide">
            <span>替代文本</span>
            <input
              type="text"
              value={String(imageAlt.value)}
              onChange={(event) => onUpdate(imageAlt.id, event.target.value)}
            />
          </label>
        )}
        {isImage && (
          <div className="element-editor-grid">
            {objectFit && objectFit.schema.kind === "choice" && (
              <label className="element-editor-field">
                <span>适应</span>
                <select
                  value={String(objectFit.value)}
                  onChange={(event) => onUpdate(objectFit.id, event.target.value)}
                >
                  {objectFit.schema.options.map((option) => (
                    <option value={String(option)} key={String(option)}>{String(option)}</option>
                  ))}
                </select>
              </label>
            )}
            {aspectRatio && (
              <label className="element-editor-field">
                <span>比例</span>
                <select
                  value={String(aspectRatio.value)}
                  onChange={(event) => onUpdate(aspectRatio.id, event.target.value)}
                >
                  {aspectRatioOptions.map((option) => (
                    <option value={option} key={option}>{option}</option>
                  ))}
                </select>
              </label>
            )}
            {width && (
              <label className="element-editor-field">
                <span>宽度</span>
                <div className="element-editor-number">
                  <input
                    type="number"
                    min={1}
                    value={lengthNumber(width.value)}
                    onChange={(event) => onUpdate(width.id, `${event.target.value}px`)}
                  />
                  <i>px</i>
                </div>
              </label>
            )}
            {height && (
              <label className="element-editor-field">
                <span>高度</span>
                <div className="element-editor-number">
                  <input
                    type="number"
                    min={1}
                    value={lengthNumber(height.value)}
                    onChange={(event) => onUpdate(height.id, `${event.target.value}px`)}
                  />
                  <i>px</i>
                </div>
              </label>
            )}
          </div>
        )}

        {[...detailGroups.entries()].map(([group, properties]) => (
          <section className="element-editor-group" key={group}>
            <h4>{ELEMENT_GROUP_LABELS[group]}</h4>
            <div className="element-editor-grid">
              {properties.map((property) => (
                <GenericElementEditorField
                  property={property}
                  onUpdate={onUpdate}
                  key={property.id}
                />
              ))}
            </div>
          </section>
        ))}

        {state.properties.length === 0 && (
          <p className="element-editor-empty">这个元素暂时没有可直接编辑的属性。</p>
        )}
        </div>
      ) : (
        <div className="element-editor-comment">
          <div className="element-editor-comment-intro">
            <span><Sparkles size={14} /></span>
            <div>
              <strong>告诉 AI 你希望怎么调整</strong>
              <p>这条评论会和元素定位信息一起加入发送列表。</p>
            </div>
          </div>
          <textarea
            autoFocus
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="例如：这个按钮层级不够突出，请让它更像主要操作，同时保持当前品牌色。"
            rows={5}
          />
        </div>
      )}

      <footer className="element-editor-actions">
        <button type="button" onClick={onCancel}>取消</button>
        <button
          type="button"
          className="is-primary"
          onClick={() => onCommit(comment.trim())}
        >
          <Check size={14} />应用
        </button>
      </footer>
    </section>
  );
}

function formatMessageTime(timestamp: string | number | Date) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatSessionTime(timestamp: string | number | Date) {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return formatMessageTime(timestamp);
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

async function readArtifactProgress(
  response: Response,
  onProgress: (phase: Exclude<ArtifactCreationPhase, "idle" | "ready" | "error">) => void,
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

function treeContainsFile(nodes: FileTreeNode[], filePath: string): boolean {
  return nodes.some(
    (node) =>
      (node.type === "file" && node.path === filePath) ||
      (node.type === "directory" && treeContainsFile(node.children || [], filePath)),
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

function App() {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [artifactsLoading, setArtifactsLoading] = useState(true);
  const [artifactsError, setArtifactsError] = useState("");
  const [artifactMenuOpen, setArtifactMenuOpen] = useState(false);
  const [creatingArtifact, setCreatingArtifact] = useState(false);
  const [artifactCreationPhase, setArtifactCreationPhase] = useState<ArtifactCreationPhase>("idle");
  const [artifactCreationError, setArtifactCreationError] = useState("");
  const [artifactDialogOpen, setArtifactDialogOpen] = useState(false);
  const [artifactDraftName, setArtifactDraftName] = useState("");
  const [artifactDraftStack, setArtifactDraftStack] = useState<TechnologyStack>("html");
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  const [checkpointState, setCheckpointState] = useState<CheckpointState | null>(null);
  const [checkpointMenuOpen, setCheckpointMenuOpen] = useState(false);
  const [checkpointLoading, setCheckpointLoading] = useState(false);
  const [checkpointError, setCheckpointError] = useState("");
  const [messages, setMessages] = useState(initialMessages);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [view, setView] = useState<"preview" | "code">("preview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isElementPicking, setIsElementPicking] = useState(false);
  const [selectedElements, setSelectedElements] = useState<SelectedElementItem[]>([]);
  const [composerElements, setComposerElements] = useState<SelectedElementItem[]>([]);
  const [elementEditTarget, setElementEditTarget] = useState<ElementEditTarget | null>(null);
  const [previewArtifactId, setPreviewArtifactId] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [codeTree, setCodeTree] = useState<FileTreeNode[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState("");
  const [codeRefreshKey, setCodeRefreshKey] = useState(0);
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    () => new Set(["src", "public"]),
  );
  const [chatWidth, setChatWidth] = useState(() => {
    const savedWidth = Number(window.localStorage.getItem("artifact-chat-width"));
    return Number.isFinite(savedWidth) && savedWidth >= MIN_CHAT_WIDTH
      ? savedWidth
      : DEFAULT_CHAT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const checkpointMenuRef = useRef<HTMLDivElement>(null);
  const sendMessageRef = useRef<((messageOverride?: string) => Promise<string | null>) | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const selectedElementKeyRef = useRef(0);

  const elementTools = useArtifactElementTools({
    iframeRef: previewIframeRef,
    enabled: view === "preview",
    pickingEnabled: isElementPicking,
    revision: previewKey,
    onPickingCancel: () => setIsElementPicking(false),
  });
  const { activeElements, editorState: elementEditorState } = elementTools;

  const isHistoricalPreview = checkpointState?.mode === "historical-preview";
  const canSend = (input.trim().length > 0 || composerElements.length > 0)
    && !isThinking
    && !!activeArtifactId
    && !isHistoricalPreview;

  const activeArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === activeArtifactId) || null,
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
        const response = await fetch("/api/artifacts", { signal: lifecycle.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "无法读取产物列表");
        const nextArtifacts: ArtifactSummary[] = Array.isArray(payload.artifacts)
          ? payload.artifacts
          : [];
        setArtifacts(nextArtifacts);
        const savedArtifactId = window.localStorage.getItem("active-artifact-id");
        const initialArtifact = nextArtifacts.find((artifact) => artifact.id === savedArtifactId)
          || nextArtifacts[0];
        if (initialArtifact) await activateArtifact(initialArtifact.id, lifecycle.signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setArtifactsError(error instanceof Error ? error.message : "无法读取产物列表");
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
    const container = messagesRef.current;
    container?.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

  useEffect(() => {
    window.localStorage.setItem("artifact-chat-width", String(chatWidth));
  }, [chatWidth]);

  useLayoutEffect(() => {
    if (composerInputRef.current) resizeComposerInput(composerInputRef.current);
  }, [input]);

  useEffect(() => {
    if (!checkpointMenuOpen) return undefined;
    function closeCheckpointMenuOnOutsidePointer(event: PointerEvent) {
      if (!checkpointMenuRef.current?.contains(event.target as Node)) {
        setCheckpointMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", closeCheckpointMenuOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeCheckpointMenuOnOutsidePointer);
  }, [checkpointMenuOpen]);

  useEffect(() => {
    if (activeElements.length !== 1) {
      setElementEditTarget(null);
      return;
    }
    const next = editingTargetForSelection(activeElements[0], selectedElements);
    setElementEditTarget((current) => {
      if (current?.kind === "queue-item" && next.kind === "queue-item" && current.key === next.key) {
        return current;
      }
      if (current?.kind === "preview-selection" && next.kind === "preview-selection") {
        return current;
      }
      return next;
    });
  }, [activeElements, selectedElements]);

  function createSelectedElementItem(
    selection: ElementSelection,
    element?: Element,
    comment?: string,
    changes?: ElementChangeSet["changes"],
  ): SelectedElementItem {
    selectedElementKeyRef.current += 1;
    return {
      ...selection,
      key: selectedElementKeyRef.current,
      ...(element ? { element } : {}),
      ...(comment ? { comment } : {}),
      ...(changes && changes.length > 0 ? { changes } : {}),
    };
  }

  function applySelectionListToComposer() {
    if (selectedElements.length === 0) return;
    const shouldUseDefaultPrompt = input.trim().length === 0;
    if (elementEditTarget) elementTools.cancelEdits();
    setComposerElements((current) => [...current, ...selectedElements]);
    setSelectedElements([]);
    setElementEditTarget(null);
    setIsElementPicking(false);
    if (shouldUseDefaultPrompt) setInput(DEFAULT_ELEMENT_PROMPT);
    window.requestAnimationFrame(() => {
      const textarea = composerInputRef.current;
      if (!textarea) return;
      textarea.focus();
      if (shouldUseDefaultPrompt) textarea.select();
    });
  }

  function closeCheckpointMenuOnBlur(event: ReactFocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (!nextTarget || !event.currentTarget.contains(nextTarget as Node)) {
      setCheckpointMenuOpen(false);
    }
  }

  function closeElementEditor(commit: boolean, comment = "") {
    if (!commit) {
      elementTools.cancelEdits();
      setElementEditTarget(null);
      return;
    }

    const inspection = activeElements.length === 1 ? activeElements[0] : null;
    const target = elementEditTarget;
    const changeSet = elementTools.commitEdits();
    if (!inspection || !target) return;
    const item = createSelectedElementItem(
      changeSet?.target ?? inspection.selection,
      inspection.element,
      comment,
      changeSet?.changes,
    );
    setSelectedElements((current) => mergeEditedElement(current, target, item));
    setElementEditTarget(null);
  }

  function resolveSelectedElement(item: SelectedElementItem): Element | null {
    if (item.element?.isConnected) return item.element;
    const document = previewIframeRef.current?.contentDocument;
    if (!document) return null;
    if (item.source) {
      const prefix = `${item.source.file}:${item.source.line}:${item.source.column}:`;
      const sourceMatch = Array.from(document.querySelectorAll("[data-insp-path]"))
        .find((element) => element.getAttribute("data-insp-path")?.startsWith(prefix));
      if (sourceMatch) return sourceMatch;
    }
    if (item.id) {
      const idMatch = document.getElementById(item.id);
      if (idMatch) return idMatch;
    }
    return Array.from(document.getElementsByTagName(item.tagName))
      .find((element) => item.classNames.every((className) => element.classList.contains(className)))
      ?? null;
  }

  function editSelectedElement(item: SelectedElementItem) {
    const element = resolveSelectedElement(item);
    if (!element) return;
    element.scrollIntoView({ block: "center", inline: "center" });
    setIsElementPicking(true);
    setElementEditTarget(editingQueueItem(item));
    elementTools.selectElement(element);
  }

  function updateElementEditor(
    property: ElementEditPropertyId,
    value: ElementEditPropertyValue,
  ) {
    elementTools.updateProperty(property, value);
  }

  function elementEditorPosition(): {
    position: CSSProperties;
    placement: "above" | "below";
  } | null {
    if (elementEditorState.status !== "editing" || activeElements.length !== 1) return null;
    const iframe = previewIframeRef.current;
    if (!iframe) return null;
    const calculated = calculateElementEditorPosition({
      iframeLeft: iframe.offsetLeft,
      iframeTop: iframe.offsetTop,
      iframeWidth: iframe.clientWidth,
      iframeHeight: iframe.clientHeight,
      propertyCount: elementEditorState.properties.length,
      target: activeElements[0].boxModel.rect,
    });
    return {
      placement: calculated.placement,
      position: {
        left: calculated.left,
        top: calculated.top,
        maxHeight: calculated.maxHeight,
      },
    };
  }

  useEffect(() => {
    if (view !== "code") return undefined;
    const lifecycle = new AbortController();
    loadSandboxCode(lifecycle.signal);
    return () => lifecycle.abort();
  }, [activeArtifactId, view, codeRefreshKey]);

  useEffect(() => {
    if (!isResizing) return undefined;

    document.body.classList.add("is-resizing-panels");
    const handlePointerMove = (event: PointerEvent) => {
      const bounds = workspaceRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const availableMax = bounds.width - RAIL_WIDTH - RESIZER_WIDTH - MIN_PREVIEW_WIDTH;
      const nextWidth = event.clientX - bounds.left - RAIL_WIDTH;
      setChatWidth(Math.min(Math.max(nextWidth, MIN_CHAT_WIDTH), Math.min(MAX_CHAT_WIDTH, availableMax)));
    };
    const stopResizing = () => setIsResizing(false);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing, { once: true });
    window.addEventListener("pointercancel", stopResizing, { once: true });

    return () => {
      document.body.classList.remove("is-resizing-panels");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [isResizing]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return undefined;

    const lifecycle = new AbortController();
    const registration = context.registerTool(
      {
        name: "send_agent_message",
        title: "给 pi Agent 发消息",
        description: "向沙箱中的 pi Agent 发送一条消息，并等待完整回复。",
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
          if (!input || typeof input.message !== "string" || !input.message.trim()) {
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
    const nextSessions: SessionSummary[] = Array.isArray(payload.sessions) ? payload.sessions : [];
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
    elementTools.cancelEdits();
    setIsElementPicking(false);
    setActiveSessionId(sessionId);
    setSelectedElements([]);
    setComposerElements([]);
    setElementEditTarget(null);
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
            details: message.role === "agent" ? ["来自沙箱中的 pi Agent"] : undefined,
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
    onProgress?: (phase: Exclude<ArtifactCreationPhase, "idle" | "ready" | "error">) => void,
  ) {
    if (!artifactId || isThinking) return;
    elementTools.cancelEdits();
    setIsElementPicking(false);
    setActiveArtifactId(artifactId);
    window.localStorage.setItem("active-artifact-id", artifactId);
    setArtifactMenuOpen(false);
    setCheckpointMenuOpen(false);
    setCheckpoints([]);
    setCheckpointState(null);
    setCheckpointError("");
    setActiveSessionId(null);
    setPreviewArtifactId(null);
    setMessages([]);
    setSessions([]);
    setSelectedElements([]);
    setComposerElements([]);
    setElementEditTarget(null);
    setSelectedFile("");
    setFileContent("");
    setCodeTree([]);
    setSessionsLoading(true);
    setSessionsError("");
    setArtifactsError("");

    try {
      const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/start`, {
        method: "POST",
        headers: onProgress ? { accept: "application/x-ndjson" } : undefined,
        signal,
      });
      const startedArtifact = onProgress
        ? await readArtifactProgress(response, onProgress)
        : await response.json().then((payload) => {
          if (!response.ok) throw new Error(payload.error || "无法启动产物");
          return payload.artifact as ArtifactSummary;
        });
      if (startedArtifact) {
        setArtifacts((current) => current.map((artifact) =>
          artifact.id === artifactId ? startedArtifact : artifact
        ));
      }
      const checkpointResponse = await fetch(
        `/api/artifacts/${encodeURIComponent(artifactId)}/checkpoints`,
        { signal },
      );
      const checkpointPayload = await readJsonResponse<CheckpointPayload>(checkpointResponse);
      if (!checkpointResponse.ok) {
        throw new Error(checkpointPayload.error || "无法读取版本记录");
      }
      setCheckpoints(checkpointPayload.checkpoints);
      setCheckpointState(checkpointPayload.state);
      setPreviewKey((current) => current + 1);
      const nextSessions = await fetchSessionList(artifactId, signal);
      if (nextSessions[0]) await openSession(nextSessions[0].id, signal, artifactId);
      if (!signal?.aborted) setPreviewArtifactId(artifactId);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setArtifactsError(error instanceof Error ? error.message : "无法打开产物");
      if (onProgress) throw error;
    } finally {
      if (!signal?.aborted) setSessionsLoading(false);
    }
  }

  function applyCheckpointPayload(payload: CheckpointPayload) {
    setCheckpoints(payload.checkpoints);
    setCheckpointState(payload.state);
    if (payload.artifact) {
      const updatedArtifact = payload.artifact;
      setArtifacts((current) => current.map((artifact) =>
        artifact.id === updatedArtifact.id ? updatedArtifact : artifact
      ));
    }
    setPreviewArtifactId(activeArtifactId);
    setPreviewKey((current) => current + 1);
    setCodeRefreshKey((current) => current + 1);
    setCheckpointMenuOpen(false);
  }

  async function changeCheckpoint(version: number, action: "preview" | "edit") {
    if (!activeArtifactId || isThinking || checkpointLoading) return;
    elementTools.cancelEdits();
    setIsElementPicking(false);
    setElementEditTarget(null);
    setCheckpointMenuOpen(false);
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
      setCheckpointError(error instanceof Error ? error.message : "无法切换版本");
    } finally {
      setCheckpointLoading(false);
    }
  }

  async function resumeLatestCheckpoint() {
    if (!activeArtifactId || isThinking || checkpointLoading) return;
    elementTools.cancelEdits();
    setIsElementPicking(false);
    setElementEditTarget(null);
    setCheckpointMenuOpen(false);
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
      setCheckpointError(error instanceof Error ? error.message : "无法返回当前版本");
    } finally {
      setCheckpointLoading(false);
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
      const artifact = await readArtifactProgress(response, setArtifactCreationPhase);
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
    elementTools.cancelEdits();
    setIsElementPicking(false);
    setActiveSessionId(null);
    setMessages([]);
    setInput("");
    setSelectedElements([]);
    setComposerElements([]);
    setElementEditTarget(null);
    setSessionsError("");
    setSidebarOpen(false);
  }

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
        `/api/sandbox/file?artifactId=${encodeURIComponent(activeArtifactId)}&path=${encodeURIComponent(filePath)}`,
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
        `/api/sandbox/files?artifactId=${encodeURIComponent(activeArtifactId)}`,
        { signal },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法读取沙箱代码目录");
      const nextTree: FileTreeNode[] = Array.isArray(payload.tree) ? payload.tree : [];
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
      setCodeError(error instanceof Error ? error.message : "无法读取沙箱代码目录");
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
              isDirectory ? toggleDirectory(node.path) : fetchSandboxFile(node.path)
            }
            aria-expanded={isDirectory ? isExpanded : undefined}
            title={node.path}
          >
            {isDirectory ? (
              <>
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
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

  async function sendMessage(messageOverride?: string): Promise<string | null> {
    const messageElements = [...composerElements];
    const requestedText = typeof messageOverride === "string" ? messageOverride.trim() : input.trim();
    const text = requestedText || (messageElements.length > 0
      ? DEFAULT_ELEMENT_PROMPT
      : "");
    if (!text || isThinking || !activeArtifactId || isHistoricalPreview) return null;
    const targetSessionId = activeSessionId;
    const messageAttachments = messageElements.map(toMessageElementAttachment);
    const agentMessage = messageAttachments.length > 0
      ? `${text}\n\n<artifact-editor-context>\n${JSON.stringify({
          instruction: "根据这些预览元素的 DOM 上下文、用户评论和预览修改完成请求。",
          elements: messageAttachments,
        }, null, 2)}\n</artifact-editor-context>`
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
      }>(response);
      if (!response.ok) throw new Error(payload.error || "pi Agent 调用失败");

      setActiveSessionId(payload.sessionId);
      if (payload.artifact) {
        const updatedArtifact = payload.artifact;
        setArtifacts((current) => current.map((artifact) =>
          artifact.id === updatedArtifact.id ? updatedArtifact : artifact
        ));
      }
      if (payload.runtimeWarning) setArtifactsError(payload.runtimeWarning);
      if (payload.checkpoints) setCheckpoints(payload.checkpoints);
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
          details: ["来自沙箱中的 pi Agent"],
        },
      ]);
      fetchSessionList(activeArtifactId).catch((error) => {
        setSessionsError(error instanceof Error ? error.message : "无法刷新会话历史");
      });
      return payload.reply;
    } catch (error) {
      setInput((current) => current.trim() ? current : text);
      setComposerElements((current) => current.length > 0 ? current : messageElements);
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: "agent",
          error: true,
          text: error instanceof Error ? error.message : "pi Agent 调用失败",
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
    elementTools.cancelEdits();
    setIsElementPicking(false);
    setRefreshing(true);
    setElementEditTarget(null);
    setPreviewKey((current) => current + 1);
    window.setTimeout(() => setRefreshing(false), 650);
  }

  async function copyCode() {
    await navigator.clipboard?.writeText(fileContent);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") return setChatWidth(MIN_CHAT_WIDTH);
    if (event.key === "End") return setChatWidth(MAX_CHAT_WIDTH);
    setChatWidth((current) =>
      Math.min(
        MAX_CHAT_WIDTH,
        Math.max(MIN_CHAT_WIDTH, current + (event.key === "ArrowRight" ? 24 : -24)),
      ),
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-cluster">
          <button
            className="icon-button mobile-only"
            aria-label="打开项目列表"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={19} />
          </button>
          <a className="brand" href="#" aria-label="Artifact 首页">
            <span className="brand-mark">A</span>
            <span>Artifact</span>
          </a>
          <span className="header-separator" />
          <div className="artifact-switcher">
            <button
              className="project-switcher"
              aria-haspopup="menu"
              aria-expanded={artifactMenuOpen}
              onClick={() => setArtifactMenuOpen((current) => !current)}
            >
              <span>
                {artifactsLoading
                  ? "正在读取产物…"
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
                    className={artifact.id === activeArtifactId ? "is-active" : ""}
                    onClick={() => activateArtifact(artifact.id)}
                    key={artifact.id}
                  >
                    <span>{artifact.name}</span>
                    {artifact.id === activeArtifactId && <Check size={14} />}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  className="artifact-create-button"
                  disabled={creatingArtifact}
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
          <span className={`save-state ${artifactsError ? "is-error" : ""}`}>
            {artifactsError ? <X size={13} /> : <Check size={13} />}
            {artifactsError || (activeArtifact
              ? `${technologyLabel(activeArtifact.detectedStack)} · ${
                activeArtifact.locatorMode === "code-inspector" ? "精确定位" : "DOM hint"
              }${activeArtifact.stackChanged ? " · 已自动切换" : ""}`
              : "未选择产物")}
          </span>
          <button className="share-button">分享</button>
          <button className="avatar" aria-label="账户菜单">林</button>
        </div>
      </header>

      <main
        className={`workspace ${isResizing ? "is-resizing" : ""}`}
        ref={workspaceRef}
        style={{ "--chat-width": `${chatWidth}px` } as CSSProperties}
      >
        <aside className={`history-rail ${sidebarOpen ? "is-open" : ""}`}>
          <div className="history-heading">
            <div>
              <span className="history-kicker">PI AGENT</span>
              <strong>对话历史</strong>
            </div>
            <div className="history-heading-actions">
              <button
                className="icon-button close-history"
                aria-label="关闭对话历史"
                onClick={() => setSidebarOpen(false)}
              >
                <X size={17} />
              </button>
              <button
                className="new-session-button"
                aria-label="新建对话"
                title="新建对话"
                disabled={isThinking || !activeArtifact}
                onClick={startNewSession}
              >
                <Plus size={17} />
              </button>
            </div>
          </div>

          <div className="session-list" aria-label="pi Agent sessions">
            {sessionsLoading && (
              <div className="session-list-state">正在读取 session…</div>
            )}
            {!sessionsLoading && sessionsError && (
              <div className="session-list-state is-error">{sessionsError}</div>
            )}
            {!sessionsLoading && !sessionsError && sessions.length === 0 && (
              <div className="session-list-state">还没有保存的对话</div>
            )}
            {sessions.map((session) => (
              <button
                className={`session-item ${session.id === activeSessionId ? "is-active" : ""}`}
                key={session.id}
                disabled={isThinking}
                onClick={() => openSession(session.id)}
              >
                <span className="session-item-topline">
                  <strong>{session.title}</strong>
                  <time>{formatSessionTime(session.updatedAt)}</time>
                </span>
                <span className="session-preview">{session.preview}</span>
                <span className="session-count">{session.messageCount} 条消息</span>
              </button>
            ))}
          </div>

          <div className="history-status">
            <span /> {activeArtifact ? `${activeArtifact.name} 已连接` : "等待选择产物"}
          </div>
        </aside>

        {sidebarOpen && (
          <button
            className="mobile-scrim"
            aria-label="关闭项目列表"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <section className="chat-panel" aria-label="Agent 对话">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">沙箱对话</p>
              <h1>{activeSession?.title || "新对话"}</h1>
            </div>
            <button className="icon-button" aria-label="更多对话操作">
              <MoreHorizontal size={19} />
            </button>
          </div>

          <div className="messages" aria-live="polite" ref={messagesRef}>
            <div className="day-divider"><span>会话记录</span></div>
            {sessionLoading && (
              <div className="connection-note">
                <span><RefreshCw className="spin" size={16} /></span>
                <div>
                  <strong>正在读取 session</strong>
                  <p>马上显示这个对话的真实历史消息。</p>
                </div>
              </div>
            )}
            {!sessionLoading && messages.length === 0 && (
              <div className="connection-note">
                <span><Sparkles size={16} /></span>
                <div>
                  <strong>{activeSessionId ? "这个 session 暂无消息" : "开始一个新对话"}</strong>
                  <p>消息会保存到沙箱，并可以从左侧继续原来的 session。</p>
                </div>
              </div>
            )}
            {!sessionLoading && messages.map((message) => (
              <article className={`message ${message.role} ${message.error ? "is-error" : ""}`} key={message.id}>
                <div className="message-meta">
                  <span className={`message-avatar ${message.role}`}>
                    {message.role === "agent" ? <Sparkles size={15} /> : "你"}
                  </span>
                  <strong>{message.role === "agent" ? "pi Agent" : "你"}</strong>
                  <time>{message.time}</time>
                </div>
                <p>{message.text}</p>
                {message.attachments && message.attachments.length > 0 && (
                  <section className="message-element-attachments" aria-label="消息附带的预览元素">
                    <div className="message-element-attachments-heading">
                      <ScanSearch size={13} />
                      <span>附带 {message.attachments.length} 个预览元素</span>
                    </div>
                    <div className="message-element-attachments-list">
                      {message.attachments.map((attachment, index) => (
                        <article className="message-element-attachment" key={`${attachment.hint}-${index}`}>
                          <span className="message-element-attachment-icon" aria-hidden="true">
                            {attachment.comment ? <MessageSquareText size={12} /> : <Code2 size={12} />}
                          </span>
                          <span className="message-element-attachment-body">
                            <code title={attachment.hint}>{attachment.hint}</code>
                            {attachment.comment && <small>{attachment.comment}</small>}
                            {!attachment.comment && attachment.changes && attachment.changes.length > 0 && (
                              <small>已应用 {attachment.changes.length} 项预览修改</small>
                            )}
                            {attachment.source && (
                              <small className="is-source">
                                {attachment.source.file}:{attachment.source.line}
                              </small>
                            )}
                          </span>
                        </article>
                      ))}
                    </div>
                  </section>
                )}
                {message.details && (
                  <div className="agent-steps">
                    {message.details.map((detail) => (
                      <span key={detail}><Check size={12} /> {detail}</span>
                    ))}
                  </div>
                )}
              </article>
            ))}

            {isThinking && (
              <article className="message agent thinking-message">
                <div className="message-meta">
                  <span className="message-avatar agent"><Sparkles size={15} /></span>
                  <strong>pi Agent</strong>
                  <span className="thinking-label">正在沙箱中处理</span>
                </div>
                <div className="thinking-dots"><i /><i /><i /></div>
              </article>
            )}
          </div>

          <div className="composer-wrap">
            {composerElements.length > 0 && (
              <section className="selected-elements-panel" aria-label="本次消息附带的元素">
                <div className="selected-elements-heading">
                  <span>
                    <ScanSearch size={13} />已附加到本次消息
                    <b>{composerElements.length}</b>
                  </span>
                  <button type="button" onClick={() => setComposerElements([])}>清空</button>
                </div>
                <div className="selected-elements-list">
                  {composerElements.map((element) => (
                    <div className="selected-element-item" key={element.key}>
                      <span className="selected-element-icon" aria-hidden="true">
                        {element.comment ? <MessageSquareText size={12} /> : <Code2 size={12} />}
                      </span>
                      <code title={element.hint}>
                        {element.hint}
                        {element.comment && <small>{element.comment}</small>}
                        {!element.comment && element.changes && (
                          <small>已应用 {element.changes.length} 项样式修改</small>
                        )}
                      </code>
                      <button
                        type="button"
                        aria-label={`从本次消息移除 ${element.hint}`}
                        title="移除"
                        onClick={() => setComposerElements((current) =>
                          current.filter((item) => item.key !== element.key)
                        )}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <div className="composer">
              <textarea
                ref={composerInputRef}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  resizeComposerInput(event.currentTarget);
                }}
                onKeyDown={handleKeyDown}
                placeholder={isHistoricalPreview ? "历史版本为只读，请先基于此版本编辑" : "描述你想修改的内容…"}
                rows={1}
                aria-label="给 Agent 发消息"
                disabled={isHistoricalPreview}
              />
              <div className="composer-actions">
                <div>
                  <button className="composer-icon" aria-label="添加附件">
                    <Paperclip size={17} />
                  </button>
                  <button className="model-button">
                    <WandSparkles size={15} /> pi Agent
                    <ChevronDown size={13} />
                  </button>
                </div>
                <button
                  className="send-button"
                  aria-label="发送消息"
                  disabled={!canSend}
                  onClick={() => sendMessage()}
                >
                  <ArrowUp size={18} />
                </button>
              </div>
            </div>
            <p className="composer-hint">
              {isHistoricalPreview ? "当前正在只读浏览历史版本" : "Enter 发送 · Shift + Enter 换行"}
            </p>
          </div>
        </section>

        <div
          className="panel-resizer"
          role="separator"
          aria-label="调整对话与预览区域宽度"
          aria-orientation="vertical"
          aria-valuemin={MIN_CHAT_WIDTH}
          aria-valuemax={MAX_CHAT_WIDTH}
          aria-valuenow={Math.round(chatWidth)}
          tabIndex={0}
          title="拖动调整宽度 · 双击复位"
          onPointerDown={(event) => {
            event.preventDefault();
            setIsResizing(true);
          }}
          onDoubleClick={() => setChatWidth(DEFAULT_CHAT_WIDTH)}
          onKeyDown={resizeWithKeyboard}
        >
          <span />
        </div>

        <section className="preview-panel" aria-label="产物预览">
          <div className="preview-toolbar">
            <div className="view-tabs" role="tablist" aria-label="预览模式">
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
                    elementTools.cancelEdits();
                    setIsElementPicking(false);
                    setElementEditTarget(null);
                    setView("code");
                }}
                role="tab"
                aria-selected={view === "code"}
              >
                <Code2 size={15} /> 代码
              </button>
            </div>

            <div className="preview-tools">
              <div
                ref={checkpointMenuRef}
                className="checkpoint-switcher"
                onBlur={closeCheckpointMenuOnBlur}
              >
                <button
                  type="button"
                  className="checkpoint-button"
                  disabled={!checkpointState || checkpointLoading || isThinking}
                  aria-busy={checkpointLoading}
                  aria-expanded={checkpointMenuOpen}
                  onClick={() => setCheckpointMenuOpen((current) => !current)}
                >
                  {checkpointLoading
                    ? <RefreshCw className="checkpoint-spinner" size={15} />
                    : <History size={15} />}
                  V{checkpointState?.activeVersion ?? checkpointState?.workspaceVersion ?? "—"}
                  <ChevronDown size={13} />
                </button>
                {checkpointMenuOpen && (
                  <div className="checkpoint-menu" role="menu" aria-label="Checkpoint 版本">
                    <div className="checkpoint-menu-heading">
                      <strong>版本记录</strong>
                      <span>当前版本 V{checkpointState?.workspaceVersion ?? "—"}</span>
                    </div>
                    {checkpoints.map((checkpoint) => {
                      const isActive = checkpoint.version === checkpointState?.activeVersion;
                      const isWorkspace = checkpoint.version === checkpointState?.workspaceVersion;
                      return (
                        <button
                          type="button"
                          role="menuitem"
                          className={isActive ? "is-active" : ""}
                          key={checkpoint.tag}
                          disabled={isActive || checkpointLoading}
                          onClick={() => isWorkspace
                            ? resumeLatestCheckpoint()
                            : changeCheckpoint(checkpoint.version, "preview")}
                        >
                          <span className="checkpoint-version">V{checkpoint.version}</span>
                          <span className="checkpoint-description">
                            <b>{checkpoint.message}</b>
                            <small>{new Date(checkpoint.createdAt).toLocaleString("zh-CN")}</small>
                          </span>
                          {isWorkspace && <em>当前</em>}
                          {isActive && !isWorkspace && <em>正在查看</em>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <button
                type="button"
                className={`edit-mode-button ${isElementPicking ? "is-active" : ""}`}
                aria-label={isElementPicking ? "退出元素编辑模式" : "进入元素编辑模式"}
                aria-pressed={isElementPicking}
                disabled={isHistoricalPreview}
                onClick={() => {
                  if (view !== "preview") setView("preview");
                  if (isElementPicking) elementTools.cancelEdits();
                  setElementEditTarget(null);
                  setIsElementPicking((current) => !current);
                }}
              >
                <ScanSearch size={15} />
                {isElementPicking ? "退出编辑" : "编辑页面"}
              </button>
              <span className="toolbar-rule" />
              <span className="desktop-label"><Laptop size={15} /> 桌面</span>
              <span className="toolbar-rule" />
              <button className="icon-button" onClick={refreshPreview} aria-label="刷新预览">
                <RefreshCw size={16} className={refreshing ? "spin" : ""} />
              </button>
              <button
                className="icon-button"
                aria-label="在新窗口打开"
                disabled={!activeArtifact}
                onClick={() => activeArtifact && window.open(
                  activeArtifact.previewUrl,
                  "_blank",
                  "noopener,noreferrer",
                )}
              >
                <ExternalLink size={16} />
              </button>
            </div>
          </div>

          {checkpointError && <div className="checkpoint-error" role="alert">{checkpointError}</div>}

          <div className="canvas-area">
            {view === "preview" ? (
              <div className="browser-frame">
                <div className="browser-bar">
                  <div className="traffic-lights"><i /><i /><i /></div>
                  <div className="address-bar">
                    <span className="secure-dot" /> {window.location.host}
                    {activeArtifact?.previewUrl || "/未选择产物"}
                  </div>
                  <MoreHorizontal size={16} />
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
                        onClick={() => changeCheckpoint(checkpointState.activeVersion || 0, "edit")}
                      >
                        基于此版本编辑
                      </button>
                      <button type="button" disabled={checkpointLoading} onClick={resumeLatestCheckpoint}>
                        返回 V{checkpointState.workspaceVersion}
                      </button>
                    </div>
                  </div>
                )}
                {checkpointState?.mode === "editing-history" && (
                  <div className="checkpoint-notice is-editing">
                    <span>
                      正在基于 <b>V{checkpointState.activeVersion}</b> 编辑，保存后将成为 <b>V{checkpointState.nextVersion}</b>
                    </span>
                    <button type="button" disabled={checkpointLoading} onClick={resumeLatestCheckpoint}>
                      放弃并返回 V{checkpointState.workspaceVersion}
                    </button>
                  </div>
                )}
                <iframe
                  key={previewKey}
                  ref={previewIframeRef}
                  className="sandbox-preview"
                  src={activeArtifact && previewArtifactId === activeArtifact.id
                    ? activeArtifact.previewUrl
                    : "about:blank"}
                  title={activeArtifact ? `${activeArtifact.name} 预览` : "产物预览"}
                />
                {selectedElements.length > 0 && (
                  <aside className="element-selection-tray" aria-label="元素发送列表">
                    <section className="element-selection-queue">
                        <div className="element-selection-tray-heading">
                          <span>
                            <Sparkles size={14} />发送列表
                            <b>{selectedElements.length}</b>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (elementEditTarget) elementTools.cancelEdits();
                              setSelectedElements([]);
                              setElementEditTarget(null);
                            }}
                          >
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
                                <span className="selected-element-icon" aria-hidden="true">
                                  {element.comment ? <MessageSquareText size={13} /> : <Code2 size={13} />}
                                </span>
                                <span>
                                  <code title={element.hint}>{element.hint}</code>
                                  {element.comment && <small>{element.comment}</small>}
                                  {!element.comment && element.changes && (
                                    <small>已应用 {element.changes.length} 项样式修改</small>
                                  )}
                                </span>
                              </button>
                              <button
                                type="button"
                                className="element-selection-remove"
                                aria-label={`移除 ${element.hint}`}
                                title="移除"
                                onClick={() => {
                                  setSelectedElements((current) =>
                                    current.filter((item) => item.key !== element.key),
                                  );
                                  if (elementEditTarget?.kind === "queue-item"
                                    && elementEditTarget.key === element.key) {
                                    elementTools.cancelEdits();
                                    setElementEditTarget(null);
                                  }
                                }}
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
                          <Check size={14} />Apply 到对话
                        </button>
                    </section>
                  </aside>
                )}
                {elementEditorState.status === "editing" && elementEditTarget && (() => {
                  const placement = elementEditorPosition();
                  return placement ? (
                    <ElementEditorPopover
                      key={elementEditTarget.kind === "queue-item"
                        ? `queue-${elementEditTarget.key}`
                        : "preview-selection"}
                      state={elementEditorState}
                      initialComment={elementEditTarget.kind === "queue-item"
                        ? elementEditTarget.element.comment
                        : ""}
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
              <div className="code-frame">
                <aside className="code-sidebar" aria-label="沙箱代码目录">
                  <div className="code-sidebar-heading">
                    <span>EXPLORER</span>
                    <strong>{activeArtifact?.id || "未选择产物"}</strong>
                  </div>
                  <div className="file-tree">
                    {codeTree.length > 0 ? renderFileTree(codeTree) : (
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
                    <button onClick={copyCode} disabled={!selectedFile || codeLoading || !!codeError}>
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                      {copied ? "已复制" : "复制"}
                    </button>
                  </div>
                  <div className="code-content">
                    {codeLoading && <div className="code-empty-state">正在读取沙箱文件…</div>}
                    {!codeLoading && codeError && (
                      <div className="code-empty-state is-error">{codeError}</div>
                    )}
                    {!codeLoading && !codeError && selectedFile && (
                      <pre><code>{fileContent}</code></pre>
                    )}
                  </div>
                </section>
              </div>
            )}
            {checkpointLoading && (
              <div className="checkpoint-loading-overlay" role="status" aria-live="polite">
                <span>
                  <RefreshCw className="checkpoint-spinner" size={17} />
                  正在切换版本…
                </span>
              </div>
            )}
          </div>
        </section>
      </main>

      {artifactDialogOpen && (
        <div
          className="artifact-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !creatingArtifact) {
              setArtifactDialogOpen(false);
            }
          }}
        >
          <form
            className="artifact-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="artifact-dialog-title"
            onSubmit={createNewArtifact}
          >
            <div className="artifact-dialog-heading">
              <div>
                <span>NEW ARTIFACT</span>
                <h2 id="artifact-dialog-title">创建产物</h2>
              </div>
              <button
                type="button"
                aria-label="关闭"
                disabled={creatingArtifact}
                onClick={() => setArtifactDialogOpen(false)}
              >
                <X size={17} />
              </button>
            </div>

            <label className="artifact-field">
              <span>产物名称</span>
              <input
                autoFocus
                required
                maxLength={80}
                disabled={creatingArtifact}
                value={artifactDraftName}
                placeholder="例如：智慧市政运行监测报告"
                onChange={(event) => setArtifactDraftName(event.target.value)}
              />
            </label>

            <fieldset className="technology-options">
              <legend>技术栈</legend>
              {TECHNOLOGY_OPTIONS.map((option) => (
                <label
                  className={artifactDraftStack === option.value ? "is-selected" : ""}
                  key={option.value}
                >
                  <input
                    type="radio"
                    name="technology-stack"
                    value={option.value}
                    disabled={creatingArtifact}
                    checked={artifactDraftStack === option.value}
                    onChange={() => setArtifactDraftStack(option.value)}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  <i aria-hidden="true" />
                </label>
              ))}
            </fieldset>

            <p className="artifact-dialog-note">
              启动预览和继续对话时会重新检测实际技术栈；如果项目中途切换，定位方式会自动降级或切换。
            </p>

            {artifactCreationPhase !== "idle" && (
              <section className="artifact-creation-progress" aria-live="polite">
                <div className="artifact-creation-progress-heading">
                  <span>{artifactCreationPhase === "ready" ? "创建完成" : artifactCreationError ? "创建遇到问题" : "正在准备产物"}</span>
                  <small>{artifactCreationPhase === "ready" ? "预览已经可以使用" : "请保持此窗口开启"}</small>
                </div>
                <ol>
                  {ARTIFACT_CREATION_STEPS.map((step, index) => {
                    const status = artifactCreationStepState(
                      artifactCreationPhase,
                      step.phase,
                      Boolean(artifactCreationError),
                    );
                    return (
                      <li className={`is-${status}`} key={step.phase}>
                        <span className="artifact-creation-step-marker">
                          {status === "complete" || artifactCreationPhase === "ready" ? (
                            <Check size={13} />
                          ) : status === "error" ? (
                            <X size={13} />
                          ) : status === "active" ? (
                            <RefreshCw className="spin" size={13} />
                          ) : (
                            index + 1
                          )}
                        </span>
                        <span>
                          <strong>{step.label}</strong>
                          <small>{step.description}</small>
                        </span>
                      </li>
                    );
                  })}
                </ol>
                {artifactCreationError && <p>{artifactCreationError}</p>}
              </section>
            )}

            <div className="artifact-dialog-actions">
              <button
                type="button"
                disabled={creatingArtifact}
                onClick={() => setArtifactDialogOpen(false)}
              >
                取消
              </button>
              <button type="submit" disabled={creatingArtifact || !artifactDraftName.trim()}>
                {creatingArtifact
                  ? "正在创建…"
                  : artifactCreationError
                  ? "重新创建"
                  : "创建并启动"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;
