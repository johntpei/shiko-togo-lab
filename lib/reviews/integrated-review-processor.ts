import type { AiProvider } from "@/lib/ai/provider";
import type { ReviewSessionSource } from "@/lib/ai/review-input";
import {
  runIntegratedReview,
  type IntegratedReviewResult,
  type IntegratedReviewSaveInput,
  type ReviewGroundingFailureDiagnostic,
} from "@/lib/ai/tasks/integrated-review";
import { getAiProvider } from "@/lib/ai/provider";
import { AnalyzeSessionError } from "@/lib/ai/errors";
import type { getDb } from "@/lib/db/client";
import { insertReview } from "@/lib/db/queries";
import type { ReviewRecord } from "@/lib/db/schema";
import type { ObservationConceptSupportDb } from "@/lib/db/observation-concept-support-queries";
import {
  afterReviewObservationsCommitted,
  type ObservationConceptRelationLifecycleResult,
  type ObservationConceptRelationReconcileFn,
} from "@/lib/observations/observation-concept-relation-lifecycle";
import {
  projectPersistedReview,
  type ProjectReviewResult,
} from "@/lib/observations/project-review";
import {
  loadReviewProcessingRunByReviewId,
  updateReviewProcessingRunPhase,
} from "@/lib/reviews/review-run-store";

export type IntegratedReviewExecutionMode = "fresh" | "resumed";

export type IntegratedReviewProcessingStatus =
  | "completed"
  | "projection_failed"
  | "blocked"
  | "failed";

export type IntegratedReviewProcessingResult = {
  status: IntegratedReviewProcessingStatus;
  executionMode: IntegratedReviewExecutionMode;
  reviewId: string | null;
  llmCalls: number;
  reason: string | null;
  code: string | null;
  projection: {
    status: ProjectReviewResult["status"] | "not_run";
    observationCount: number;
    code: string | null;
  };
  relationReconciliation: ObservationConceptRelationLifecycleResult | null;
  groundingDiagnostic?: ReviewGroundingFailureDiagnostic | null;
};

export type ProcessIntegratedReviewSelectionDeps = {
  db?: ReturnType<typeof getDb>;
  generateStructured?: AiProvider["generateStructured"];
  saveReview?: (input: IntegratedReviewSaveInput) => ReviewRecord;
  projectReview?: typeof projectPersistedReview;
  reconcile?: ObservationConceptRelationReconcileFn;
  now?: () => string;
  updateRunPhase?: typeof updateReviewProcessingRunPhase;
};

function toIntegratedReviewResult(
  saved: IntegratedReviewResult,
  llmCalls: number,
): Pick<
  IntegratedReviewProcessingResult,
  | "status"
  | "reviewId"
  | "reason"
  | "code"
  | "llmCalls"
  | "groundingDiagnostic"
> {
  if (!saved.ok) {
    return {
      status: saved.code === "save" ? "failed" : "failed",
      reviewId: null,
      reason: saved.reason ?? saved.error,
      code: saved.code,
      llmCalls,
      groundingDiagnostic: saved.groundingDiagnostic ?? null,
    };
  }
  return {
    status: "completed",
    reviewId: saved.reviewId,
    reason: null,
    code: null,
    llmCalls,
    groundingDiagnostic: null,
  };
}

export async function processIntegratedReviewSelection(
  sources: ReviewSessionSource[],
  title: string,
  deps: ProcessIntegratedReviewSelectionDeps = {},
): Promise<IntegratedReviewProcessingResult> {
  const { getDb } = await import("@/lib/db/client");
  const db = deps.db ?? getDb();
  const nowFn = deps.now ?? (() => new Date().toISOString());
  const saveReview = deps.saveReview ?? insertReview;
  const projectReview = deps.projectReview ?? projectPersistedReview;
  const updateRunPhase = deps.updateRunPhase ?? updateReviewProcessingRunPhase;

  let llmCalls = 0;
  const provider = getAiProvider();
  const generateStructured =
    deps.generateStructured ??
    ((request: Parameters<AiProvider["generateStructured"]>[0]) =>
      provider.generateStructured(request));
  const generated = await runIntegratedReview(sources, title, {
    generateStructured: async (request) => {
      llmCalls += 1;
      return generateStructured(request);
    },
    save: (input) => saveReview(input),
  });

  if (!generated.ok) {
    const base = toIntegratedReviewResult(generated, llmCalls);
    return {
      ...base,
      executionMode: "fresh",
      projection: {
        status: "not_run",
        observationCount: 0,
        code: null,
      },
      relationReconciliation: null,
    };
  }

  let projectionResult: ProjectReviewResult;
  let observationCount = 0;
  try {
    const projected = projectReview({
      reviewId: generated.reviewId,
      db,
      now: nowFn,
      updateRunPhase,
    });
    if (!projected.ok) {
      return {
        status: "projection_failed",
        executionMode: "fresh",
        reviewId: generated.reviewId,
        llmCalls: 1,
        reason: projected.code,
        code: "projection_failed",
        projection: {
          status: projected.projection?.status ?? "skipped",
          observationCount: 0,
          code: projected.code,
        },
        relationReconciliation: null,
      };
    }
    projectionResult = projected.projection;
    observationCount = projected.observationCount;
  } catch (error) {
    return {
      status: "projection_failed",
      executionMode: "fresh",
      reviewId: generated.reviewId,
      llmCalls: 1,
      reason:
        error instanceof Error ? error.message : "observation_projection_failed",
      code: "projection_failed",
      projection: {
        status: "not_run",
        observationCount: 0,
        code: "projection_failed",
      },
      relationReconciliation: null,
    };
  }

  const relationReconciliation = afterReviewObservationsCommitted(
    { reviewId: generated.reviewId },
    { db, reconcile: deps.reconcile },
  );

  return {
    status: "completed",
    executionMode: "fresh",
    reviewId: generated.reviewId,
    llmCalls,
    reason: null,
    code: null,
    projection: {
      status: projectionResult.status,
      observationCount,
      code: null,
    },
    relationReconciliation,
  };
}

