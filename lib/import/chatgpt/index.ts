import { buildPreparedSession, buildSessionTitles } from "./build-transcript";
import { extractConversationsFromJson } from "./parse-export";
import { splitByTimeGap } from "./split-sessions";
import type {
  ExtractedConversation,
  GapHours,
  PreparedSession,
} from "./types";
import {
  DEFAULT_SESSION_GAP_HOURS,
  SESSION_GAP_PRESETS,
} from "./types";

export function unixToIso(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

export function toImportPayload(
  conversation: ExtractedConversation,
  gapHours: GapHours,
) {
  return {
    conversation: {
      externalConversationId: conversation.externalConversationId,
      title: conversation.title,
      sourceCreatedAt: unixToIso(conversation.sourceCreatedAt),
      sourceUpdatedAt: unixToIso(conversation.sourceUpdatedAt),
      isArchived: conversation.isArchived,
    },
    sessions: prepareConversationSessions(conversation, gapHours),
  };
}

export function previewConversation(
  conversation: ExtractedConversation,
  gapHours: GapHours,
) {
  const chunks = splitByTimeGap(conversation.visibleMessages, gapHours);
  return {
    externalConversationId: conversation.externalConversationId,
    title: conversation.title,
    sourceCreatedAt: conversation.sourceCreatedAt,
    sourceUpdatedAt: conversation.sourceUpdatedAt,
    isArchived: conversation.isArchived,
    visibleMessageCount: conversation.visibleMessages.length,
    estimatedSessionCount: Math.max(chunks.length, 0),
    sessions: chunks.map((chunk, index) => ({
      index,
      messageCount: chunk.length,
      startAt: chunk[0]?.sourceCreatedAt ?? null,
      endAt: chunk[chunk.length - 1]?.sourceCreatedAt ?? null,
    })),
  };
}

export function prepareConversationSessions(
  conversation: ExtractedConversation,
  gapHours: GapHours,
): PreparedSession[] {
  const chunks = splitByTimeGap(conversation.visibleMessages, gapHours);
  const titles = buildSessionTitles(conversation.title, chunks);
  return chunks.map((chunk, index) => buildPreparedSession(titles[index], chunk));
}

export function extractAndPreview(data: unknown, gapHours: GapHours) {
  const conversations = extractConversationsFromJson(data);
  return conversations.map((conversation) => ({
    conversation,
    preview: previewConversation(conversation, gapHours),
  }));
}

export {
  extractConversationsFromJson,
  splitByTimeGap,
  buildPreparedSession,
  DEFAULT_SESSION_GAP_HOURS,
  SESSION_GAP_PRESETS,
};
