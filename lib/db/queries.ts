import { and, asc, count, desc, eq, gte, lte } from "drizzle-orm";
import type { SessionSource } from "@/lib/sessions/constants";
import {
  assertMessageAnchors,
  parseTranscript,
  type ParsedMessage,
} from "@/lib/ingest/parse-transcript";
import { getDb } from "./client";
import type { StoredAnalysisPayload } from "@/lib/ai/schemas";
import {
  evidences,
  messages,
  sessionAnalyses,
  sessions,
  type MessageRecord,
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
