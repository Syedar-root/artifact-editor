import { runSandboxNode } from "./sandbox.js";

export { PI_CONTAINER_ID } from "./sandbox.js";
export const PI_SESSION_DIR = "/workspace/.artifact-pi-sessions";

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_SESSION_OUTPUT = 10 * 1024 * 1024;

const READ_SESSIONS_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");

const directory = process.argv[1];
const requestedId = process.argv[2] || "";
const workspaceRoot = path.resolve(process.argv[3]);
const requestedArtifactId = process.argv[4] || "";

function textFromContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

const CONTEXT_OPEN = '\n\n<artifact-editor-context>\n';
const CONTEXT_CLOSE = '\n</artifact-editor-context>';
const LEGACY_CONTEXT_OPEN = '\n\n以下是用户在预览中选择的运行时 DOM hint：\n\n';

function compactAttachment(value) {
  if (!value || typeof value !== 'object' || typeof value.hint !== 'string') return null;
  return {
    hint: value.hint,
    ...(typeof value.comment === 'string' && value.comment.trim()
      ? { comment: value.comment.trim() }
      : {}),
    ...(value.source && typeof value.source.file === 'string'
      ? { source: value.source }
      : {}),
    ...(Array.isArray(value.changes) ? { changes: value.changes } : {}),
  };
}

function legacyAttachments(context) {
  return context
    .split(/\n\n(?=\[元素 \d+\])/u)
    .flatMap((block) => {
      const hint = block.match(/^DOM 路径：(.+)$/mu)?.[1]?.trim();
      if (!hint) return [];
      const comment = block.match(/^用户评论：(.+)$/mu)?.[1]?.trim();
      const sourceValue = block.match(/^源码位置：(.+)$/mu)?.[1]?.trim() || '';
      const sourceMatch = sourceValue.match(/^(.*):(\d+):(\d+)$/u);
      return [{
        hint,
        ...(comment ? { comment } : {}),
        ...(sourceMatch ? {
          source: {
            file: sourceMatch[1],
            line: Number(sourceMatch[2]),
            column: Number(sourceMatch[3]),
          },
        } : {}),
      }];
    });
}

function presentUserMessage(text) {
  const contextStart = text.indexOf(CONTEXT_OPEN);
  if (contextStart >= 0) {
    const contextEnd = text.lastIndexOf(CONTEXT_CLOSE);
    if (contextEnd > contextStart) {
      try {
        const payload = JSON.parse(text.slice(contextStart + CONTEXT_OPEN.length, contextEnd));
        const attachments = Array.isArray(payload.elements)
          ? payload.elements.map(compactAttachment).filter(Boolean)
          : [];
        return { text: text.slice(0, contextStart).trim(), attachments };
      } catch {}
    }
  }

  const legacyStart = text.indexOf(LEGACY_CONTEXT_OPEN);
  if (legacyStart >= 0) {
    return {
      text: text.slice(0, legacyStart).trim(),
      attachments: legacyAttachments(text.slice(legacyStart + LEGACY_CONTEXT_OPEN.length)),
    };
  }
  return { text, attachments: [] };
}

function readSession(filePath) {
  const entries = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });

  const header = entries.find((entry) => entry.type === "session");
  if (!header || typeof header.id !== "string") return null;

  const treeEntries = entries.filter((entry) => entry && typeof entry.id === "string");
  const byId = new Map(treeEntries.map((entry) => [entry.id, entry]));
  const branch = [];
  let cursor = treeEntries.at(-1) || null;
  const visited = new Set();
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    branch.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
  }
  branch.reverse();

  const messages = branch.flatMap((entry) => {
    if (entry.type !== "message" || !entry.message) return [];
    const role = entry.message.role;
    if (role !== "user" && role !== "assistant") return [];
    const text = textFromContent(entry.message.content) || entry.message.errorMessage || "";
    if (!text) return [];
    const presentation = role === "user" ? presentUserMessage(text) : { text, attachments: [] };
    return [{
      id: entry.id,
      role: role === "assistant" ? "agent" : "user",
      text: presentation.text,
      ...(presentation.attachments.length > 0 ? { attachments: presentation.attachments } : {}),
      error: role === "assistant" && entry.message.stopReason === "error",
      timestamp: new Date(entry.message.timestamp || entry.timestamp).toISOString(),
    }];
  });

  const latestName = entries
    .filter((entry) => entry.type === "session_info" && typeof entry.name === "string")
    .at(-1)?.name?.trim();
  const firstUser = messages.find((message) => message.role === "user")?.text || "新对话";
  const lastMessage = messages.at(-1);
  const lastEntry = entries.at(-1);
  const cwd = typeof header.cwd === "string" ? path.resolve(header.cwd) : "";
  const relativeCwd = cwd ? path.relative(workspaceRoot, cwd) : "";
  const artifactId = relativeCwd && !relativeCwd.startsWith("..") && !path.isAbsolute(relativeCwd)
    ? relativeCwd.split(path.sep)[0]
    : "";

  return {
    id: header.id,
    artifactId,
    title: latestName || firstUser.slice(0, 48),
    preview: lastMessage?.text.slice(0, 88) || "暂无消息",
    createdAt: new Date(header.timestamp).toISOString(),
    updatedAt: new Date(lastEntry?.timestamp || header.timestamp).toISOString(),
    messageCount: messages.length,
    cwd,
    messages,
  };
}

let sessions = [];
if (fs.existsSync(directory)) {
  sessions = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => readSession(path.join(directory, entry.name)))
    .filter(Boolean)
    .filter((session) => !requestedArtifactId || session.artifactId === requestedArtifactId)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

if (requestedId) {
  const session = sessions.find((item) => item.id === requestedId) || null;
  process.stdout.write(JSON.stringify({ session }));
} else {
  process.stdout.write(JSON.stringify({
    sessions: sessions.map(({ messages, ...summary }) => summary),
  }));
}
`;

export function isValidSessionId(value) {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

export async function readPiSessions(sessionId = "", artifactId = "") {
  if (sessionId && !isValidSessionId(sessionId)) {
    throw new Error("无效的 session ID");
  }

  const output = await runSandboxNode(READ_SESSIONS_SCRIPT, [
    PI_SESSION_DIR,
    sessionId,
    "/workspace",
    artifactId,
  ], { maxOutputBytes: MAX_SESSION_OUTPUT });

  return JSON.parse(output);
}
