import { and, asc, eq, inArray } from "drizzle-orm";
import type { ConceptQueryDb } from "./concept-queries";
import {
  conceptOccurrences,
  messages,
  observationConceptEvidenceSupports,
  observationSessions,
  observations,
  reviewSessions,
  sessions,
} from "./schema";
import {
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSIONS,
  type ObservationConceptEvidenceRelationVersion,
  type ObservationConceptEvidenceSupport,
  type ObservationConceptRelationPair,
  toObservationConceptRelationPairs,
} from "@/lib/observations/concept-evidence-supports";
import type { CanonicalEvidenceResolutionContext } from "@/lib/observations/canonical-evidence-identity";

type AppDb = ConceptQueryDb;
type AppTx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

/** Query executor: production db or a transaction handle. */
export type ObservationConceptSupportExecutor = AppDb | AppTx;

/** Injected store for reconciliation. Requires transaction. */
export type ObservationConceptSupportDb = AppDb;

function supportIdentity(row: {
  relationVersion: string;
  observationId: string;
  conceptId: string;
  sessionId: string;
  messageId: string;
  evidenceRef: string;
}) {
  return [
    row.relationVersion,
    row.observationId,
    row.conceptId,
    row.sessionId,
    row.messageId,
    row.evidenceRef,
  ].join("\0");
}

export function listObservationsForSessions(
  sessionIds: string[],
  db: ObservationConceptSupportExecutor,
) {
  if (sessionIds.length === 0) {
    return [];
  }
  const uniqueSessions = [...new Set(sessionIds)];
  const rows = db
    .select({
      observationId: observations.id,
      kind: observations.kind,
      payload: observations.payload,
      sourceReviewId: observations.sourceReviewId,
    })
    .from(observations)
    .innerJoin(
      observationSessions,
      eq(observationSessions.observationId, observations.id),
    )
    .where(inArray(observationSessions.sessionId, uniqueSessions))
    .all();
  const unique = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    unique.set(row.observationId, row);
  }
  return [...unique.values()];
}

export function loadCanonicalEvidenceResolutionContext(
  input: { reviewIds: string[]; sessionIds: string[] },
  db: ObservationConceptSupportExecutor,
): CanonicalEvidenceResolutionContext {
  const reviewIds = [...new Set(input.reviewIds.filter(Boolean))];
  const requestedSessionIds = [...new Set(input.sessionIds.filter(Boolean))];
  const reviewLinks =
    reviewIds.length === 0
      ? []
      : db
          .select({
            reviewId: reviewSessions.reviewId,
            sessionId: reviewSessions.sessionId,
          })
          .from(reviewSessions)
          .where(inArray(reviewSessions.reviewId, reviewIds))
          .all();
  const allSessionIds = [
    ...new Set([
      ...requestedSessionIds,
      ...reviewLinks.map((row) => row.sessionId),
    ]),
  ];
  if (allSessionIds.length === 0) {
    return {
      reviewSourcesByReviewId: new Map(),
      conceptSessionsById: new Map(),
    };
  }

  const sessionRows = db
    .select({
      id: sessions.id,
      title: sessions.title,
      occurredAt: sessions.occurredAt,
      source: sessions.source,
      category: sessions.category,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(inArray(sessions.id, allSessionIds))
    .all();
  const messageRows = db
    .select({
      id: messages.id,
      sessionId: messages.sessionId,
      index: messages.index,
      role: messages.role,
      content: messages.content,
      attachmentsJson: messages.attachmentsJson,
      sourceCreatedAt: messages.sourceCreatedAt,
    })
    .from(messages)
    .where(inArray(messages.sessionId, allSessionIds))
    .orderBy(asc(messages.index), asc(messages.id))
    .all();
  const messagesBySessionId = new Map<
    string,
    Array<(typeof messageRows)[number]>
  >();
  for (const message of messageRows) {
    const current = messagesBySessionId.get(message.sessionId) ?? [];
    current.push(message);
    messagesBySessionId.set(message.sessionId, current);
  }
  const sessionsById = new Map(sessionRows.map((row) => [row.id, row]));

  const reviewSourcesByReviewId: CanonicalEvidenceResolutionContext["reviewSourcesByReviewId"] =
    new Map();
  for (const link of reviewLinks) {
    const session = sessionsById.get(link.sessionId);
    if (!session) {
      continue;
    }
    const current = reviewSourcesByReviewId.get(link.reviewId) ?? [];
    current.push({
      session,
      messages: (messagesBySessionId.get(session.id) ?? []).map((message) => ({
        id: message.id,
        index: message.index,
        role: message.role,
        content: message.content,
        attachmentsJson: message.attachmentsJson,
      })),
      analysis: null,
    });
    reviewSourcesByReviewId.set(link.reviewId, current);
  }

  const conceptSessionsById: CanonicalEvidenceResolutionContext["conceptSessionsById"] =
    new Map();
  for (const sessionId of requestedSessionIds) {
    const session = sessionsById.get(sessionId);
    if (!session) {
      continue;
    }
    conceptSessionsById.set(sessionId, {
      sessionId,
      occurredAt: session.occurredAt,
      messages: (messagesBySessionId.get(sessionId) ?? []).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        sourceCreatedAt: message.sourceCreatedAt,
      })),
    });
  }

  return { reviewSourcesByReviewId, conceptSessionsById };
}

