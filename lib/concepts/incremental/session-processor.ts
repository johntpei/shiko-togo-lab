import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import type { AiProvider } from "@/lib/ai/provider";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import type { ConceptIncrementalSessionRunRecord } from "@/lib/db/schema";
import type { ObservationConceptRelationLifecycleResult } from "@/lib/observations/observation-concept-relation-lifecycle";
import {
  applyExistingMatchOccurrencesThenReconcile,
  type ExistingMatchOccurrenceLifecycleResult,
} from "./existing-append-lifecycle";
import {
  buildExistingMatchAppendIntent,
  intentToExistingMatchPlans,
  type ExistingMatchAppendIntent,
  type ExistingMatchAppendIntentSource,
} from "./append-intent";
import {
  CONCEPT_INCREMENTAL_PROCESSING_VERSION,
  markIncrementalConceptSessionCompleted,
  validateIncrementalConceptCompletionProof,
  type IncrementalConceptCompletionProof,
} from "./checkpoint";
import {
  evaluateIncrementalSessionEligibility,
  type IncrementalSessionEligibility,
  type InitialConceptProcessingCoverageLoad,
} from "./eligibility";
import { verifyPreparedIncrementalNewAdmissionAlreadyApplied } from "./new-admission-exact-recovery";
import { applyIncrementalNewAdmissionManifestThenReconcile } from "./new-admission-lifecycle";
import {
  assessIncrementalNewFromIntent,
  type IncrementalNewAssessmentPipelineResult,
} from "./new-admission";
import {
  runIncrementalNewAdmissionPreflight,
  type IncrementalNewAdmissionApplyResult,
} from "./new-admission-apply";
import type { IncrementalNewAdmissionManifest } from "./new-admission-manifest";
import {
  buildNewAssessmentIntent,
  type NewAssessmentIntent,
} from "./new-assessment-intent";
import type { ExistingMatchPlan } from "./plan";
import {
  runExistingMatchOccurrencePreflight,
  type ExistingMatchOccurrencePreflightResult,
} from "./preflight";
import {
  planIncrementalSession,
  type IncrementalCandidateExtractor,
  type IncrementalSessionPlanResult,
} from "./session-plan";
import {
  buildIncrementalConceptSessionPreparedPayload,
  completionProofFromPreparedPayload,
  parsePreparedPayload,
  type IncrementalConceptSessionPreparedPayload,
} from "./session-run-payload";
import {
  insertPreparedIncrementalSessionRun,
  loadIncrementalSessionRunBySession,
  updateIncrementalSessionRunPhase,
  type InsertPreparedRunResult,
} from "./session-run-store";
import type {
  IncrementalConceptSessionExecutionMode,
  IncrementalSessionRunPhase,
  PreparedPlanningSummary,
} from "./session-run-types";

export const INCREMENTAL_CONCEPT_SESSION_PROCESSOR_VERSION =
  "incremental-concept-session-processor-v0";

export type IncrementalConceptSessionProcessorStatus =
  | "already_covered"
  | "completed"
  | "blocked"
  | "failed";

export type IncrementalConceptSessionPrimaryStatus =
  | "not_started"
  | "skipped"
  | "applied"
  | "no_op"
  | "failed";

export type IncrementalConceptSessionCheckpointStatus =
  | "not_written"
  | "completed"
  | "failed";

