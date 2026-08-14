export type ChatGptRole = "user" | "assistant" | "system" | "tool" | string;

export type ChatGptContentPart =
  | string
  | {
      content_type?: string;
      asset_pointer?: string;
      text?: string;
      [key: string]: unknown;
    };

export type ChatGptMessage = {
  id?: string;
  author?: { role?: ChatGptRole };
  create_time?: number | null;
  content?: {
    content_type?: string;
    parts?: ChatGptContentPart[];
  };
  metadata?: {
    attachments?: Array<{
      id?: string;
      name?: string;
      mime_type?: string;
      size?: number;
    }>;
    [key: string]: unknown;
  };
};

export type ChatGptMappingNode = {
  id?: string;
  parent?: string | null;
  children?: string[];
  message?: ChatGptMessage | null;
};

export type ChatGptConversation = {
  id?: string;
  conversation_id?: string;
  title?: string | null;
  create_time?: number | null;
  update_time?: number | null;
  current_node?: string | null;
  mapping?: Record<string, ChatGptMappingNode>;
  is_archived?: boolean;
};

export type AttachmentMeta = {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  assetPointer?: string;
};

export type VisibleMessage = {
  role: "user" | "assistant";
  content: string;
  sourceMessageId: string | null;
  sourceCreatedAt: number | null;
  contentType: string;
  attachments: AttachmentMeta[];
};

export type ExtractedConversation = {
  externalConversationId: string;
  title: string;
  sourceCreatedAt: number | null;
  sourceUpdatedAt: number | null;
  isArchived: boolean;
  currentNode: string | null;
  visibleMessages: VisibleMessage[];
  skippedNodeCount: number;
};

export type GapHours = number | null;

export const DEFAULT_SESSION_GAP_HOURS = 5;

export const SESSION_GAP_PRESETS = [3, 5, 8, 12, 24] as const;

export type PreparedSession = {
  title: string;
  occurredAt: string;
  sourceStartAt: string | null;
  sourceEndAt: string | null;
  rawContent: string;
  messages: Array<
    VisibleMessage & {
      index: number;
      charStart: number;
      charEnd: number;
    }
  >;
};
