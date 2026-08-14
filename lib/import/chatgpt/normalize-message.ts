import type {
  AttachmentMeta,
  ChatGptContentPart,
  ChatGptMappingNode,
  VisibleMessage,
} from "./types";
import { isVisibleContentType } from "./content-rules";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textFromPart(part: ChatGptContentPart): string {
  if (typeof part === "string") {
    return part;
  }
  if (typeof part.text === "string") {
    return part.text;
  }
  return "";
}

function attachmentFromPart(part: ChatGptContentPart): AttachmentMeta | null {
  const record = asRecord(part);
  if (!record) {
    return null;
  }

  const assetPointer =
    typeof record.asset_pointer === "string"
      ? record.asset_pointer
      : undefined;
  const contentType =
    typeof record.content_type === "string" ? record.content_type : "";

  if (!assetPointer && !contentType.includes("image") && !contentType.includes("asset")) {
    return null;
  }

  return {
    assetPointer,
    mimeType:
      typeof record.mime_type === "string" ? record.mime_type : undefined,
    name: typeof record.name === "string" ? record.name : undefined,
    size: typeof record.size === "number" ? record.size : undefined,
  };
}

function attachmentsFromMetadata(node: ChatGptMappingNode): AttachmentMeta[] {
  const attachments = node.message?.metadata?.attachments;
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments.map((item) => ({
    id: item.id,
    name: item.name,
    mimeType: item.mime_type,
    size: item.size,
  }));
}

export function normalizeVisibleMessage(
  node: ChatGptMappingNode,
): VisibleMessage | null {
  const message = node.message;
  if (!message) {
    return null;
  }

  const role = message.author?.role;
  if (role !== "user" && role !== "assistant") {
    return null;
  }

  const contentType = message.content?.content_type;
  if (!isVisibleContentType(contentType)) {
    return null;
  }

  const parts = message.content?.parts ?? [];
  const texts = parts.map(textFromPart).filter((part) => part.length > 0);
  const content = texts.join("\n");
  if (!/\S/.test(content)) {
    return null;
  }

  const fromParts = parts
    .map(attachmentFromPart)
    .filter((item): item is AttachmentMeta => item != null);
  const fromMeta = attachmentsFromMetadata(node);
  const attachments = [...fromMeta, ...fromParts];

  return {
    role,
    content,
    sourceMessageId: message.id ?? node.id ?? null,
    sourceCreatedAt:
      typeof message.create_time === "number" ? message.create_time : null,
    contentType: contentType ?? "text",
    attachments,
  };
}
