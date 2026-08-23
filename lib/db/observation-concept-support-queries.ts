import { and, eq, inArray } from "drizzle-orm";
import type { ConceptQueryDb } from "./concept-queries";
import {
  conceptOccurrences,
  observationConceptEvidenceSupports,
  observationSessions,
  observations,
} from "./schema";
import {
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
  type ObservationConceptEvidenceSupport,
  type ObservationConceptRelationPair,
  toObservationConceptRelationPairs,
} from "@/lib/observations/concept-evidence-supports";

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
          OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
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
      ? listObservationConceptEvidenceSupportsForSessions(sessionIds, db)
      : db
          .select()
          .from(observationConceptEvidenceSupports)
          .where(
            eq(
              observationConceptEvidenceSupports.relationVersion,
              OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
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
      relationVersion: OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
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
