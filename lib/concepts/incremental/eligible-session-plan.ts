import type { SurfaceNotInUnitDiagnostic } from "@/lib/concepts/grounding-diagnostic";
import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import {
  evaluateIncrementalSessionEligibility,
  type InitialConceptProcessingCoverageLoad,
} from "./eligibility";
import {
  planIncrementalSession,
  type IncrementalCandidateExtractor,
  type IncrementalSessionPlanResult,
} from "./session-plan";

export type EligibilityGatedIncrementalSessionResult =
  | {
      status: "already_covered";
      sessionId: string;
      reason: "initial_processing_coverage";
    }
  | {
      status: "blocked";
      sessionId: string;
      stage: "eligibility" | "planning";
      reason: string;
      adapterActions: number;
      actionsEnteringGrounding: number;
      groundedActions: number;
      groundedCandidates: number;
      groundingRejectedCount: number;
      groundingRejections: SurfaceNotInUnitDiagnostic[];
      groundingFailure: SurfaceNotInUnitDiagnostic | null;
    }
  | {
      status: "no_op";
      sessionId: string;
      planResult: IncrementalSessionPlanResult;
    }
  | {
      status: "planned";
      sessionId: string;
      planResult: IncrementalSessionPlanResult;
    };

/**
 * Eligibility を必ず先に通し、eligible のときだけ planIncrementalSession へ進む。
 * already_covered / eligibility blocked では extractor を呼ばない。
 */
export async function planEligibleIncrementalSession(input: {
  sessionId: string;
  db: ConceptQueryDb;
  coverage: InitialConceptProcessingCoverageLoad;
  extractCandidates: IncrementalCandidateExtractor;
}): Promise<EligibilityGatedIncrementalSessionResult> {
  const eligibility = evaluateIncrementalSessionEligibility({
    sessionId: input.sessionId,
    db: input.db,
    coverage: input.coverage,
  });

  if (eligibility.status === "already_covered") {
    return {
      status: "already_covered",
      sessionId: input.sessionId,
      reason: "initial_processing_coverage",
    };
  }

  if (eligibility.status === "blocked") {
    return {
      status: "blocked",
      sessionId: input.sessionId,
      stage: "eligibility",
      reason: eligibility.reason,
      adapterActions: 0,
      actionsEnteringGrounding: 0,
      groundedActions: 0,
      groundedCandidates: 0,
      groundingRejectedCount: 0,
      groundingRejections: [],
      groundingFailure: null,
    };
  }

  const planResult = await planIncrementalSession({
    sessionId: input.sessionId,
    db: input.db,
    extractCandidates: input.extractCandidates,
  });

  if (planResult.status === "blocked") {
    return {
      status: "blocked",
      sessionId: input.sessionId,
      stage: "planning",
      reason: planResult.code,
      adapterActions: planResult.adapterActions,
      actionsEnteringGrounding: planResult.actionsEnteringGrounding,
      groundedActions: planResult.groundedActions,
      groundedCandidates: planResult.groundedCandidates,
      groundingRejectedCount: planResult.groundingRejectedCount,
      groundingRejections: planResult.groundingRejections,
      groundingFailure: planResult.groundingFailure,
    };
  }

  if (planResult.status === "no_op") {
    return {
      status: "no_op",
      sessionId: input.sessionId,
      planResult,
    };
  }

  return {
    status: "planned",
    sessionId: input.sessionId,
    planResult,
  };
}
