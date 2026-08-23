import {
  applyExistingMatchOccurrences,
  readIncrementalRegistryCounts,
  type ExistingMatchOccurrenceApplyResult,
} from "./append";
import type { ExistingMatchPlan } from "./plan";
import {
  classifyExistingMatchOccurrencePlan,
  existingMatchOccurrenceIdentityKey,
  type ExistingMatchAppendDb,
} from "./validate";

export type ExistingMatchOccurrencePreflightStatus =
  | "ready"
  | "no_op"
  | "blocked";

export type ExistingMatchOccurrencePreflightBlocker = {
  code: string;
  detail: string;
  candidateRef?: string;
};

export type ExistingMatchOccurrencePlanDiagnostic = {
  candidateRef: string;
  classification: "insertable" | "already_present" | "conflict" | "blocked";
  code?: string;
};

export type ExistingMatchOccurrencePreflightResult = {
  status: ExistingMatchOccurrencePreflightStatus;
  plansChecked: number;
  predictedCreates: number;
  alreadyPresent: number;
  conflicts: number;
  blockers: ExistingMatchOccurrencePreflightBlocker[];
  diagnostics: ExistingMatchOccurrencePlanDiagnostic[];
};

export type RunExistingMatchOccurrencePreflightDeps = {
  db: ExistingMatchAppendDb;
};

/**
 * existing_match Occurrence append の read-only preflight。
 * write しない。結果は write authorization ではない。
 */
export function runExistingMatchOccurrencePreflight(
  plans: ExistingMatchPlan[],
  deps: RunExistingMatchOccurrencePreflightDeps,
): ExistingMatchOccurrencePreflightResult {
  const seen = new Map<string, ExistingMatchPlan>();
  const diagnostics: ExistingMatchOccurrencePlanDiagnostic[] = [];
  const blockers: ExistingMatchOccurrencePreflightBlocker[] = [];
  let predictedCreates = 0;
  let alreadyPresent = 0;
  let conflicts = 0;

  for (const [index, plan] of plans.entries()) {
    const classified = classifyExistingMatchOccurrencePlan(
      plan,
      index,
      deps.db,
      seen,
    );
    if (classified.status === "insertable" || classified.status === "already_present") {
      seen.set(existingMatchOccurrenceIdentityKey(plan), plan);
    }
    if (classified.status === "insertable") {
      predictedCreates += 1;
      diagnostics.push({
        candidateRef: plan.candidateRef,
        classification: "insertable",
      });
      continue;
    }
    if (classified.status === "already_present") {
      alreadyPresent += 1;
      diagnostics.push({
        candidateRef: plan.candidateRef,
        classification: "already_present",
      });
      continue;
    }
    if (classified.status === "conflict") {
      conflicts += 1;
      blockers.push({
        code: classified.code,
        detail: classified.detail,
        candidateRef: plan.candidateRef,
      });
      diagnostics.push({
        candidateRef: plan.candidateRef,
        classification: "conflict",
        code: classified.code,
      });
      continue;
    }
    blockers.push({
      code: classified.code,
      detail: classified.detail,
      candidateRef: plan.candidateRef,
    });
    diagnostics.push({
      candidateRef: plan.candidateRef,
      classification: "blocked",
      code: classified.code,
    });
  }

  const status: ExistingMatchOccurrencePreflightStatus =
    blockers.length > 0
      ? "blocked"
      : predictedCreates > 0
        ? "ready"
        : "no_op";

  return {
    status,
    plansChecked: plans.length,
    predictedCreates,
    alreadyPresent,
    conflicts,
    blockers,
    diagnostics,
  };
}

export type ExistingMatchOccurrenceAppendRunResult = {
  applyRequested: boolean;
  transactionStarted: boolean;
  occurrencesCreated: number;
  alreadyPresent: number;
  preflight: ExistingMatchOccurrencePreflightResult;
  applyResult: ExistingMatchOccurrenceApplyResult | null;
};

/**
 * explicit apply 境界。
 * apply !== true なら preflight のみ。
 * preflight は authorization ではない。write 時は transaction 内部で再 validation する。
 */
export function runExistingMatchOccurrenceAppend(input: {
  plans: ExistingMatchPlan[];
  db: ExistingMatchAppendDb;
  apply?: boolean;
}): ExistingMatchOccurrenceAppendRunResult {
  const preflight = runExistingMatchOccurrencePreflight(input.plans, {
    db: input.db,
  });
  if (input.apply !== true) {
    return {
      applyRequested: false,
      transactionStarted: false,
      occurrencesCreated: 0,
      alreadyPresent: 0,
      preflight,
      applyResult: null,
    };
  }
  if (preflight.status === "blocked") {
    return {
      applyRequested: true,
      transactionStarted: false,
      occurrencesCreated: 0,
      alreadyPresent: 0,
      preflight,
      applyResult: null,
    };
  }
  if (preflight.status === "no_op") {
    return {
      applyRequested: true,
      transactionStarted: false,
      occurrencesCreated: 0,
      alreadyPresent: preflight.alreadyPresent,
      preflight,
      applyResult: null,
    };
  }

  const applyResult = applyExistingMatchOccurrences(input.plans, {
    db: input.db,
  });
  return {
    applyRequested: true,
    transactionStarted: true,
    occurrencesCreated: applyResult.ok ? applyResult.occurrencesCreated : 0,
    alreadyPresent: applyResult.ok ? applyResult.alreadyPresent : 0,
    preflight,
    applyResult,
  };
}

export { readIncrementalRegistryCounts };