export type IncrementalConceptSessionProcessorResult = {
  version: typeof INCREMENTAL_CONCEPT_SESSION_PROCESSOR_VERSION;
  processingVersion: typeof CONCEPT_INCREMENTAL_PROCESSING_VERSION;
  sessionId: string;
  status: IncrementalConceptSessionProcessorStatus;
  reason: string | null;
  executionMode: IncrementalConceptSessionExecutionMode | null;
  runId: string | null;
  resumedFromPhase: IncrementalSessionRunPhase | null;
  eligibility: {
    status: IncrementalSessionEligibility["status"] | "not_evaluated";
    reason: string | null;
  };
  planning: {
    status: IncrementalSessionPlanResult["status"] | "no_actions" | null;
    existingMatchCount: number;
    newCandidateCount: number;
    provisionalNewCount: number;
    groundingRejectedCount: number;
  };
  existingPrimary: {
    status: IncrementalConceptSessionPrimaryStatus;
    occurrencesCreated: number;
    alreadyPresent: number;
    code: string | null;
  };
  newPrimary: {
    status: IncrementalConceptSessionPrimaryStatus;
    conceptsCreated: number;
    occurrencesCreated: number;
    aliasesCreated: 0;
    code: string | null;
  };
  checkpoint: {
    status: IncrementalConceptSessionCheckpointStatus;
    code: string | null;
  };
  relationReconciliation: {
    existing: ObservationConceptRelationLifecycleResult | null;
    new: ObservationConceptRelationLifecycleResult | null;
    warnings: Array<{ stage: "existing" | "new"; code: string }>;
  };
  frozenExistingIntentUsed: boolean;
  frozenNewIntentUsed: boolean;
  newAssessmentAttempted: boolean;
  retryAttempted: false;
  extractionCalls: number;
  assessmentCalls: number;
  stageOrder: string[];
};

export type ProcessIncrementalConceptSessionInput = {
  sessionId: string;
  coverage: InitialConceptProcessingCoverageLoad;
};

export type ProcessIncrementalConceptSessionDeps = {
  db: ConceptQueryDb;
  extractCandidates: IncrementalCandidateExtractor;
  generateStructured: AiProvider["generateStructured"];
  now?: () => string;
  model?: string | null;
  applyExisting?: typeof applyExistingMatchOccurrencesThenReconcile;
  applyNew?: typeof applyIncrementalNewAdmissionManifestThenReconcile;
  writeCheckpoint?: typeof markIncrementalConceptSessionCompleted;
  runExistingPreflight?: typeof runExistingMatchOccurrencePreflight;
  runNewPreflight?: typeof runIncrementalNewAdmissionPreflight;
  assessNew?: typeof assessIncrementalNewFromIntent;
  persistPreparedRun?: typeof insertPreparedIncrementalSessionRun;
  loadPreparedRun?: typeof loadIncrementalSessionRunBySession;
  updateRunPhase?: typeof updateIncrementalSessionRunPhase;
  verifyNewExact?: typeof verifyPreparedIncrementalNewAdmissionAlreadyApplied;
};

function emptyPlanning(): IncrementalConceptSessionProcessorResult["planning"] {
  return {
    status: null,
    existingMatchCount: 0,
    newCandidateCount: 0,
    provisionalNewCount: 0,
    groundingRejectedCount: 0,
  };
}

function emptyExistingPrimary(): IncrementalConceptSessionProcessorResult["existingPrimary"] {
  return {
    status: "not_started",
    occurrencesCreated: 0,
    alreadyPresent: 0,
    code: null,
  };
}

function emptyNewPrimary(): IncrementalConceptSessionProcessorResult["newPrimary"] {
  return {
    status: "not_started",
    conceptsCreated: 0,
    occurrencesCreated: 0,
    aliasesCreated: 0,
    code: null,
  };
}

function baseResult(
  sessionId: string,
): IncrementalConceptSessionProcessorResult {
  return {
    version: INCREMENTAL_CONCEPT_SESSION_PROCESSOR_VERSION,
    processingVersion: CONCEPT_INCREMENTAL_PROCESSING_VERSION,
    sessionId,
    status: "blocked",
    reason: null,
    executionMode: null,
    runId: null,
    resumedFromPhase: null,
    eligibility: { status: "not_evaluated", reason: null },
    planning: emptyPlanning(),
    existingPrimary: emptyExistingPrimary(),
    newPrimary: emptyNewPrimary(),
    checkpoint: { status: "not_written", code: null },
    relationReconciliation: {
      existing: null,
      new: null,
      warnings: [],
    },
    frozenExistingIntentUsed: false,
    frozenNewIntentUsed: false,
    newAssessmentAttempted: false,
    retryAttempted: false,
    extractionCalls: 0,
    assessmentCalls: 0,
    stageOrder: [],
  };
}

