import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inArray } from "drizzle-orm";
import {
  CONCEPT_APPLY_DEFAULT_CANDIDATES,
  hashSourceArtifactText,
} from "@/lib/concepts/admission/apply-manifest";
import {
  evaluateIncrementalSessionEligibility,
  loadInitialConceptProcessingCoverage,
  type InitialConceptProcessingCoverageLoad,
} from "@/lib/concepts/incremental/eligibility";
import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import { sessions } from "@/lib/db/schema";
import {
  classifyExactReviewSelectionState,
  listReviewCoveredSessionIds,
} from "@/lib/reviews/review-selection-state";
import {
  buildDualPipelineOrchestratorPlan,
  uniqueSortedSessionIds,
} from "./plan";
import type { DualPipelineOrchestratorPlan } from "./types";

export const DEFAULT_INITIAL_CONCEPT_COVERAGE_PATH =
  CONCEPT_APPLY_DEFAULT_CANDIDATES;

export type DualPipelineOrchestratorPlanLoad = DualPipelineOrchestratorPlan & {
  initialCoverageStatus:
    | { ok: true; sourceHash: string }
    | { ok: false; code: string; detail: string };
};

function coverageStatus(coverage: InitialConceptProcessingCoverageLoad) {
  return coverage.ok
    ? { ok: true as const, sourceHash: coverage.coverage.sourceHash }
    : { ok: false as const, code: coverage.code, detail: coverage.detail };
}

export function loadInitialConceptCoverageFromCandidateText(
  candidateReportText: string,
): InitialConceptProcessingCoverageLoad {
  return loadInitialConceptProcessingCoverage({
    candidateReportText,
    expectedSourceHash: hashSourceArtifactText(candidateReportText),
  });
}

export function loadDualPipelineOrchestratorPlan(input: {
  db: ConceptQueryDb;
  sessionIds: string[];
  initialCoverage: InitialConceptProcessingCoverageLoad;
}): DualPipelineOrchestratorPlanLoad {
  const requestedSessionIds = uniqueSortedSessionIds(input.sessionIds);
  if (requestedSessionIds.length === 0) {
    const plan = buildDualPipelineOrchestratorPlan({
      requestedSessionIds: [],
      existingSessionIds: [],
      conceptEvaluations: [],
      reviewSelectionState: {
        exactCompletedReviewIds: [],
        exactPendingReviewIds: [],
        exactLegacyUnknownReviewIds: [],
      },
      reviewCoveredSessionIds: [],
    });
    return { ...plan, initialCoverageStatus: coverageStatus(input.initialCoverage) };
  }

  const existingRows = input.db
    .select({ sessionId: sessions.id })
    .from(sessions)
    .where(inArray(sessions.id, requestedSessionIds))
    .all();
  const existingSessionIds = existingRows.map((row) => row.sessionId);
  const existingSet = new Set(existingSessionIds);
  const validSessionIds = requestedSessionIds.filter((id) => existingSet.has(id));

  const conceptEvaluations = validSessionIds.map((sessionId) => {
    const eligibility = evaluateIncrementalSessionEligibility({
      sessionId,
      db: input.db,
      coverage: input.initialCoverage,
    });
    if (eligibility.status === "eligible") {
      return {
        sessionId,
        status: "eligible" as const,
        reason: "not_covered",
      };
    }
    if (eligibility.status === "already_covered") {
      return {
        sessionId,
        status: "already_covered" as const,
        reason: eligibility.reason,
      };
    }
    return {
      sessionId,
      status: "blocked" as const,
      reason: eligibility.reason,
    };
  });

  const reviewCoveredSessionIds = listReviewCoveredSessionIds(
    input.db,
    validSessionIds,
  );
  const reviewSelectionState = classifyExactReviewSelectionState(
    input.db,
    validSessionIds,
  );

  const plan = buildDualPipelineOrchestratorPlan({
    requestedSessionIds,
    existingSessionIds,
    conceptEvaluations,
    reviewSelectionState,
    reviewCoveredSessionIds,
  });

  return { ...plan, initialCoverageStatus: coverageStatus(input.initialCoverage) };
}

export function readInitialConceptCoverageFile(
  candidatesPath = DEFAULT_INITIAL_CONCEPT_COVERAGE_PATH,
) {
  const candidateReportText = readFileSync(resolve(candidatesPath), "utf8");
  return loadInitialConceptCoverageFromCandidateText(candidateReportText);
}
