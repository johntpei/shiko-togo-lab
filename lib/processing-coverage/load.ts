import { eq } from "drizzle-orm";
import {
  CONCEPT_APPLY_DEFAULT_CANDIDATES,
  hashSourceArtifactText,
} from "@/lib/concepts/admission/apply-manifest";
import { CONCEPT_INCREMENTAL_PROCESSING_VERSION } from "@/lib/concepts/incremental/checkpoint";
import {
  loadInitialConceptProcessingCoverage,
  type InitialConceptProcessingCoverageLoad,
} from "@/lib/concepts/incremental/eligibility";
import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import { listObservationConceptRelations } from "@/lib/db/observation-concept-support-queries";
import {
  conceptOccurrences,
  conceptProcessingCheckpoints,
  evidences,
  observationConceptEvidenceSupports,
  observationSessions,
  observations,
  reviewSessions,
  reviews,
  sessionAnalyses,
  sessions,
} from "@/lib/db/schema";
import { extractObservationEvidenceAnchors } from "@/lib/thought-map/provenance-join-audit";
import { buildDualPipelineProcessingCoverageAudit } from "./audit";
import type { DualPipelineProcessingCoverageAudit } from "./types";

export const DEFAULT_INITIAL_CONCEPT_COVERAGE_PATH =
  CONCEPT_APPLY_DEFAULT_CANDIDATES;

export type DualPipelineProcessingCoverageLoad =
  DualPipelineProcessingCoverageAudit & {
    initialCoverageStatus:
      | { ok: true; sourceHash: string }
      | { ok: false; code: string; detail: string };
  };

function completeExactEvidenceAnchorCount(
  payload: string,
  observationId: string,
  kind: string,
) {
  return extractObservationEvidenceAnchors({
    observationId,
    kind,
    payload,
  }).filter(
    (anchor) =>
      Boolean(anchor.sessionId) &&
      Boolean(anchor.messageId) &&
      Boolean(anchor.evidenceRef),
  ).length;
}

export function loadDualPipelineProcessingCoverageAudit(input: {
  db: ConceptQueryDb;
  initialCoverage: InitialConceptProcessingCoverageLoad;
}): DualPipelineProcessingCoverageLoad {
  const sessionRows = input.db
    .select({
      sessionId: sessions.id,
      occurredAt: sessions.occurredAt,
    })
    .from(sessions)
    .all();
  const reviewRows = input.db
    .select({ reviewId: reviews.id })
    .from(reviews)
    .all();
  const reviewSessionRows = input.db
    .select({
      reviewId: reviewSessions.reviewId,
      sessionId: reviewSessions.sessionId,
    })
    .from(reviewSessions)
    .all();
  const reviewsWithScope = new Set(
    reviewSessionRows.map((row) => row.reviewId),
  );
  const checkpointRows = input.db
    .select({ sessionId: conceptProcessingCheckpoints.sessionId })
    .from(conceptProcessingCheckpoints)
    .where(
      eq(
        conceptProcessingCheckpoints.processingVersion,
        CONCEPT_INCREMENTAL_PROCESSING_VERSION,
      ),
    )
    .all();
  const occurrenceRows = input.db
    .select({ sessionId: conceptOccurrences.sessionId })
    .from(conceptOccurrences)
    .all();
  const observationRows = input.db
    .select({
      observationId: observations.id,
      kind: observations.kind,
      payload: observations.payload,
    })
    .from(observations)
    .all();
  const observationSessionRows = input.db
    .select({
      observationId: observationSessions.observationId,
      sessionId: observationSessions.sessionId,
    })
    .from(observationSessions)
    .all();
  const evidenceRows = input.db
    .select({ sessionId: evidences.sessionId })
    .from(evidences)
    .all();
  const analysisRows = input.db
    .select({ sessionId: sessionAnalyses.sessionId })
    .from(sessionAnalyses)
    .all();
  const supportRows = input.db
    .select({
      observationId: observationConceptEvidenceSupports.observationId,
      conceptId: observationConceptEvidenceSupports.conceptId,
    })
    .from(observationConceptEvidenceSupports)
    .all();
  const relations = listObservationConceptRelations(input.db);

  const audit = buildDualPipelineProcessingCoverageAudit({
    sessions: sessionRows,
    initialConceptCoveredSessionIds: input.initialCoverage.ok
      ? input.initialCoverage.coverage.sessionIds
      : [],
    incrementalCheckpointSessionIds: checkpointRows.map((row) => row.sessionId),
    conceptOccurrenceSessionIds: occurrenceRows.map((row) => row.sessionId),
    reviews: reviewRows,
    reviewInputSessionIds: reviewSessionRows.map((row) => row.sessionId),
    reviewsWithoutExplicitSessionScope: reviewRows.filter(
      (row) => !reviewsWithScope.has(row.reviewId),
    ).length,
    evidenceSessionIds: evidenceRows.map((row) => row.sessionId),
    observationSessionLinks: observationSessionRows,
    observations: observationRows.map((row) => ({
      observationId: row.observationId,
      completeExactEvidenceAnchorCount: completeExactEvidenceAnchorCount(
        row.payload,
        row.observationId,
        row.kind,
      ),
    })),
    supportRows,
    sessionAnalysisSessionIds: analysisRows.map((row) => row.sessionId),
  });

  return {
    ...audit,
    uniqueExactRelationCount: relations.length,
    initialCoverageStatus: input.initialCoverage.ok
      ? { ok: true, sourceHash: input.initialCoverage.coverage.sourceHash }
      : {
          ok: false,
          code: input.initialCoverage.code,
          detail: input.initialCoverage.detail,
        },
  };
}

export function loadInitialConceptCoverageFromCandidateText(
  candidateReportText: string,
): InitialConceptProcessingCoverageLoad {
  return loadInitialConceptProcessingCoverage({
    candidateReportText,
    expectedSourceHash: hashSourceArtifactText(candidateReportText),
  });
}