export function listConceptOccurrencesForSessions(
  sessionIds: string[],
  db: ObservationConceptSupportExecutor,
) {
  if (sessionIds.length === 0) {
    return [];
  }
  return db
    .select({
      conceptId: conceptOccurrences.conceptId,
      sessionId: conceptOccurrences.sessionId,
      messageId: conceptOccurrences.messageId,
      evidenceRef: conceptOccurrences.evidenceRef,
    })
    .from(conceptOccurrences)
    .where(inArray(conceptOccurrences.sessionId, [...new Set(sessionIds)]))
    .all();
}

export function listObservationConceptEvidenceSupportsForSessions(
  sessionIds: string[],
  db: ObservationConceptSupportExecutor,
  relationVersion: ObservationConceptEvidenceRelationVersion =
    OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
) {
  if (sessionIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(observationConceptEvidenceSupports)
    .where(
      and(
        eq(
          observationConceptEvidenceSupports.relationVersion,
          relationVersion,
        ),
        inArray(observationConceptEvidenceSupports.sessionId, [
          ...new Set(sessionIds),
        ]),
      ),
    )
    .all();
}

export function insertObservationConceptEvidenceSupports(
  rows: ObservationConceptEvidenceSupport[],
  createdAt: string,
  db: ObservationConceptSupportExecutor,
) {
  if (rows.length === 0) {
    return 0;
  }
  const result = db
    .insert(observationConceptEvidenceSupports)
    .values(
      rows.map((row) => ({
        observationId: row.observationId,
        conceptId: row.conceptId,
        sessionId: row.sessionId,
        messageId: row.messageId,
        evidenceRef: row.evidenceRef,
        relationVersion: row.relationVersion,
        createdAt,
      })),
    )
    .onConflictDoNothing()
    .run();
  return result.changes;
}

export function listObservationConceptRelations(
  db: ObservationConceptSupportExecutor,
  options?: { sessionIds?: string[] },
): ObservationConceptRelationPair[] {
  const sessionIds = options?.sessionIds;
  const rows =
    sessionIds && sessionIds.length > 0
      ? db
          .select()
          .from(observationConceptEvidenceSupports)
          .where(
            and(
              inArray(
                observationConceptEvidenceSupports.relationVersion,
                [...OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSIONS],
              ),
              inArray(observationConceptEvidenceSupports.sessionId, [
                ...new Set(sessionIds),
              ]),
            ),
          )
          .all()
      : db
          .select()
          .from(observationConceptEvidenceSupports)
          .where(
            inArray(
              observationConceptEvidenceSupports.relationVersion,
              [...OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSIONS],
            ),
          )
          .all();
  return toObservationConceptRelationPairs(
    rows.map((row) => ({
      observationId: row.observationId,
      conceptId: row.conceptId,
      sessionId: row.sessionId,
      messageId: row.messageId,
      evidenceRef: row.evidenceRef,
      relationKind: "exact_evidence_provenance",
      relationVersion: row.relationVersion as ObservationConceptEvidenceRelationVersion,
    })),
  );
}

export function observationConceptSupportIdentitySet(
  rows: Array<{
    relationVersion: string;
    observationId: string;
    conceptId: string;
    sessionId: string;
    messageId: string;
    evidenceRef: string;
  }>,
) {
  return new Set(rows.map(supportIdentity));
}
