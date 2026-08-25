import { inArray } from "drizzle-orm";
import type { ReviewSessionSource } from "@/lib/ai/review-input";
import { buildCanonicalReviewEvidenceInput } from "@/lib/ai/review-evidence-transport";
import type { InitialConceptProcessingCoverageLoad } from "@/lib/concepts/incremental/eligibility";
import {
  processIncrementalConceptSession,
  type IncrementalConceptSessionProcessorResult,
  type ProcessIncrementalConceptSessionDeps,
} from "@/lib/concepts/incremental/session-processor";
import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import { sessions } from "@/lib/db/schema";
import type { IntegratedReviewProcessingResult } from "@/lib/reviews/integrated-review-processor";
import {
  processIntegratedReviewSelection,
  resumeIntegratedReviewProjection,
} from "@/lib/reviews/integrated-review-processor";
import { classifyExactReviewSelectionState } from "@/lib/reviews/review-selection-state";
import { loadCanonicalReviewSessionSources } from "@/lib/reviews/review-session-sources";
import {
  DUAL_PIPELINE_ORCHESTRATOR_EXECUTION_VERSION,
  type DualPipelineConceptSessionResult,
  type DualPipelineExecutionStatus,
  type DualPipelineOrchestratorExecutionResult,
  type DualPipelineReviewExecutionResult,
  sanitizeDualPipelineReviewFailureToken,
} from "./execution-types";
import {
  loadDualPipelineOrchestratorPlan,
  type DualPipelineOrchestratorPlanLoad,
} from "./load";
import { resolveReviewStageAction, uniqueSortedSessionIds } from "./plan";
import {
  DUAL_PIPELINE_ORCHESTRATOR_PLAN_VERSION,
  type ReviewStageAction,
} from "./types";

const DEFAULT_REVIEW_TITLE = "dual-pipeline-integrated-review";
const SAFE_DIAGNOSTIC_TOKEN = /^[a-z][A-Za-z0-9_]{0,127}$/;

export type ExecuteDualPipelineProcessingInput = {
  sessionIds: readonly string[];
};

export type ExecuteDualPipelineProcessingDeps = {
  db: ConceptQueryDb;
  initialCoverage: InitialConceptProcessingCoverageLoad;
  loadPlan?: typeof loadDualPipelineOrchestratorPlan;
  processConceptSession?: typeof processIncrementalConceptSession;
  loadReviewSelectionState?: typeof classifyExactReviewSelectionState;
  processReviewSelection?: typeof processIntegratedReviewSelection;
  resumeReviewProjection?: typeof resumeIntegratedReviewProjection;
  loadReviewSessionSources?: (
    sessionIds: readonly string[],
    db: ConceptQueryDb,
  ) => ReviewSessionSource[];
  reviewTitle?: string;
  onAfterConceptStage?: (input: {
    db: ConceptQueryDb;
    validSessionIds: string[];
    initialPlan: DualPipelineOrchestratorPlanLoad;
  }) => void | Promise<void>;
  onBeforeConceptSession?: (input: {
    sessionId: string;
    db: ConceptQueryDb;
  }) => void | Promise<void>;
  conceptDeps?: Partial<
    Omit<ProcessIncrementalConceptSessionDeps, "db" | "coverage">
  >;
};

function emptyReviewResult(
  action: ReviewStageAction,
  overrides: Partial<DualPipelineReviewExecutionResult> = {},
): DualPipelineReviewExecutionResult {
  return {
    action,
    resolvedAction: action,
    blockingReason: overrides.blockingReason ?? null,
    reviewId: null,
    processorStatus: null,
    processorReason: null,
    processorCode: null,
    executionMode: null,
    llmCalls: 0,
    projectionStatus: null,
    observationCount: 0,
    failureDiagnostic: null,
    ...overrides,
  };
}

function summarizeConceptProcessor(
  result: IncrementalConceptSessionProcessorResult,
): Pick<
  DualPipelineConceptSessionResult,
  | "processorStatus"
  | "processorReason"
  | "executionMode"
  | "extractionCalls"
  | "assessmentCalls"
  | "failureDiagnostic"
> {
  const failed = result.status === "blocked" || result.status === "failed";
  const failureStage = failed
    ? sanitizeDiagnosticToken(result.stageOrder.at(-1) ?? null)
    : null;

  return {
    processorStatus: result.status,
    processorReason: result.reason,
    executionMode: result.executionMode,
    extractionCalls: result.extractionCalls,
    assessmentCalls: result.assessmentCalls,
    failureDiagnostic: failed
      ? {
          failureStage,
          failureReason: sanitizeDiagnosticToken(result.reason),
          failureCode: failureCodeForStage(result, failureStage),
          extractionCalls: result.extractionCalls,
          assessmentCalls: result.assessmentCalls,
        }
      : null,
  };
}

