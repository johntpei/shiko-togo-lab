import { randomUUID } from "node:crypto";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  insertConceptOccurrence,
} from "@/lib/db/concept-queries";
import type { ExistingMatchPlan } from "./plan";
import {
  classifyExistingMatchOccurrencePlan,
  existingMatchOccurrenceIdentityKey,
  findExistingMatchOccurrenceByIdentity,
  type ExistingMatchAppendDb,
} from "./validate";

export type { ExistingMatchAppendDb };

export type ExistingMatchOccurrenceApplySuccess = {
  ok: true;
  transactionCommitted: true;
  occurrencesCreated: number;
  alreadyPresent: number;
  conflicts: 0;
};

export type ExistingMatchOccurrenceApplyFailure = {
  ok: false;
  transactionCommitted: false;
  occurrencesCreated: 0;
  alreadyPresent: 0;
  conflicts: number;
  code: string;
  detail: string;
};

export type ExistingMatchOccurrenceApplyResult =
  | ExistingMatchOccurrenceApplySuccess
  | ExistingMatchOccurrenceApplyFailure;

export type ApplyExistingMatchOccurrencesDeps = {
  db: ExistingMatchAppendDb;
  createOccurrenceId?: () => string;
};

class ExistingMatchAppendError extends Error {
  readonly code: string;
  readonly detail: string;

  constructor(code: string, detail: string) {
    super(`${code}:${detail}`);
    this.name = "ExistingMatchAppendError";
    this.code = code;
    this.detail = detail;
  }
}

function fail(
  error: ExistingMatchAppendError,
  conflicts: number,
): ExistingMatchOccurrenceApplyFailure {
  return {
    ok: false,
    transactionCommitted: false,
    occurrencesCreated: 0,
    alreadyPresent: 0,
    conflicts,
    code: error.code,
    detail: error.detail,
  };
}

/**
 * confirmed existing_match だけを既存 Concept へ Occurrence append する。
 * caller injected DB 必須。real DB を暗黙取得しない。
 * Concept / Alias の insert は呼ばない。
 * write 直前に classifyExistingMatchOccurrencePlan を再実行する。
 */
export function applyExistingMatchOccurrences(
  plans: ExistingMatchPlan[],
  deps: ApplyExistingMatchOccurrencesDeps,
): ExistingMatchOccurrenceApplyResult {
  const db = deps.db;
  const createOccurrenceId = deps.createOccurrenceId ?? (() => randomUUID());

  try {
    let occurrencesCreated = 0;
    let alreadyPresent = 0;
    const sqlite = db.$client;
    const run = sqlite.transaction(() => {
      const seen = new Map<string, ExistingMatchPlan>();
      for (const [index, plan] of plans.entries()) {
        const classified = classifyExistingMatchOccurrencePlan(
          plan,
          index,
          db,
          seen,
        );
        if (classified.status === "blocked") {
          throw new ExistingMatchAppendError(classified.code, classified.detail);
        }
        if (classified.status === "conflict") {
          throw new ExistingMatchAppendError(classified.code, classified.detail);
        }
        if (classified.status === "already_present") {
          seen.set(existingMatchOccurrenceIdentityKey(plan), plan);
          alreadyPresent += 1;
          continue;
        }

        const inserted = insertConceptOccurrence(
          {
            id: createOccurrenceId(),
            conceptId: plan.conceptId,
            sessionId: plan.provenance.sessionId,
            messageId: plan.provenance.messageId,
            evidenceRef: plan.provenance.evidenceRef,
            occurredAt: plan.provenance.occurredAt,
            sourceRole: plan.provenance.sourceRole,
            sourceType: plan.provenance.sourceType,
            extractionVersion: plan.provenance.extractionVersion,
          },
          db,
        );
        if (inserted.status !== "inserted") {
          if (inserted.reason === "duplicate_identity") {
            const raced = findExistingMatchOccurrenceByIdentity(db, plan);
            if (!raced) {
              throw new ExistingMatchAppendError(
                "occurrence_conflict",
                plan.candidateRef,
              );
            }
            const again = classifyExistingMatchOccurrencePlan(
              plan,
              index,
              db,
              seen,
            );
            if (again.status !== "already_present") {
              throw new ExistingMatchAppendError(
                again.status === "conflict" || again.status === "blocked"
                  ? again.code
                  : "occurrence_conflict",
                again.status === "insertable" ? plan.candidateRef : again.detail,
              );
            }
            seen.set(existingMatchOccurrenceIdentityKey(plan), plan);
            alreadyPresent += 1;
            continue;
          }
          throw new ExistingMatchAppendError(
            "occurrence_insert_skipped",
            `${plan.candidateRef}:${inserted.reason}:${inserted.detail ?? ""}`,
          );
        }
        if (inserted.record.occurredAt !== plan.provenance.occurredAt) {
          throw new ExistingMatchAppendError(
            "occurred_at_mismatch",
            plan.candidateRef,
          );
        }
        seen.set(existingMatchOccurrenceIdentityKey(plan), plan);
        occurrencesCreated += 1;
      }
    });
    run();

    return {
      ok: true,
      transactionCommitted: true,
      occurrencesCreated,
      alreadyPresent,
      conflicts: 0,
    };
  } catch (error) {
    if (error instanceof ExistingMatchAppendError) {
      return fail(error, error.code === "occurrence_conflict" ? 1 : 0);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      transactionCommitted: false,
      occurrencesCreated: 0,
      alreadyPresent: 0,
      conflicts: 0,
      code: "transaction_failed",
      detail,
    };
  }
}

export function readIncrementalRegistryCounts(db: ExistingMatchAppendDb) {
  return {
    concepts: countConcepts(db),
    conceptAliases: countConceptAliases(db),
    conceptOccurrences: countConceptOccurrences(db),
  };
}
