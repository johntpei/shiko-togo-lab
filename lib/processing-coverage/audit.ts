import {
  DUAL_PIPELINE_PROCESSING_COVERAGE_AUDIT_VERSION,
  DUAL_PIPELINE_PRODUCTION_AUTOMATION,
  REVIEW_COVERAGE_SEMANTICS,
  type DualPipelineProcessingCoverageAudit,
  type DualPipelineProcessingCoverageAuditInput,
} from "./types";

function uniqueSorted(ids: readonly string[]) {
  return [...new Set(ids.filter((id) => id.trim() !== ""))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function maxOccurredAt(
  sessions: DualPipelineProcessingCoverageAuditInput["sessions"],
  ids: ReadonlySet<string>,
) {
  let latest: string | null = null;
  for (const session of sessions) {
    if (!ids.has(session.sessionId)) {
      continue;
    }
    if (latest === null || session.occurredAt.localeCompare(latest) > 0) {
      latest = session.occurredAt;
    }
  }
  return latest;
}

/**
 * Pure dual-pipeline processing coverage diagnostic.
 * Concept coverage = Initial artifact ∪ Incremental checkpoints.
 * Review coverage = review_sessions input scope only.
 * Occurrence / ObservationSession / Evidence / supports never become coverage.
 */
export function buildDualPipelineProcessingCoverageAudit(
  input: DualPipelineProcessingCoverageAuditInput,
): DualPipelineProcessingCoverageAudit {
  const sessions = [...input.sessions].sort((left, right) =>
    left.sessionId.localeCompare(right.sessionId),
  );
  const sessionIds = uniqueSorted(sessions.map((session) => session.sessionId));
  const sessionSet = new Set(sessionIds);

  const initialConcept = uniqueSorted(
    input.initialConceptCoveredSessionIds.filter((id) => sessionSet.has(id)),
  );
  const incremental = uniqueSorted(
    input.incrementalCheckpointSessionIds.filter((id) => sessionSet.has(id)),
  );
  const conceptCovered = uniqueSorted([...initialConcept, ...incremental]);
  const conceptCoveredSet = new Set(conceptCovered);
  const conceptUncoveredSessionIds = sessionIds.filter(
    (id) => !conceptCoveredSet.has(id),
  );

  const reviewInput = uniqueSorted(
    input.reviewInputSessionIds.filter((id) => sessionSet.has(id)),
  );
  const reviewCoveredSet = new Set(reviewInput);
  const reviewUncoveredSessionIds = sessionIds.filter(
    (id) => !reviewCoveredSet.has(id),
  );

  const dual = sessionIds.filter(
    (id) => conceptCoveredSet.has(id) && reviewCoveredSet.has(id),
  );
  const conceptOnly = sessionIds.filter(
    (id) => conceptCoveredSet.has(id) && !reviewCoveredSet.has(id),
  );
  const reviewOnly = sessionIds.filter(
    (id) => !conceptCoveredSet.has(id) && reviewCoveredSet.has(id),
  );
  const neither = sessionIds.filter(
    (id) => !conceptCoveredSet.has(id) && !reviewCoveredSet.has(id),
  );

  const completeAnchorCount = input.observations.reduce(
    (sum, observation) => sum + Math.max(0, observation.completeExactEvidenceAnchorCount),
    0,
  );
  const observationsWithComplete = input.observations.filter(
    (observation) => observation.completeExactEvidenceAnchorCount >= 1,
  ).length;

  const uniqueRelations = new Set(
    input.supportRows.map(
      (row) => `${row.observationId}\0${row.conceptId}`,
    ),
  );

  return {
    version: DUAL_PIPELINE_PROCESSING_COVERAGE_AUDIT_VERSION,
    reviewCoverageSemantics: REVIEW_COVERAGE_SEMANTICS,
    productionAutomation: DUAL_PIPELINE_PRODUCTION_AUTOMATION,
    totalSessions: sessionIds.length,
    initialConceptCoveredSessions: initialConcept.length,
    incrementalCheckpointCoveredSessions: incremental.length,
    conceptCoveredUnion: conceptCovered.length,
    conceptUncovered: conceptUncoveredSessionIds.length,
    reviewCount: input.reviews.length,
    reviewsWithoutExplicitSessionScope: input.reviewsWithoutExplicitSessionScope,
    explicitReviewCoveredSessions: reviewInput.length,
    reviewUncoveredSessions: reviewUncoveredSessionIds.length,
    reviewUnknownSessions: 0,
    observationCount: input.observations.length,
    observationSessionLinkCount: input.observationSessionLinks.length,
    observationsWithCompleteExactEvidenceAnchor: observationsWithComplete,
    observationsWithoutCompleteExactEvidenceAnchor:
      input.observations.length - observationsWithComplete,
    completeEvidenceAnchorCount: completeAnchorCount,
    supportRowCount: input.supportRows.length,
    uniqueExactRelationCount: uniqueRelations.size,
    provableDualCovered: dual.length,
    conceptOnly: conceptOnly.length,
    reviewOnly: reviewOnly.length,
    neither: neither.length,
    evidenceLinkedSessions: uniqueSorted(
      input.evidenceSessionIds.filter((id) => sessionSet.has(id)),
    ).length,
    observationLinkedSessions: uniqueSorted(
      input.observationSessionLinks
        .map((link) => link.sessionId)
        .filter((id) => sessionSet.has(id)),
    ).length,
    sessionAnalysisSessions: uniqueSorted(
      input.sessionAnalysisSessionIds.filter((id) => sessionSet.has(id)),
    ).length,
    conceptOccurrenceSessions: uniqueSorted(
      input.conceptOccurrenceSessionIds.filter((id) => sessionSet.has(id)),
    ).length,
    latestSessionOccurredAt: maxOccurredAt(sessions, sessionSet),
    latestConceptCoveredOccurredAt: maxOccurredAt(sessions, conceptCoveredSet),
    latestReviewCoveredOccurredAt: maxOccurredAt(sessions, reviewCoveredSet),
    conceptUncoveredSessionIds,
    reviewUncoveredSessionIds,
    notes: {
      evidenceLinkedIsNotReviewProcessed: true,
      observationLinkedIsNotReviewProcessed: true,
      conceptOccurrenceIsNotConceptCoverage: true,
      sessionAnalysisIsNotReviewCoverage: true,
      zeroObservationReviewCanBeValid: true,
    },
  };
}

export function formatDualPipelineProcessingCoverageAudit(
  audit: DualPipelineProcessingCoverageAudit,
) {
  return [
    `version: ${audit.version}`,
    `classification: ${audit.productionAutomation.classification}`,
    `recommendedNextStep: ${audit.productionAutomation.recommendedNextStep}`,
    `reviewCoverageSemantics: ${audit.reviewCoverageSemantics}`,
    `totalSessions: ${audit.totalSessions}`,
    `initialConceptCoveredSessions: ${audit.initialConceptCoveredSessions}`,
    `incrementalCheckpointCoveredSessions: ${audit.incrementalCheckpointCoveredSessions}`,
    `conceptCoveredUnion: ${audit.conceptCoveredUnion}`,
    `conceptUncovered: ${audit.conceptUncovered}`,
    `reviewCount: ${audit.reviewCount}`,
    `explicitReviewCoveredSessions: ${audit.explicitReviewCoveredSessions}`,
    `reviewUncoveredSessions: ${audit.reviewUncoveredSessions}`,
    `reviewUnknownSessions: ${audit.reviewUnknownSessions}`,
    `observationCount: ${audit.observationCount}`,
    `observationSessionLinkCount: ${audit.observationSessionLinkCount}`,
    `observationsWithCompleteExactEvidenceAnchor: ${audit.observationsWithCompleteExactEvidenceAnchor}`,
    `observationsWithoutCompleteExactEvidenceAnchor: ${audit.observationsWithoutCompleteExactEvidenceAnchor}`,
    `completeEvidenceAnchorCount: ${audit.completeEvidenceAnchorCount}`,
    `supportRowCount: ${audit.supportRowCount}`,
    `uniqueExactRelationCount: ${audit.uniqueExactRelationCount}`,
    `provableDualCovered: ${audit.provableDualCovered}`,
    `conceptOnly: ${audit.conceptOnly}`,
    `reviewOnly: ${audit.reviewOnly}`,
    `neither: ${audit.neither}`,
    `evidenceLinkedSessions: ${audit.evidenceLinkedSessions} (not review processed)`,
    `observationLinkedSessions: ${audit.observationLinkedSessions} (not review processed)`,
    `sessionAnalysisSessions: ${audit.sessionAnalysisSessions} (not review coverage)`,
    `latestSessionOccurredAt: ${audit.latestSessionOccurredAt ?? "none"}`,
    `latestConceptCoveredOccurredAt: ${audit.latestConceptCoveredOccurredAt ?? "none"}`,
    `latestReviewCoveredOccurredAt: ${audit.latestReviewCoveredOccurredAt ?? "none"}`,
    `sessionImportTriggersConcept: ${audit.productionAutomation.sessionImportTriggersConcept}`,
    `sessionImportTriggersReview: ${audit.productionAutomation.sessionImportTriggersReview}`,
    `incrementalNewDedicatedCli: ${audit.productionAutomation.incrementalNewDedicatedCli}`,
  ].join("\n");
}