function sanitizeDiagnosticToken(value: string | null): string | null {
  return value && SAFE_DIAGNOSTIC_TOKEN.test(value) ? value : null;
}

function failureCodeForStage(
  result: IncrementalConceptSessionProcessorResult,
  failureStage: string | null,
): string | null {
  if (failureStage === "existing_primary") {
    return sanitizeDiagnosticToken(result.existingPrimary.code);
  }
  if (failureStage === "new_primary") {
    return sanitizeDiagnosticToken(result.newPrimary.code);
  }
  if (failureStage === "checkpoint") {
    return sanitizeDiagnosticToken(result.checkpoint.code);
  }
  if (failureStage === "planning") {
    return sanitizeDiagnosticToken(result.planning.failureCode);
  }
  return null;
}

function summarizeReviewFailure(
  result: IntegratedReviewProcessingResult,
): DualPipelineReviewExecutionResult["failureDiagnostic"] {
  if (result.status === "completed") {
    return null;
  }
  return {
    status: result.status,
    executionMode: result.executionMode,
    failureReason: sanitizeDualPipelineReviewFailureToken(result.reason),
    failureCode: sanitizeDualPipelineReviewFailureToken(result.code),
    llmCalls: result.llmCalls,
  };
}

function isConceptSuccess(result: DualPipelineConceptSessionResult) {
  if (result.action === "not_needed") {
    return result.planState === "covered";
  }
  return (
    result.processorStatus === "completed" ||
    result.processorStatus === "already_covered"
  );
}

function isConceptFailure(result: DualPipelineConceptSessionResult) {
  return (
    result.action === "executed" &&
    result.processorStatus !== null &&
    result.processorStatus !== "completed" &&
    result.processorStatus !== "already_covered"
  );
}

function isReviewSuccess(review: DualPipelineReviewExecutionResult) {
  if (
    review.resolvedAction === "not_needed" ||
    review.resolvedAction === "no_selection" ||
    review.resolvedAction === "no_valid_session"
  ) {
    return true;
  }
  if (review.resolvedAction === "blocked") {
    return false;
  }
  return review.processorStatus === "completed";
}

function isReviewFailure(review: DualPipelineReviewExecutionResult) {
  if (review.resolvedAction === "blocked") {
    return true;
  }
  if (
    review.resolvedAction === "run_for_selection" ||
    review.resolvedAction === "resume_projection"
  ) {
    return (
      review.processorStatus !== null && review.processorStatus !== "completed"
    );
  }
  return false;
}

function computeOverallStatus(input: {
  blockedBeforePrimary: boolean;
  conceptSessions: DualPipelineConceptSessionResult[];
  review: DualPipelineReviewExecutionResult;
}): DualPipelineExecutionStatus {
  if (input.blockedBeforePrimary) {
    return "blocked";
  }
  const conceptFailures = input.conceptSessions.filter(isConceptFailure);
  const conceptSuccesses = input.conceptSessions.filter(isConceptSuccess);
  const reviewFailed = isReviewFailure(input.review);
  const reviewSucceeded = isReviewSuccess(input.review);

  if (conceptFailures.length === 0 && reviewSucceeded && !reviewFailed) {
    return "completed";
  }
  if (conceptSuccesses.length > 0 || reviewSucceeded) {
    return "partial";
  }
  if (conceptFailures.length > 0 || reviewFailed) {
    return "partial";
  }
  return "completed";
}

function blockedResult(input: {
  reason: string;
  sessionIds: string[];
  validSessionIds?: string[];
  invalidSessionIds?: string[];
  initialPlan?: DualPipelineOrchestratorPlanLoad;
}): DualPipelineOrchestratorExecutionResult {
  const validSessionIds = input.validSessionIds ?? [];
  const invalidSessionIds = input.invalidSessionIds ?? [];
  const initialReviewAction =
    input.initialPlan?.review.action ??
    (input.reason === "no_selection" ? "no_selection" : "blocked");

  return {
    version: DUAL_PIPELINE_ORCHESTRATOR_EXECUTION_VERSION,
    status: "blocked",
    reason: input.reason,
    planVersion: DUAL_PIPELINE_ORCHESTRATOR_PLAN_VERSION,
    operationalOrder: "concept_then_review",
    semanticDependency: "none",
    selection: {
      sessionIds: input.sessionIds,
      validSessionIds,
      invalidSessionIds,
    },
    concept: { sessions: [] },
    review: emptyReviewResult(initialReviewAction, {
      blockingReason: input.reason,
    }),
    summary: {
      conceptExecutedCount: 0,
      conceptCompletedCount: 0,
      conceptFailedCount: 0,
      conceptExtractionCalls: 0,
      conceptAssessmentCalls: 0,
      reviewLlmCalls: 0,
    },
  };
}

