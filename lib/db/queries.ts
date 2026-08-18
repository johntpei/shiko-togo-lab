import { and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { SessionSource } from "@/lib/sessions/constants";
import {
  assertMessageAnchors,
  parseTranscript,
  type ParsedMessage,
} from "@/lib/ingest/parse-transcript";
import { getDb } from "./client";
import type { StoredAnalysisPayload } from "@/lib/ai/schemas";
import type { StoredReviewPayload } from "@/lib/ai/review-schemas";
import type { StoredContextPackPayload } from "@/lib/context-pack/schema";
import {
  contextPacks,
  contextPackSessions,
  evidences,
  messages,
  reviewSessions,
  reviews,
  sessionAnalyses,
  sessions,
  type ContextPackRecord,
  type MessageRecord,
  type ReviewRecord,
  type SessionAnalysisRecord,
  type SessionRecord,
} from "./schema";

export type NewSessionInput = {
  title: string;
  occurredAt: string;
  source: SessionSource;
  category: string;
  rawContent: string;
};

export function insertSession(input: NewSessionInput) {
  const now = new Date().toISOString();
  const record: SessionRecord = {
    id: crypto.randomUUID(),
    title: input.title,
    occurredAt: input.occurredAt,
    source: input.source,
    category: input.category,
    rawContent: input.rawContent,
    status: "draft",
    sourceConversationId: null,
    importSource: "manual",
    sourceStartAt: null,
    sourceEndAt: null,
    createdAt: now,
    updatedAt: now,
  };

  getDb().insert(sessions).values(record).run();
  try {
    rebuildMessages(record.id, record.rawContent);
  } catch (error) {
    console.error("Failed to parse session messages:", error);
  }
  return record;
}

export function listSessions() {
  return getDb()
    .select()
    .from(sessions)
    .orderBy(desc(sessions.occurredAt), desc(sessions.createdAt))
    .all();
}

export function listRecentSessions(limit = 5) {
  return getDb()
    .select()
    .from(sessions)
    .orderBy(desc(sessions.createdAt))
    .limit(limit)
    .all();
}

export function getSessionById(id: string) {
  return (
    getDb().select().from(sessions).where(eq(sessions.id, id)).get() ?? null
  );
}

export function countSessionsInDateRange(startDate: string, endDate: string) {
  const row = getDb()
    .select({ value: count() })
    .from(sessions)
    .where(
      and(
        gte(sessions.occurredAt, startDate),
        lte(sessions.occurredAt, endDate),
      ),
    )
    .get();

  return row?.value ?? 0;
}

export function deleteSessionById(id: string) {
  getDb().delete(sessions).where(eq(sessions.id, id)).run();
}

export function listMessagesBySessionId(sessionId: string) {
  return getDb()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.index))
    .all();
}

export function rebuildMessages(sessionId: string, rawContent: string) {
  const parsed = parseTranscript(rawContent);
  assertMessageAnchors(rawContent, parsed);
  replaceMessages(sessionId, parsed);
  markSessionParsed(sessionId);
}

function replaceMessages(sessionId: string, parsed: ParsedMessage[]) {
  const nowRows: MessageRecord[] = parsed.map((item) => ({
    id: crypto.randomUUID(),
    sessionId,
    index: item.index,
    role: item.role,
    content: item.content,
    charStart: item.charStart,
    charEnd: item.charEnd,
    sourceMessageId: null,
    sourceCreatedAt: null,
    contentType: null,
    attachmentsJson: null,
  }));

  getDb().transaction((tx) => {
    tx.delete(messages).where(eq(messages.sessionId, sessionId)).run();
    if (nowRows.length > 0) {
      tx.insert(messages).values(nowRows).run();
    }
  });
}

function markSessionParsed(sessionId: string) {
  getDb()
    .update(sessions)
    .set({
      status: "parsed",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sessions.id, sessionId))
    .run();
}

export function getLatestSessionAnalysis(sessionId: string) {
  return (
    getDb()
      .select()
      .from(sessionAnalyses)
      .where(eq(sessionAnalyses.sessionId, sessionId))
      .orderBy(desc(sessionAnalyses.createdAt))
      .limit(1)
      .get() ?? null
  );
}

