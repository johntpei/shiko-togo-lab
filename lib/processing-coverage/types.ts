export const DUAL_PIPELINE_PROCESSING_COVERAGE_AUDIT_VERSION =
  "dual-pipeline-processing-coverage-audit-v0";

export type DualPipelineProcessingCoverageAuditVersion =
  typeof DUAL_PIPELINE_PROCESSING_COVERAGE_AUDIT_VERSION;

export const REVIEW_COVERAGE_SEMANTICS = "explicit_durable" as const;

export type ReviewCoverageSemantics = typeof REVIEW_COVERAGE_SEMANTICS;

export const NATURAL_ACCUMULATION_CLASSIFICATION =
  "NATURAL_ACCUMULATION_NOT_WIRED" as const;

export type NaturalAccumulationClassification =
  typeof NATURAL_ACCUMULATION_CLASSIFICATION;

export const RECOMMENDED_NEXT_STEP = "candidate_b_processing_orchestrator" as const;

/**
 * Code-path facts. Not inferred from DB counts.
 * Session import does not start Concept, Review, or relation work.
 */
export const DUAL_PIPELINE_PRODUCTION_AUTOMATION = {
  sessionImportTriggersConcept: false,
  sessionImportTriggersReview: false,
  sessionImportTriggersRelation: false,
  conceptTrigger: "manual",
  reviewTrigger: "manual",
  initialAdmissionEntry: "cli_concept_admission_apply",
  incrementalExistingEntry: "cli_concept_incremental_existing_append",
  incrementalNewDedicatedCli: false,
  incrementalNewLibraryEntry:
    "applyIncrementalNewAdmissionManifestThenReconcile",
  reviewEntry: "createIntegratedReviewAction",
  relationHooksIfPrimaryRuns: true,
  sessionAnalysisIsReviewCoverage: false,
  classification: NATURAL_ACCUMULATION_CLASSIFICATION,
  recommendedNextStep: RECOMMENDED_NEXT_STEP,
} as const;

export type DualPipelineProductionAutomation =
  typeof DUAL_PIPELINE_PRODUCTION_AUTOMATION;

export type DualPipelineSessionRow = {
  sessionId: string;
  occurredAt: string;
};

export type DualPipelineObservationEvidenceRow = {
  observationId: string;
  completeExactEvidenceAnchorCount: number;
};

export type DualPipelineSupportRow = {
  observationId: string;
  conceptId: string;
};

export type DualPipelineProcessingCoverageAuditInput = {
  sessions: DualPipelineSessionRow[];
  initialConceptCoveredSessionIds: string[];
  incrementalCheckpointSessionIds: string[];
  conceptOccurrenceSessionIds: string[];
  reviews: Array<{ reviewId: string }>;
  reviewInputSessionIds: string[];
  reviewsWithoutExplicitSessionScope: number;
  evidenceSessionIds: string[];
  observationSessionLinks: Array<{
    observationId: string;
    sessionId: string;
  }>;
  observations: DualPipelineObservationEvidenceRow[];
  supportRows: DualPipelineSupportRow[];
  sessionAnalysisSessionIds: string[];
};

export type DualPipelineProcessingCoverageAudit = {
  version: DualPipelineProcessingCoverageAuditVersion;
  reviewCoverageSemantics: ReviewCoverageSemantics;
  productionAutomation: DualPipelineProductionAutomation;
  totalSessions: number;
  initialConceptCoveredSessions: number;
  incrementalCheckpointCoveredSessions: number;
  conceptCoveredUnion: number;
  conceptUncovered: number;
  reviewCount: number;
  reviewsWithoutExplicitSessionScope: number;
  explicitReviewCoveredSessions: number;
  reviewUncoveredSessions: number;
  reviewUnknownSessions: number;
  observationCount: number;
  observationSessionLinkCount: number;
  observationsWithCompleteExactEvidenceAnchor: number;
  observationsWithoutCompleteExactEvidenceAnchor: number;
  completeEvidenceAnchorCount: number;
  supportRowCount: number;
  uniqueExactRelationCount: number;
  provableDualCovered: number;
  conceptOnly: number;
  reviewOnly: number;
  neither: number;
  evidenceLinkedSessions: number;
  observationLinkedSessions: number;
  sessionAnalysisSessions: number;
  conceptOccurrenceSessions: number;
  latestSessionOccurredAt: string | null;
  latestConceptCoveredOccurredAt: string | null;
  latestReviewCoveredOccurredAt: string | null;
  conceptUncoveredSessionIds: string[];
  reviewUncoveredSessionIds: string[];
  notes: {
    evidenceLinkedIsNotReviewProcessed: true;
    observationLinkedIsNotReviewProcessed: true;
    conceptOccurrenceIsNotConceptCoverage: true;
    sessionAnalysisIsNotReviewCoverage: true;
    zeroObservationReviewCanBeValid: true;
  };
};