export async function executeDualPipelineProcessing(
  input: ExecuteDualPipelineProcessingInput,
  deps: ExecuteDualPipelineProcessingDeps,
): Promise<DualPipelineOrchestratorExecutionResult> {
  const sessionIds = uniqueSortedSessionIds(input.sessionIds);
  const loadPlan = deps.loadPlan ?? loadDualPipelineOrchestratorPlan;
  const processConceptSession =
    deps.processConceptSession ?? processIncrementalConceptSession;
  const loadReviewSelectionState =
    deps.loadReviewSelectionState ?? classifyExactReviewSelectionState;
  const processReviewSelection =
    deps.processReviewSelection ?? processIntegratedReviewSelection;
  const resumeReviewProjection =
    deps.resumeReviewProjection ?? resumeIntegratedReviewProjection;
  const loadReviewSessionSources =
    deps.loadReviewSessionSources ?? loadCanonicalReviewSessionSources;
  const reviewTitle = deps.reviewTitle ?? DEFAULT_REVIEW_TITLE;

  if (sessionIds.length === 0) {
    return blockedResult({ reason: "no_selection", sessionIds });
  }

  const initialPlan = loadPlan({
    db: deps.db,
    sessionIds,
    initialCoverage: deps.initialCoverage,
  });

  if (initialPlan.selection.invalidSessionIds.length > 0) {
    return blockedResult({
      reason: "invalid_session_selection",
      sessionIds,
      validSessionIds: initialPlan.selection.validSessionIds,
      invalidSessionIds: initialPlan.selection.invalidSessionIds,
      initialPlan,
    });
  }

  const validSessionIds = initialPlan.selection.validSessionIds;
  const needsProcessingSet = new Set(
    initialPlan.concept.needsProcessingSessionIds,
  );
  const planRowById = new Map(
    initialPlan.concept.sessions.map((row) => [row.sessionId, row]),
  );

  const conceptSessions: DualPipelineConceptSessionResult[] = [];
  let conceptExtractionCalls = 0;
  let conceptAssessmentCalls = 0;
  let conceptExecutedCount = 0;

  for (const sessionId of validSessionIds) {
    const planRow = planRowById.get(sessionId);
    if (!planRow || !needsProcessingSet.has(sessionId)) {
      conceptSessions.push({
        sessionId,
        action: "not_needed",
        planState: planRow?.state ?? "blocked",
        planReason: planRow?.reason ?? "not_scheduled",
        processorStatus: null,
        processorReason: null,
        executionMode: null,
        extractionCalls: 0,
        assessmentCalls: 0,
        failureDiagnostic: null,
      });
      continue;
    }

    conceptExecutedCount += 1;
    if (deps.onBeforeConceptSession) {
      await deps.onBeforeConceptSession({ sessionId, db: deps.db });
    }
    const processorResult = await processConceptSession(
      { sessionId, coverage: deps.initialCoverage },
      {
        db: deps.db,
        ...deps.conceptDeps,
        extractCandidates:
          deps.conceptDeps?.extractCandidates ??
          (() => {
            throw new Error("extractCandidates is required for concept execution");
          }),
        generateStructured:
          deps.conceptDeps?.generateStructured ??
          (() => {
            throw new Error(
              "generateStructured is required for concept execution",
            );
          }),
      },
    );
    conceptExtractionCalls += processorResult.extractionCalls;
    conceptAssessmentCalls += processorResult.assessmentCalls;
    conceptSessions.push({
      sessionId,
      action: "executed",
      planState: planRow.state,
      planReason: planRow.reason,
      ...summarizeConceptProcessor(processorResult),
    });
  }

  if (deps.onAfterConceptStage) {
    await deps.onAfterConceptStage({
      db: deps.db,
      validSessionIds,
      initialPlan,
    });
  }

  const freshReviewState = loadReviewSelectionState(deps.db, validSessionIds);
  const freshReviewSources = loadReviewSessionSources(validSessionIds, deps.db);
  const freshReviewPreflight =
    validSessionIds.length >= 2
      ? buildCanonicalReviewEvidenceInput(freshReviewSources).preflight
      : null;
  const resolvedReview = resolveReviewStageAction({
    requestedSessionIds: sessionIds,
    validSessionIds,
    reviewSelectionState: freshReviewState,
    reviewInputPreflight: freshReviewPreflight,
  });

  const initialReviewAction = initialPlan.review.action;
  let reviewResult = emptyReviewResult(initialReviewAction, {
    resolvedAction: resolvedReview.action,
    blockingReason: resolvedReview.blockingReason,
  });

  if (resolvedReview.action === "not_needed") {
    reviewResult = emptyReviewResult(initialReviewAction, {
      resolvedAction: resolvedReview.action,
      blockingReason: null,
      reviewId: resolvedReview.exactCompletedReviewIds[0] ?? null,
    });
  } else if (resolvedReview.action === "blocked") {
    reviewResult = emptyReviewResult(initialReviewAction, {
      resolvedAction: resolvedReview.action,
      blockingReason: resolvedReview.blockingReason,
    });
  } else if (resolvedReview.action === "run_for_selection") {
    const processorResult: IntegratedReviewProcessingResult =
      await processReviewSelection(freshReviewSources, reviewTitle, { db: deps.db });
    reviewResult = {
      action: initialReviewAction,
      resolvedAction: resolvedReview.action,
      blockingReason: null,
      reviewId: processorResult.reviewId,
      processorStatus: processorResult.status,
      processorReason: processorResult.reason,
      processorCode: processorResult.code,
      executionMode: processorResult.executionMode,
      llmCalls: processorResult.llmCalls,
      projectionStatus: processorResult.projection.status,
      observationCount: processorResult.projection.observationCount,
      failureDiagnostic: summarizeReviewFailure(processorResult),
    };
  } else if (resolvedReview.action === "resume_projection") {
    const reviewId = resolvedReview.resumeReviewId;
    if (!reviewId) {
      reviewResult = emptyReviewResult(initialReviewAction, {
        resolvedAction: resolvedReview.action,
        blockingReason: "missing_pending_review_id",
      });
    } else {
      const processorResult = await resumeReviewProjection(
        { reviewId },
        { db: deps.db },
      );
      reviewResult = {
        action: initialReviewAction,
        resolvedAction: resolvedReview.action,
        blockingReason: null,
        reviewId: processorResult.reviewId,
        processorStatus: processorResult.status,
        processorReason: processorResult.reason,
        processorCode: processorResult.code,
        executionMode: processorResult.executionMode,
        llmCalls: processorResult.llmCalls,
        projectionStatus: processorResult.projection.status,
        observationCount: processorResult.projection.observationCount,
        failureDiagnostic: summarizeReviewFailure(processorResult),
      };
    }
  } else {
    reviewResult = emptyReviewResult(initialReviewAction, {
      resolvedAction: resolvedReview.action,
      blockingReason: resolvedReview.blockingReason,
    });
  }

  const conceptCompletedCount = conceptSessions.filter(isConceptSuccess).length;
  const conceptFailedCount = conceptSessions.filter(isConceptFailure).length;
  const status = computeOverallStatus({
    blockedBeforePrimary: false,
    conceptSessions,
    review: reviewResult,
  });

  return {
    version: DUAL_PIPELINE_ORCHESTRATOR_EXECUTION_VERSION,
    status,
    reason: status === "blocked" ? reviewResult.blockingReason : null,
    planVersion: DUAL_PIPELINE_ORCHESTRATOR_PLAN_VERSION,
    operationalOrder: "concept_then_review",
    semanticDependency: "none",
    selection: {
      sessionIds,
      validSessionIds,
      invalidSessionIds: [],
    },
    concept: { sessions: conceptSessions },
    review: reviewResult,
    summary: {
      conceptExecutedCount,
      conceptCompletedCount,
      conceptFailedCount,
      conceptExtractionCalls,
      conceptAssessmentCalls,
      reviewLlmCalls: reviewResult.llmCalls,
    },
  };
}

export function listExistingSessionIds(
  db: ConceptQueryDb,
  sessionIds: readonly string[],
): string[] {
  const normalized = uniqueSortedSessionIds(sessionIds);
  if (normalized.length === 0) {
    return [];
  }
  return db
    .select({ sessionId: sessions.id })
    .from(sessions)
    .where(inArray(sessions.id, normalized))
    .all()
    .map((row) => row.sessionId);
}
