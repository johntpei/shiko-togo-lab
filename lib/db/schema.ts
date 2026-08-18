import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const sourceConversations = sqliteTable(
  "source_conversations",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    externalConversationId: text("external_conversation_id").notNull(),
    title: text("title").notNull(),
    sourceCreatedAt: text("source_created_at"),
    sourceUpdatedAt: text("source_updated_at"),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
    importedAt: text("imported_at").notNull(),
  },
  (table) => [
    uniqueIndex("source_conversations_external_id_unique").on(
      table.source,
      table.externalConversationId,
    ),
  ],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  occurredAt: text("occurred_at").notNull(),
  source: text("source").notNull(),
  category: text("category").notNull().default(""),
  rawContent: text("raw_content").notNull(),
  status: text("status").notNull().default("draft"),
  sourceConversationId: text("source_conversation_id").references(
    () => sourceConversations.id,
    { onDelete: "set null" },
  ),
  importSource: text("import_source").notNull().default("manual"),
  sourceStartAt: text("source_start_at"),
  sourceEndAt: text("source_end_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  index: integer("index").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  charStart: integer("char_start").notNull(),
  charEnd: integer("char_end").notNull(),
  sourceMessageId: text("source_message_id"),
  sourceCreatedAt: text("source_created_at"),
  contentType: text("content_type"),
  attachmentsJson: text("attachments_json"),
});

export const sessionAnalyses = sqliteTable("session_analyses", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
});

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
});

export const reviewSessions = sqliteTable(
  "review_sessions",
  {
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.reviewId, table.sessionId] }),
  ],
);

export const evidences = sqliteTable("evidences", {
  id: text("id").primaryKey(),
  reviewId: text("review_id").references(() => reviews.id, {
    onDelete: "cascade",
  }),
  sessionAnalysisId: text("session_analysis_id").references(
    () => sessionAnalyses.id,
    { onDelete: "cascade" },
  ),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  quote: text("quote").notNull(),
  validated: integer("validated", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
});

export const contextPacks = sqliteTable("context_packs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  theme: text("theme").notNull().default(""),
  currentQuestion: text("current_question").notNull().default(""),
  sourceReviewId: text("source_review_id").references(() => reviews.id, {
    onDelete: "set null",
  }),
  markdown: text("markdown").notNull(),
  payload: text("payload").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
});

export const contextPackSessions = sqliteTable(
  "context_pack_sessions",
  {
    contextPackId: text("context_pack_id")
      .notNull()
      .references(() => contextPacks.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.contextPackId, table.sessionId] }),
  ],
);

export type SessionRecord = typeof sessions.$inferSelect;
export type MessageRecord = typeof messages.$inferSelect;
export type SourceConversationRecord = typeof sourceConversations.$inferSelect;
export type SessionAnalysisRecord = typeof sessionAnalyses.$inferSelect;
export type ReviewRecord = typeof reviews.$inferSelect;
export type EvidenceRecord = typeof evidences.$inferSelect;
export type ContextPackRecord = typeof contextPacks.$inferSelect;