function record(
  result: IncrementalConceptSessionProcessorResult,
  stage: string,
) {
  result.stageOrder.push(stage);
}

function eligibilityReason(
  eligibility: IncrementalSessionEligibility,
): string | null {
  if (eligibility.status === "eligible") {
    return null;
  }
  return eligibility.reason;
}

function planningCounts(planResult: IncrementalSessionPlanResult) {
  if (planResult.status === "blocked") {
    return {
      status: planResult.status,
      existingMatchCount: 0,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: planResult.groundingRejectedCount,
    };
  }
  return {
    status: planResult.status,
    existingMatchCount: planResult.existingMatches,
    newCandidateCount: planResult.newCandidates,
    provisionalNewCount: planResult.provisionalNewCandidates,
    groundingRejectedCount: planResult.groundingRejectedCount,
  };
}

function preparedPlanningSummary(
  planResult: IncrementalSessionPlanResult,
): PreparedPlanningSummary {
  if (planResult.status === "blocked") {
    return {
      status: "no_actions",
      existingMatchCount: 0,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: planResult.groundingRejectedCount,
    };
  }
  return {
    status: planResult.status === "no_op" ? "no_actions" : "planned",
    existingMatchCount: planResult.existingMatches,
    newCandidateCount: planResult.newCandidates,
    provisionalNewCount: planResult.provisionalNewCandidates,
    groundingRejectedCount: planResult.groundingRejectedCount,
  };
}

function applyPreparedPlanning(
  result: IncrementalConceptSessionProcessorResult,
  planning: PreparedPlanningSummary,
) {
  result.planning = {
    status: planning.status,
    existingMatchCount: planning.existingMatchCount,
    newCandidateCount: planning.newCandidateCount,
    provisionalNewCount: planning.provisionalNewCount,
    groundingRejectedCount: planning.groundingRejectedCount,
  };
}

function intentSource(
  coverage: InitialConceptProcessingCoverageLoad,
  model: string | null,
): ExistingMatchAppendIntentSource {
  return {
    model,
    promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
    extractionVersion: CONCEPT_EXTRACTION_VERSION,
    coverageSourceHash: coverage.ok ? coverage.coverage.sourceHash : "",
  };
}

function relationWarning(
  stage: "existing" | "new",
  relation: ObservationConceptRelationLifecycleResult | null,
): { stage: "existing" | "new"; code: string } | null {
  if (!relation || relation.status !== "failed") {
    return null;
  }
  return { stage, code: relation.code };
}

function finishBlocked(
  result: IncrementalConceptSessionProcessorResult,
  reason: string,
): IncrementalConceptSessionProcessorResult {
  result.status = "blocked";
  result.reason = reason;
  return result;
}

function finishFailed(
  result: IncrementalConceptSessionProcessorResult,
  reason: string,
): IncrementalConceptSessionProcessorResult {
  result.status = "failed";
  result.reason = reason;
  return result;
}

function safeUpdateRunPhase(
  updateRunPhase: typeof updateIncrementalSessionRunPhase,
  input: Parameters<typeof updateIncrementalSessionRunPhase>[0],
) {
  try {
    updateRunPhase(input);
  } catch {
    // Phase is diagnostic; domain state is verified on resume.
  }
}

type ExecutePreparedContext = {
  executionMode: IncrementalConceptSessionExecutionMode;
  runId: string;
  resumedFromPhase: IncrementalSessionRunPhase | null;
  payload: IncrementalConceptSessionPreparedPayload;
  existingPlans: ExistingMatchPlan[];
  newManifest: IncrementalNewAdmissionManifest | null;
  deps: ProcessIncrementalConceptSessionDeps;
  nowFn: () => string;
  applyExisting: typeof applyExistingMatchOccurrencesThenReconcile;
  applyNew: typeof applyIncrementalNewAdmissionManifestThenReconcile;
  writeCheckpoint: typeof markIncrementalConceptSessionCompleted;
  runExistingPreflight: typeof runExistingMatchOccurrencePreflight;
  runNewPreflight: typeof runIncrementalNewAdmissionPreflight;
  updateRunPhase: typeof updateIncrementalSessionRunPhase;
  verifyNewExact: typeof verifyPreparedIncrementalNewAdmissionAlreadyApplied;
};