export async function resumeIntegratedReviewProjection(
  input: { reviewId: string },
  deps: ProcessIntegratedReviewSelectionDeps = {},
): Promise<IntegratedReviewProcessingResult> {
  const { getDb } = await import("@/lib/db/client");
  const db = deps.db ?? getDb();
  const nowFn = deps.now ?? (() => new Date().toISOString());
  const projectReview = deps.projectReview ?? projectPersistedReview;
  const updateRunPhase = deps.updateRunPhase ?? updateReviewProcessingRunPhase;

  const run = loadReviewProcessingRunByReviewId({
    reviewId: input.reviewId,
    db,
  });
  if (!run) {
    return {
      status: "blocked",
      executionMode: "resumed",
      reviewId: input.reviewId,
      llmCalls: 0,
      reason: "legacy_review_completion_unknown",
      code: "legacy_review_completion_unknown",
      projection: {
        status: "not_run",
        observationCount: 0,
        code: null,
      },
      relationReconciliation: null,
    };
  }
  if (run.phase === "projection_done") {
    return {
      status: "completed",
      executionMode: "resumed",
      reviewId: input.reviewId,
      llmCalls: 0,
      reason: null,
      code: null,
      projection: {
        status: "projected",
        observationCount: run.projectedObservationCount ?? 0,
        code: null,
      },
      relationReconciliation: null,
    };
  }

  let projectionResult: ProjectReviewResult;
  let observationCount = 0;
  try {
    const projected = projectReview({
      reviewId: input.reviewId,
      db,
      now: nowFn,
      updateRunPhase,
    });
    if (!projected.ok) {
      return {
        status: "projection_failed",
        executionMode: "resumed",
        reviewId: input.reviewId,
        llmCalls: 0,
        reason: projected.code,
        code: "projection_failed",
        projection: {
          status: projected.projection?.status ?? "skipped",
          observationCount: 0,
          code: projected.code,
        },
        relationReconciliation: null,
      };
    }
    projectionResult = projected.projection;
    observationCount = projected.observationCount;
  } catch (error) {
    return {
      status: "projection_failed",
      executionMode: "resumed",
      reviewId: input.reviewId,
      llmCalls: 0,
      reason:
        error instanceof Error ? error.message : "observation_projection_failed",
      code: "projection_failed",
      projection: {
        status: "not_run",
        observationCount: 0,
        code: "projection_failed",
      },
      relationReconciliation: null,
    };
  }

  const relationReconciliation = afterReviewObservationsCommitted(
    { reviewId: input.reviewId },
    { db, reconcile: deps.reconcile },
  );

  return {
    status: "completed",
    executionMode: "resumed",
    reviewId: input.reviewId,
    llmCalls: 0,
    reason: null,
    code: null,
    projection: {
      status: projectionResult.status,
      observationCount,
      code: null,
    },
    relationReconciliation,
  };
}

export async function createIntegratedReviewWithRecovery(
  sources: ReviewSessionSource[],
  title: string,
  lifecycle?: {
    db?: ObservationConceptSupportDb;
    reconcile?: ObservationConceptRelationReconcileFn;
  },
): Promise<IntegratedReviewResult> {
  try {
    const result = await processIntegratedReviewSelection(sources, title, {
      db: lifecycle?.db,
      reconcile: lifecycle?.reconcile,
    });
    if (result.status === "completed" && result.reviewId) {
      return {
        ok: true,
        reviewId: result.reviewId,
        relationReconciliation: result.relationReconciliation ?? undefined,
      };
    }
    if (result.status === "projection_failed" && result.reviewId) {
      return {
        ok: false,
        code: "projection_failed",
        error:
          result.reason ??
          "統合レビューは保存されましたが、Observation投影に失敗しました。",
      };
    }
    return {
      ok: false,
      code: result.code ?? "api",
      error: result.reason ?? "統合レビューに失敗しました。",
    };
  } catch (error) {
    if (error instanceof AnalyzeSessionError) {
      return { ok: false, code: error.code, error: error.message };
    }
    console.error("integrated-review failed");
    return {
      ok: false,
      code: "api",
      error: "統合レビューに失敗しました。Sessionの原文は変更していません。",
    };
  }
}