export function insertSessionAnalysis(input: {
  sessionId: string;
  model: string;
  promptVersion: string;
  payload: StoredAnalysisPayload;
  evidences: Array<{
    messageId: string;
    quote: string;
    validated: boolean;
  }>;
}): SessionAnalysisRecord {
  const now = new Date().toISOString();
  const record: SessionAnalysisRecord = {
    id: crypto.randomUUID(),
    sessionId: input.sessionId,
    model: input.model,
    promptVersion: input.promptVersion,
    payload: JSON.stringify(input.payload),
    createdAt: now,
  };

  getDb().transaction((tx) => {
    tx.insert(sessionAnalyses).values(record).run();
    if (input.evidences.length > 0) {
      tx.insert(evidences)
        .values(
          input.evidences.map((evidence) => ({
            id: crypto.randomUUID(),
            reviewId: null,
            sessionAnalysisId: record.id,
            sessionId: input.sessionId,
            messageId: evidence.messageId,
            quote: evidence.quote,
            validated: evidence.validated,
            createdAt: now,
          })),
        )
        .run();
    }
    tx.update(sessions)
      .set({
        status: "analyzed",
        updatedAt: now,
      })
      .where(eq(sessions.id, input.sessionId))
      .run();
  });

  return record;
}

export type SessionReviewCandidate = SessionRecord & {
  messageCount: number;
  charCount: number;
  analyzable: boolean;
};

export function listSessionReviewCandidates(): SessionReviewCandidate[] {
  const allSessions = listSessions();
  const stats = getDb()
    .select({
      sessionId: messages.sessionId,
      messageCount: count(),
      charCount: sql<number>`coalesce(sum(length(${messages.content})), 0)`,
    })
    .from(messages)
    .where(inArray(messages.role, ["user", "assistant"]))
    .groupBy(messages.sessionId)
    .all();
  const statsById = new Map(
    stats.map((row) => [
      row.sessionId,
      {
        messageCount: Number(row.messageCount),
        charCount: Number(row.charCount),
      },
    ]),
  );

  return allSessions.map((session) => {
    const row = statsById.get(session.id);
    const messageCount = row?.messageCount ?? 0;
    const charCount = row?.charCount ?? 0;
    return {
      ...session,
      messageCount,
      charCount,
      analyzable: messageCount > 0,
    };
  });
}