function executeFromPrepared(
  result: IncrementalConceptSessionProcessorResult,
  ctx: ExecutePreparedContext,
): IncrementalConceptSessionProcessorResult {
  result.executionMode = ctx.executionMode;
  result.runId = ctx.runId;
  result.resumedFromPhase = ctx.resumedFromPhase;
  applyPreparedPlanning(result, ctx.payload.planning);

  if (ctx.payload.existingAppendIntent) {
    result.frozenExistingIntentUsed = true;
  }
  if (ctx.payload.newAssessmentIntent) {
    result.frozenNewIntentUsed = true;
  }
  if (ctx.payload.newAdmissionManifest) {
    result.newAssessmentAttempted = true;
  }

  const existingPlanned = ctx.payload.planning.existingMatchCount;
  const newPlanned = ctx.payload.planning.newCandidateCount;

  if (existingPlanned === 0) {
    result.existingPrimary.status = "skipped";
  }
  if (newPlanned === 0) {
    result.newPrimary.status = "skipped";
  }

  if (ctx.existingPlans.length > 0) {
    record(result, "existing_preflight");
    const existingPreflight: ExistingMatchOccurrencePreflightResult =
      ctx.runExistingPreflight(ctx.existingPlans, { db: ctx.deps.db });
    if (existingPreflight.status === "blocked") {
      return finishBlocked(
        result,
        existingPreflight.blockers[0]?.code ?? "existing_preflight_blocked",
      );
    }
  }

  let newExact: ReturnType<typeof verifyPreparedIncrementalNewAdmissionAlreadyApplied> | null =
    null;
  if (ctx.newManifest) {
    if (ctx.executionMode === "resumed") {
      newExact = ctx.verifyNewExact(ctx.newManifest, ctx.deps.db);
      if (!newExact.ok) {
        return finishBlocked(result, newExact.code);
      }
    }
    const needsNewPreflight =
      ctx.executionMode === "fresh" ||
      (newExact !== null && !newExact.alreadyAppliedExact);
    if (needsNewPreflight) {
      record(result, "new_preflight");
      const newPreflight = ctx.runNewPreflight(ctx.newManifest, {
        db: ctx.deps.db,
      });
      if (newPreflight.status === "blocked") {
        return finishBlocked(result, newPreflight.code);
      }
    }
  }

  if (ctx.existingPlans.length > 0) {
    record(result, "existing_primary");
    const existingLifecycle: ExistingMatchOccurrenceLifecycleResult =
      ctx.applyExisting(ctx.existingPlans, {
        db: ctx.deps.db,
        now: ctx.nowFn,
      });
    const primary = existingLifecycle.primary;
    if (!primary.ok) {
      result.existingPrimary = {
        status: "failed",
        occurrencesCreated: 0,
        alreadyPresent: 0,
        code: primary.code,
      };
      result.relationReconciliation.existing =
        existingLifecycle.relationReconciliation;
      safeUpdateRunPhase(ctx.updateRunPhase, {
        runId: ctx.runId,
        phase: "prepared",
        db: ctx.deps.db,
        now: ctx.nowFn,
        lastFailureStage: "existing_primary",
        lastFailureCode: primary.code,
      });
      return finishFailed(result, "existing_primary_failed");
    }
    result.existingPrimary = {
      status: "applied",
      occurrencesCreated: primary.occurrencesCreated,
      alreadyPresent: primary.alreadyPresent,
      code: null,
    };
    result.relationReconciliation.existing =
      existingLifecycle.relationReconciliation;
    const existingWarning = relationWarning(
      "existing",
      existingLifecycle.relationReconciliation,
    );
    if (existingWarning) {
      result.relationReconciliation.warnings.push(existingWarning);
    }
    safeUpdateRunPhase(ctx.updateRunPhase, {
      runId: ctx.runId,
      phase: "existing_primary_done",
      db: ctx.deps.db,
      now: ctx.nowFn,
    });
  }

  if (ctx.newManifest) {
    record(result, "new_primary");
    const exact =
      ctx.executionMode === "resumed"
        ? (newExact ?? ctx.verifyNewExact(ctx.newManifest, ctx.deps.db))
        : null;
    if (exact && !exact.ok) {
      safeUpdateRunPhase(ctx.updateRunPhase, {
        runId: ctx.runId,
        phase: existingPlanned > 0 ? "existing_primary_done" : "prepared",
        db: ctx.deps.db,
        now: ctx.nowFn,
        lastFailureStage: "new_primary",
        lastFailureCode: exact.code,
      });
      return finishBlocked(result, exact.code);
    }

    if (exact?.alreadyAppliedExact) {
      const admittedCount = ctx.newManifest.admittedCandidates.length;
      result.newPrimary = {
        status: admittedCount === 0 ? "no_op" : "applied",
        conceptsCreated: 0,
        occurrencesCreated: 0,
        aliasesCreated: 0,
        code: admittedCount === 0 ? "no_admitted_candidates" : null,
      };
      result.relationReconciliation.new = null;
    } else {
      const newLifecycle = ctx.applyNew(ctx.newManifest, {
        db: ctx.deps.db,
        now: ctx.nowFn,
      });
      const primary: IncrementalNewAdmissionApplyResult = newLifecycle.primary;
      result.relationReconciliation.new = newLifecycle.relationReconciliation;
      if (!primary.ok) {
        result.newPrimary = {
          status: "failed",
          conceptsCreated: 0,
          occurrencesCreated: 0,
          aliasesCreated: 0,
          code: primary.code,
        };
        const newWarning = relationWarning(
          "new",
          newLifecycle.relationReconciliation,
        );
        if (newWarning) {
          result.relationReconciliation.warnings.push(newWarning);
        }
        safeUpdateRunPhase(ctx.updateRunPhase, {
          runId: ctx.runId,
          phase:
            existingPlanned > 0 ? "existing_primary_done" : "prepared",
          db: ctx.deps.db,
          now: ctx.nowFn,
          lastFailureStage: "new_primary",
          lastFailureCode: primary.code,
        });
        return finishFailed(
          result,
          result.existingPrimary.status === "applied"
            ? "partial_primary_commit"
            : "new_primary_failed",
        );
      }
      result.newPrimary = {
        status: primary.status === "no_op" ? "no_op" : "applied",
        conceptsCreated: primary.conceptsCreated,
        occurrencesCreated: primary.occurrencesCreated,
        aliasesCreated: 0,
        code: primary.status === "no_op" ? primary.code : null,
      };
      const newWarning = relationWarning(
        "new",
        newLifecycle.relationReconciliation,
      );
      if (newWarning) {
        result.relationReconciliation.warnings.push(newWarning);
      }
    }
    safeUpdateRunPhase(ctx.updateRunPhase, {
      runId: ctx.runId,
      phase: "new_primary_done",
      db: ctx.deps.db,
      now: ctx.nowFn,
    });
  }

  record(result, "completion_proof");
  const proof: IncrementalConceptCompletionProof =
    completionProofFromPreparedPayload(ctx.payload);
  const validated = validateIncrementalConceptCompletionProof(proof);
  if (!validated.ok) {
    return finishFailed(result, validated.code);
  }

  record(result, "checkpoint");
  try {
    const written = ctx.writeCheckpoint(validated.proof, {
      db: ctx.deps.db,
      now: ctx.nowFn(),
    });
    if (!written.ok) {
      result.checkpoint = { status: "failed", code: written.code };
      safeUpdateRunPhase(ctx.updateRunPhase, {
        runId: ctx.runId,
        phase: "new_primary_done",
        db: ctx.deps.db,
        now: ctx.nowFn,
        lastFailureStage: "checkpoint",
        lastFailureCode: written.code,
      });
      return finishFailed(result, "checkpoint_failed");
    }
    result.checkpoint = { status: "completed", code: null };
  } catch {
    result.checkpoint = { status: "failed", code: "checkpoint_write_threw" };
    safeUpdateRunPhase(ctx.updateRunPhase, {
      runId: ctx.runId,
      phase: "new_primary_done",
      db: ctx.deps.db,
      now: ctx.nowFn,
      lastFailureStage: "checkpoint",
      lastFailureCode: "checkpoint_write_threw",
    });
    return finishFailed(result, "checkpoint_failed");
  }

  safeUpdateRunPhase(ctx.updateRunPhase, {
    runId: ctx.runId,
    phase: "checkpoint_done",
    db: ctx.deps.db,
    now: ctx.nowFn,
  });

  result.status = "completed";
  result.reason = null;
  return result;
}

