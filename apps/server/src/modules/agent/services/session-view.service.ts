import { Injectable } from "@nestjs/common";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionHeader, SessionEvent } from "@deepseek-ai/dsh-session";
import { Session } from "@deepseek-ai/dsh-session";

import { SessionModel } from "../models/session.model.js";

export interface SessionView {
  id: string;
  cwd?: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  messages: Array<{
    id: string;
    role: "user" | "agent";
    text: string;
    timestamp: string;
    attachments?: unknown[];
  }>;
  artifactId?: string;
}
export interface SessionReadResult {
  session?: SessionView | null;
  sessions?: Omit<SessionView, "messages">[];
}

@Injectable()
export class SessionViewService {
  presentUserMessage(text: string) {
    const marker = "\n\n<artifact-editor-context>\n";
    const start = text.indexOf(marker);
    const end = text.lastIndexOf("\n</artifact-editor-context>");
    if (start >= 0 && end > start) {
      try {
        const payload = JSON.parse(text.slice(start + marker.length, end));
        const attachments = (
          Array.isArray(payload.elements) ? payload.elements : []
        ).filter(
          (element: { hint?: unknown } | null) =>
            element && typeof element.hint === "string",
        );
        return {
          text: text.slice(0, start).trim(),
          ...(attachments.length ? { attachments } : {}),
        };
      } catch {}
    }
    return { text };
  }

  private presentSession(
    header: SessionHeader,
    events: readonly SessionEvent[],
  ): SessionView {
    const session = Session.create(header.id, events, header);
    const eventTimes = new Map<string, number>(
      events.flatMap((event) => {
        const message =
          event.type === "user/message"
            ? event.data
            : event.type === "assistant/message"
              ? event.data.message
              : null;
        return message ? [[message.id, event.time]] : [];
      }),
    );
    const messages = session.deriveMessages().flatMap((message) => {
      if (
        (message.role !== "user" && message.role !== "assistant") ||
        (message.role === "user" && message.source.kind !== "user")
      )
        return [];
      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (!text) return [];
      return [
        {
          id: message.id,
          role:
            message.role === "assistant"
              ? ("agent" as const)
              : ("user" as const),
          ...(message.role === "user"
            ? this.presentUserMessage(text)
            : { text }),
          timestamp: new Date(
            eventTimes.get(message.id) ?? header.createdAt,
          ).toISOString(),
        },
      ];
    });
    return {
      id: header.id,
      cwd: header.cwd,
      title:
        messages
          .find((message) => message.role === "user")
          ?.text.slice(0, 48) || "新对话",
      preview: messages.at(-1)?.text.slice(0, 88) || "暂无消息",
      createdAt: new Date(header.createdAt).toISOString(),
      updatedAt: new Date(
        events.at(-1)?.time ?? header.createdAt,
      ).toISOString(),
      messageCount: messages.length,
      messages,
    };
  }

  async read(
    persistence: Context["sessionPersistence"],
    sessionId: string,
    root: string,
  ): Promise<SessionReadResult> {
    if (sessionId && !SessionModel.isValidId(sessionId))
      throw new Error("无效的 session ID");
    const snapshots = (await persistence.list()).filter(
      (item) =>
        item.header.cwd === root &&
        (!sessionId || item.header.id === sessionId),
    );
    const sessions: SessionView[] = [];
    for (const snapshot of snapshots) {
      const handle = await persistence.open(snapshot.header.id, "read");
      try {
        sessions.push(
          this.presentSession(handle.header, (await handle.read()).events),
        );
      } finally {
        await handle.close();
      }
    }
    sessions.sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );
    if (sessionId) return { session: sessions[0] || null };
    return { sessions: sessions.map(({ messages, ...summary }) => summary) };
  }
}