export function listSessionsByIds(ids: string[]) {
  if (ids.length === 0) {
    return [];
  }
  const unique = [...new Set(ids)];
  const rows = getDb()
    .select()
    .from(sessions)
    .where(inArray(sessions.id, unique))
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  return unique.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

export function insertReview(input: {
  title: string;
  model: string;
  promptVersion: string;
  payload: StoredReviewPayload;
  sessionIds: string[];
  evidences: Array<{
    sessionId: string;
    messageId: string;
    quote: string;
    validated: boolean;
  }>;
}): ReviewRecord {
  const now = new Date().toISOString();
  const record: ReviewRecord = {
    id: crypto.randomUUID(),
    title: input.title,
    model: input.model,
    promptVersion: input.promptVersion,
    payload: JSON.stringify(input.payload),
    createdAt: now,
  };

  getDb().transaction((tx) => {
    tx.insert(reviews).values(record).run();
    if (input.sessionIds.length > 0) {
      tx.insert(reviewSessions)
        .values(
          input.sessionIds.map((sessionId) => ({
            reviewId: record.id,
            sessionId,
          })),
        )
        .run();
    }
    if (input.evidences.length > 0) {
      tx.insert(evidences)
        .values(
          input.evidences.map((evidence) => ({
            id: crypto.randomUUID(),
            reviewId: record.id,
            sessionAnalysisId: null,
            sessionId: evidence.sessionId,
            messageId: evidence.messageId,
            quote: evidence.quote,
            validated: evidence.validated,
            createdAt: now,
          })),
        )
        .run();
    }
  });

  return record;
}

export function listReviews() {
  return getDb()
    .select()
    .from(reviews)
    .orderBy(desc(reviews.createdAt))
    .all();
}

export type ReviewListItem = ReviewRecord & {
  sessionCount: number;
};

export function listReviewsWithSessionCount(): ReviewListItem[] {
  const all = listReviews();
  const counts = getDb()
    .select({
      reviewId: reviewSessions.reviewId,
      sessionCount: count(),
    })
    .from(reviewSessions)
    .groupBy(reviewSessions.reviewId)
    .all();
  const countById = new Map(
    counts.map((row) => [row.reviewId, Number(row.sessionCount)]),
  );
  return all.map((review) => ({
    ...review,
    sessionCount: countById.get(review.id) ?? 0,
  }));
}

export function getReviewById(id: string) {
  return getDb().select().from(reviews).where(eq(reviews.id, id)).get() ?? null;
}

export function listSessionsByReviewId(reviewId: string) {
  return getDb()
    .select({ session: sessions })
    .from(reviewSessions)
    .innerJoin(sessions, eq(sessions.id, reviewSessions.sessionId))
    .where(eq(reviewSessions.reviewId, reviewId))
    .orderBy(asc(sessions.occurredAt), asc(sessions.createdAt))
    .all()
    .map((row) => row.session);
}

export function countReviews() {
  const row = getDb().select({ value: count() }).from(reviews).get();
  return row?.value ?? 0;
}

export function insertContextPack(input: {
  title: string;
  currentQuestion: string;
  sourceReviewId: string;
  model: string;
  promptVersion: string;
  payload: StoredContextPackPayload;
  markdown: string;
  sessionIds: string[];
}): ContextPackRecord {
  const now = new Date().toISOString();
  const record: ContextPackRecord = {
    id: crypto.randomUUID(),
    title: input.title,
    theme: "",
    currentQuestion: input.currentQuestion,
    sourceReviewId: input.sourceReviewId,
    markdown: input.markdown,
    payload: JSON.stringify(input.payload),
    model: input.model,
    promptVersion: input.promptVersion,
    createdAt: now,
    updatedAt: now,
  };

  getDb().transaction((tx) => {
    tx.insert(contextPacks).values(record).run();
    if (input.sessionIds.length > 0) {
      tx.insert(contextPackSessions)
        .values(
          input.sessionIds.map((sessionId) => ({
            contextPackId: record.id,
            sessionId,
          })),
        )
        .run();
    }
  });

  return record;
}

export function listContextPacks() {
  return getDb()
    .select()
    .from(contextPacks)
    .orderBy(desc(contextPacks.createdAt))
    .all();
}

export type ContextPackListItem = ContextPackRecord & {
  sessionCount: number;
  sourceReviewTitle: string | null;
};

export function listContextPacksWithSessionCount(): ContextPackListItem[] {
  const all = listContextPacks();
  const counts = getDb()
    .select({
      contextPackId: contextPackSessions.contextPackId,
      sessionCount: count(),
    })
    .from(contextPackSessions)
    .groupBy(contextPackSessions.contextPackId)
    .all();
  const countById = new Map(
    counts.map((row) => [row.contextPackId, Number(row.sessionCount)]),
  );
  const reviewTitles = new Map(
    listReviews().map((review) => [review.id, review.title]),
  );
  return all.map((pack) => ({
    ...pack,
    sessionCount: countById.get(pack.id) ?? 0,
    sourceReviewTitle: pack.sourceReviewId
      ? (reviewTitles.get(pack.sourceReviewId) ?? null)
      : null,
  }));
}

export function getContextPackById(id: string) {
  return (
    getDb().select().from(contextPacks).where(eq(contextPacks.id, id)).get() ??
    null
  );
}

export function listSessionsByContextPackId(contextPackId: string) {
  return getDb()
    .select({ session: sessions })
    .from(contextPackSessions)
    .innerJoin(sessions, eq(sessions.id, contextPackSessions.sessionId))
    .where(eq(contextPackSessions.contextPackId, contextPackId))
    .orderBy(asc(sessions.occurredAt), asc(sessions.createdAt))
    .all()
    .map((row) => row.session);
}

export function countContextPacks() {
  const row = getDb().select({ value: count() }).from(contextPacks).get();
  return row?.value ?? 0;
}