function resumeFromPreparedRun(
  result: IncrementalConceptSessionProcessorResult,
  runRow: ConceptIncrementalSessionRunRecord,
  deps: ProcessIncrementalConceptSessionDeps,
  services: {
    nowFn: () => string;
    applyExisting: typeof applyExistingMatchOccurrencesThenReconcile;
    applyNew: typeof applyIncrementalNewAdmissionManifestThenReconcile;
    writeCheckpoint: typeof markIncrementalConceptSessionCompleted;
    runExistingPreflight: typeof runExistingMatchOccurrencePreflight;
    runNewPreflight: typeof runIncrementalNewAdmissionPreflight;
    updateRunPhase: typeof updateIncrementalSessionRunPhase;
    verifyNewExact: typeof verifyPreparedIncrementalNewAdmissionAlreadyApplied;
  },
): IncrementalConceptSessionProcessorResult {
  record(result, "prepared_run_load");
  const parsed = parsePreparedPayload(runRow.preparedPayload);
  if (!parsed.ok) {
    return finishBlocked(result, "invalid_prepared_run");
  }

  const existingPlans = parsed.payload.existingAppendIntent
    ? intentToExistingMatchPlans(parsed.payload.existingAppendIntent)
    : [];

  return executeFromPrepared(result, {
    executionMode: "resumed",
    runId: runRow.runId,
    resumedFromPhase: runRow.phase as IncrementalSessionRunPhase,
    payload: parsed.payload,
    existingPlans,
    newManifest: parsed.payload.newAdmissionManifest,
    deps,
    nowFn: services.nowFn,
    applyExisting: services.applyExisting,
    applyNew: services.applyNew,
    writeCheckpoint: services.writeCheckpoint,
    runExistingPreflight: services.runExistingPreflight,
    runNewPreflight: services.runNewPreflight,
    updateRunPhase: services.updateRunPhase,
    verifyNewExact: services.verifyNewExact,
  });
}

