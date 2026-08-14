import type {
  ChatGptConversation,
  ExtractedConversation,
  VisibleMessage,
} from "./types";
import { extractCurrentBranch } from "./extract-branch";
import { normalizeVisibleMessage } from "./normalize-message";

export function conversationExternalId(conversation: ChatGptConversation) {
  return conversation.conversation_id || conversation.id || "";
}

export function extractConversation(
  conversation: ChatGptConversation,
): ExtractedConversation | null {
  const externalConversationId = conversationExternalId(conversation);
  if (!externalConversationId) {
    return null;
  }

  const branch = extractCurrentBranch(conversation);
  const visibleMessages: VisibleMessage[] = [];
  let skippedNodeCount = 0;

  for (const node of branch) {
    const visible = normalizeVisibleMessage(node);
    if (visible) {
      visibleMessages.push(visible);
    } else if (node.message) {
      skippedNodeCount += 1;
    }
  }

  return {
    externalConversationId,
    title: conversation.title?.trim() || "無題のConversation",
    sourceCreatedAt:
      typeof conversation.create_time === "number"
        ? conversation.create_time
        : null,
    sourceUpdatedAt:
      typeof conversation.update_time === "number"
        ? conversation.update_time
        : null,
    isArchived: Boolean(conversation.is_archived),
    currentNode: conversation.current_node ?? null,
    visibleMessages,
    skippedNodeCount,
  };
}

export function parseExportJson(data: unknown): ChatGptConversation[] {
  if (Array.isArray(data)) {
    return data.filter(isConversation);
  }

  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (isConversation(record)) {
      return [record];
    }
    if (Array.isArray(record.conversations)) {
      return record.conversations.filter(isConversation);
    }
  }

  throw new Error("ChatGPT Export JSONの形式を認識できませんでした。");
}

function isConversation(value: unknown): value is ChatGptConversation {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as ChatGptConversation;
  return Boolean(record.mapping && (record.conversation_id || record.id));
}

export function extractConversationsFromJson(data: unknown): ExtractedConversation[] {
  return parseExportJson(data)
    .map(extractConversation)
    .filter((item): item is ExtractedConversation => item != null);
}
