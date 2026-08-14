import { and, eq } from "drizzle-orm";
import { getDb } from "./client";
import {
  messages,
  sessions,
  sourceConversations,
} from "./schema";
import type { PreparedSession } from "@/lib/import/chatgpt/types";

export type ChatGptImportPayload = {
  conversation: {
    externalConversationId: string;
    title: string;
    sourceCreatedAt: string | null;
    sourceUpdatedAt: string | null;
    isArchived: boolean;
  };
  sessions: PreparedSession[];
};

export type ChatGptImportResult = {
  status: "imported" | "already_imported";
  conversationTitle: string;
  sessionCount: number;
  messageCount: number;
};

export function listChatGptExternalIds() {
  return getDb()
    .select({
      externalConversationId: sourceConversations.externalConversationId,
    })
    .from(sourceConversations)
    .where(eq(sourceConversations.source, "chatgpt"))
    .all()
    .map((row) => row.externalConversationId);
}

export function importChatGptConversation(
  payload: ChatGptImportPayload,
): ChatGptImportResult {
  const existing = getDb()
    .select()
    .from(sourceConversations)
    .where(
      and(
        eq(sourceConversations.source, "chatgpt"),
        eq(
          sourceConversations.externalConversationId,
          payload.conversation.externalConversationId,
        ),
      ),
    )
    .get();

  if (existing) {
    return {
      status: "already_imported",
      conversationTitle: existing.title,
      sessionCount: 0,
      messageCount: 0,
    };
  }

  let sessionCount = 0;
  let messageCount = 0;
  const now = new Date().toISOString();
  const sourceConversationId = crypto.randomUUID();

  getDb().transaction((tx) => {
    tx.insert(sourceConversations)
      .values({
        id: sourceConversationId,
        source: "chatgpt",
        externalConversationId: payload.conversation.externalConversationId,
        title: payload.conversation.title,
        sourceCreatedAt: payload.conversation.sourceCreatedAt,
        sourceUpdatedAt: payload.conversation.sourceUpdatedAt,
        isArchived: payload.conversation.isArchived,
        importedAt: now,
      })
      .run();

    for (const prepared of payload.sessions) {
      if (prepared.messages.length === 0) {
        continue;
      }

      const sessionId = crypto.randomUUID();
      tx.insert(sessions)
        .values({
          id: sessionId,
          title: prepared.title,
          occurredAt: prepared.occurredAt,
          source: "chatgpt",
          category: "",
          rawContent: prepared.rawContent,
          status: "parsed",
          sourceConversationId,
          importSource: "chatgpt_export",
          sourceStartAt: prepared.sourceStartAt,
          sourceEndAt: prepared.sourceEndAt,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      sessionCount += 1;

      const rows = prepared.messages.map((message) => ({
        id: crypto.randomUUID(),
        sessionId,
        index: message.index,
        role: message.role,
        content: message.content,
        charStart: message.charStart,
        charEnd: message.charEnd,
        sourceMessageId: message.sourceMessageId,
        sourceCreatedAt:
          message.sourceCreatedAt != null
            ? new Date(message.sourceCreatedAt * 1000).toISOString()
            : null,
        contentType: message.contentType,
        attachmentsJson:
          message.attachments.length > 0
            ? JSON.stringify(message.attachments)
            : null,
      }));

      if (rows.length > 0) {
        tx.insert(messages).values(rows).run();
        messageCount += rows.length;
      }
    }
  });

  return {
    status: "imported",
    conversationTitle: payload.conversation.title,
    sessionCount,
    messageCount,
  };
}