function persistPreparedOrResume(
  result: IncrementalConceptSessionProcessorResult,
  input: {
    sessionId: string;
    payload: IncrementalConceptSessionPreparedPayload;
    existingPlans: ExistingMatchPlan[];
    newManifest: IncrementalNewAdmissionManifest | null;
    deps: ProcessIncrementalConceptSessionDeps;
    persistPreparedRun: typeof insertPreparedIncrementalSessionRun;
    loadPreparedRun: typeof loadIncrementalSessionRunBySession;
    services: Omit<ExecutePreparedContext, "executionMode" | "runId" | "resumedFromPhase" | "payload" | "existingPlans" | "newManifest" | "deps">;
  },
): IncrementalConceptSessionProcessorResult {
  record(result, "prepared_run_persist");
  const persisted: InsertPreparedRunResult = input.persistPreparedRun({
    sessionId: input.sessionId,
    payload: input.payload,
    db: input.deps.db,
    now: input.services.nowFn,
  });

  if (!persisted.ok) {
    if (persisted.code === "unique_conflict") {
      const winner = input.loadPreparedRun({
        sessionId: input.sessionId,
        db: input.deps.db,
      });
      if (!winner) {
        return finishFailed(result, "prepared_run_race_load_failed");
      }
      return resumeFromPreparedRun(result, winner, input.deps, {
        nowFn: input.services.nowFn,
        applyExisting: input.services.applyExisting,
        applyNew: input.services.applyNew,
        writeCheckpoint: input.services.writeCheckpoint,
        runExistingPreflight: input.services.runExistingPreflight,
        runNewPreflight: input.services.runNewPreflight,
        updateRunPhase: input.services.updateRunPhase,
        verifyNewExact: input.services.verifyNewExact,
      });
    }
    return finishFailed(result, "prepared_run_persist_failed");
  }

  return executeFromPrepared(result, {
    executionMode: "fresh",
    runId: persisted.runId,
    resumedFromPhase: null,
    payload: input.payload,
    existingPlans: input.existingPlans,
    newManifest: input.newManifest,
    deps: input.deps,
    nowFn: input.services.nowFn,
    applyExisting: input.services.applyExisting,
    applyNew: input.services.applyNew,
    writeCheckpoint: input.services.writeCheckpoint,
    runExistingPreflight: input.services.runExistingPreflight,
    runNewPreflight: input.services.runNewPreflight,
    updateRunPhase: input.services.updateRunPhase,
    verifyNewExact: input.services.verifyNewExact,
  });
}

