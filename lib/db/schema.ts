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

export const observations = sqliteTable(
  "observations",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    projectionVersion: text("projection_version").notNull(),
    sourceReviewId: text("source_review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    sourceRef: text("source_ref").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    supportType: text("support_type"),
    payload: text("payload").notNull(),
    firstSeenAt: text("first_seen_at"),
    lastSeenAt: text("last_seen_at"),
    detectedAt: text("detected_at").notNull(),
    distinctSessionCount: integer("distinct_session_count").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("observations_source_identity_unique").on(
      table.sourceReviewId,
      table.sourceRef,
      table.projectionVersion,
    ),
  ],
);

export const observationSessions = sqliteTable(
  "observation_sessions",
  {
    observationId: text("observation_id")
      .notNull()
      .references(() => observations.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.observationId, table.sessionId] }),
  ],
);

export const concepts = sqliteTable(
  "concepts",
  {
    id: text("id").primaryKey(),
    canonicalLabel: text("canonical_label").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    matchingVersion: text("matching_version").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("concepts_normalized_key_unique").on(table.normalizedKey),
  ],
);

export const conceptAliases = sqliteTable(
  "concept_aliases",
  {
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    aliasLabel: text("alias_label").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.conceptId, table.normalizedAlias] }),
  ],
);

export const conceptOccurrences = sqliteTable(
  "concept_occurrences",
  {
    id: text("id").primaryKey(),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    evidenceRef: text("evidence_ref").notNull(),
    occurredAt: text("occurred_at").notNull(),
    sourceRole: text("source_role").notNull(),
    sourceType: text("source_type").notNull(),
    extractionVersion: text("extraction_version").notNull(),
  },
  (table) => [
    uniqueIndex("concept_occurrences_identity_unique").on(
      table.extractionVersion,
      table.sourceType,
      table.messageId,
      table.evidenceRef,
      table.conceptId,
    ),
  ],
);

export const observationConceptEvidenceSupports = sqliteTable(
  "observation_concept_evidence_supports",
  {
    observationId: text("observation_id")
      .notNull()
      .references(() => observations.id, { onDelete: "cascade" }),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    evidenceRef: text("evidence_ref").notNull(),
    relationVersion: text("relation_version").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.relationVersion,
        table.observationId,
        table.conceptId,
        table.sessionId,
        table.messageId,
        table.evidenceRef,
      ],
    }),
  ],
);

export const conceptProcessingCheckpoints = sqliteTable(
  "concept_processing_checkpoints",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    processingVersion: text("processing_version").notNull(),
    completedAt: text("completed_at").notNull(),
    existingMatchCount: integer("existing_match_count").notNull(),
    newCandidateCount: integer("new_candidate_count").notNull(),
    provisionalNewCount: integer("provisional_new_count").notNull(),
    groundingRejectedCount: integer("grounding_rejected_count").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.processingVersion] }),
  ],
);

export type SessionRecord = typeof sessions.$inferSelect;
export type MessageRecord = typeof messages.$inferSelect;
export type SourceConversationRecord = typeof sourceConversations.$inferSelect;
export type SessionAnalysisRecord = typeof sessionAnalyses.$inferSelect;
export type ReviewRecord = typeof reviews.$inferSelect;
export type EvidenceRecord = typeof evidences.$inferSelect;
export type ContextPackRecord = typeof contextPacks.$inferSelect;
export type ObservationRecord = typeof observations.$inferSelect;
export type ConceptRecord = typeof concepts.$inferSelect;
export type ConceptAliasRecord = typeof conceptAliases.$inferSelect;
export type ConceptOccurrenceRecord = typeof conceptOccurrences.$inferSelect;
export type ObservationConceptEvidenceSupportRecord =
  typeof observationConceptEvidenceSupports.$inferSelect;
export type ConceptProcessingCheckpointRecord =
  typeof conceptProcessingCheckpoints.$inferSelect;