/**
 * Exactly-one-Session Incremental Concept processor.
 * Eligibility runs before Extraction. Prepared run persists before first primary write.
 * Resume skips Extraction and Assessment when a durable prepared run exists.
 */
export async function processIncrementalConceptSession(
  input: ProcessIncrementalConceptSessionInput,
  deps: ProcessIncrementalConceptSessionDeps,
): Promise<IncrementalConceptSessionProcessorResult> {
  const result = baseResult(input.sessionId);
  const nowFn = deps.now ?? (() => new Date().toISOString());
  const applyExisting =
    deps.applyExisting ?? applyExistingMatchOccurrencesThenReconcile;
  const applyNew =
    deps.applyNew ?? applyIncrementalNewAdmissionManifestThenReconcile;
  const writeCheckpoint =
    deps.writeCheckpoint ?? markIncrementalConceptSessionCompleted;
  const runExistingPreflight =
    deps.runExistingPreflight ?? runExistingMatchOccurrencePreflight;
  const runNewPreflight =
    deps.runNewPreflight ?? runIncrementalNewAdmissionPreflight;
  const assessNew = deps.assessNew ?? assessIncrementalNewFromIntent;
  const persistPreparedRun =
    deps.persistPreparedRun ?? insertPreparedIncrementalSessionRun;
  const loadPreparedRun =
    deps.loadPreparedRun ?? loadIncrementalSessionRunBySession;
  const updateRunPhase = deps.updateRunPhase ?? updateIncrementalSessionRunPhase;
  const verifyNewExact =
    deps.verifyNewExact ?? verifyPreparedIncrementalNewAdmissionAlreadyApplied;

  const services = {
    nowFn,
    applyExisting,
    applyNew,
    writeCheckpoint,
    runExistingPreflight,
    runNewPreflight,
    updateRunPhase,
    verifyNewExact,
  };

  record(result, "eligibility");
  const eligibility = evaluateIncrementalSessionEligibility({
    sessionId: input.sessionId,
    db: deps.db,
    coverage: input.coverage,
  });
  result.eligibility = {
    status: eligibility.status,
    reason: eligibilityReason(eligibility),
  };

  if (eligibility.status === "already_covered") {
    result.status = "already_covered";
    result.reason = eligibility.reason;
    return result;
  }
  if (eligibility.status === "blocked") {
    return finishBlocked(result, eligibility.reason);
  }

  const existingRun = loadPreparedRun({
    sessionId: input.sessionId,
    db: deps.db,
  });
  if (existingRun) {
    return resumeFromPreparedRun(result, existingRun, deps, services);
  }

  const extractCandidates: IncrementalCandidateExtractor = async (
    units,
    context,
  ) => {
    result.extractionCalls += 1;
    return deps.extractCandidates(units, context);
  };

  record(result, "extraction");
  let planResult: IncrementalSessionPlanResult;
  try {
    planResult = await planIncrementalSession({
      sessionId: input.sessionId,
      db: deps.db,
      extractCandidates,
    });
  } catch (error) {
    return finishFailed(
      result,
      error instanceof Error ? error.message : "extraction_failed",
    );
  }
  record(result, "planning");
  result.planning = planningCounts(planResult);

  if (planResult.status === "blocked") {
    return finishBlocked(result, planResult.code);
  }

  const existingPlanned = planResult.existingMatches;
  const newPlanned = planResult.newCandidates;
  const source = intentSource(input.coverage, deps.model ?? null);
  let existingPlans: ExistingMatchPlan[] = [];
  let existingIntent: ExistingMatchAppendIntent | null = null;
  let newIntent: NewAssessmentIntent | null = null;
  let newManifest: IncrementalNewAdmissionManifest | null = null;

  if (existingPlanned > 0) {
    record(result, "freeze_existing");
    const frozenExisting = buildExistingMatchAppendIntent({
      sessionId: input.sessionId,
      plans: planResult.plans,
      source,
      now: nowFn,
    });
    if (!frozenExisting.ok) {
      return finishFailed(result, frozenExisting.code);
    }
    existingIntent = frozenExisting.intent;
    existingPlans = intentToExistingMatchPlans(frozenExisting.intent);
    result.frozenExistingIntentUsed = true;
  }

  if (newPlanned > 0) {
    record(result, "freeze_new");
    const frozenNew = buildNewAssessmentIntent({
      sessionId: input.sessionId,
      plans: planResult.plans,
      source,
      now: nowFn,
    });
    if (!frozenNew.ok) {
      return finishFailed(result, frozenNew.code);
    }
    newIntent = frozenNew.intent;
    result.frozenNewIntentUsed = true;
    record(result, "assessment");
    result.newAssessmentAttempted = true;
    let assessed: IncrementalNewAssessmentPipelineResult;
    try {
      assessed = await assessNew({
        intentText: JSON.stringify(frozenNew.intent),
        db: deps.db,
        generateStructured: async (request) => {
          result.assessmentCalls += 1;
          return deps.generateStructured(request);
        },
        now: nowFn,
      });
    } catch (error) {
      return finishFailed(
        result,
        error instanceof Error ? error.message : "assessment_failed",
      );
    }
    if (!assessed.ok) {
      return finishFailed(result, assessed.code);
    }
    newManifest = assessed.manifest;
  }

  if (existingPlans.length > 0) {
    record(result, "existing_preflight");
    const existingPreflight: ExistingMatchOccurrencePreflightResult =
      runExistingPreflight(existingPlans, { db: deps.db });
    if (existingPreflight.status === "blocked") {
      return finishBlocked(
        result,
        existingPreflight.blockers[0]?.code ?? "existing_preflight_blocked",
      );
    }
  }

  if (newManifest) {
    record(result, "new_preflight");
    const newPreflight = runNewPreflight(newManifest, { db: deps.db });
    if (newPreflight.status === "blocked") {
      return finishBlocked(result, newPreflight.code);
    }
  }

  const preparedPayload = buildIncrementalConceptSessionPreparedPayload({
    sessionId: input.sessionId,
    planning: preparedPlanningSummary(planResult),
    existingAppendIntent: existingIntent,
    newAssessmentIntent: newIntent,
    newAdmissionManifest: newManifest,
  });

  return persistPreparedOrResume(result, {
    sessionId: input.sessionId,
    payload: preparedPayload,
    existingPlans,
    newManifest,
    deps,
    persistPreparedRun,
    loadPreparedRun,
    services,
  });
}
