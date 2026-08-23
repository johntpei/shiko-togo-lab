import { and, eq } from "drizzle-orm";
import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import {
  conceptProcessingCheckpoints,
  sessions,
} from "@/lib/db/schema";

/** Incremental Session processing contract version. Not Prompt / Policy / model. */
export const CONCEPT_INCREMENTAL_PROCESSING_VERSION =
  "concept-incremental-processing-v1";

export type ConceptIncrementalProcessingVersion =
  typeof CONCEPT_INCREMENTAL_PROCESSING_VERSION;

export const INCREMENTAL_CONCEPT_PLANNING_COMPLETE_STATUSES = [
  "planned",
  "no_actions",
] as const;

export type IncrementalConceptPlanningCompleteStatus =
  (typeof INCREMENTAL_CONCEPT_PLANNING_COMPLETE_STATUSES)[number];

const BLOCKED_PLANNING_STATUSES = new Set([
  "blocked",
  "extractor_failed",
  "all_actions_grounding_rejected",
  "provenance_failure",
  "cross_session",
  "malformed_structured_output",
  "registry_failure",
]);

const USER_CONTENT_KEYS = [
  "surfaceForm",
  "canonicalLabel",
  "quote",
  "content",
  "message",
  "unitText",
  "evidence",
  "rawLlm",
  "raw",
] as const;

export type IncrementalConceptCompletionProof = {
  sessionId: string;
  processingVersion: string;
  planning: {
    status: IncrementalConceptPlanningCompleteStatus;
    existingMatchCount: number;
    newCandidateCount: number;
    provisionalNewCount: number;
    groundingRejectedCount: number;
  };
  existing: {
    completedCount: number;
  };
  newCandidates: {
    completedCount: number;
  };
};

export type IncrementalConceptCompletionValidation =
  | { ok: true; proof: IncrementalConceptCompletionProof }
  | { ok: false; code: string; detail: string };

export type IncrementalConceptCheckpointWrite =
  | {
      ok: true;
      status: "completed";
      sessionId: string;
      processingVersion: string;
      completedAt: string;
      existingMatchCount: number;
      newCandidateCount: number;
      provisionalNewCount: number;
      groundingRejectedCount: number;
    }
  | {
      ok: true;
      status: "already_completed";
      sessionId: string;
      processingVersion: string;
      completedAt: string;
      existingMatchCount: number;
      newCandidateCount: number;
      provisionalNewCount: number;
      groundingRejectedCount: number;
    }
  | { ok: false; code: string; detail: string };

function failValidation(
  code: string,
  detail: string,
): IncrementalConceptCompletionValidation {
  return { ok: false, code, detail };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function objectHasUserContent(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  for (const key of USER_CONTENT_KEYS) {
    if (key in value) {
      return key;
    }
  }
  return null;
}

function loadSessionRow(db: ConceptQueryDb, sessionId: string) {
  return (
    db.select().from(sessions).where(eq(sessions.id, sessionId)).get() ?? null
  );
}

function loadCheckpointRow(
  db: ConceptQueryDb,
  sessionId: string,
  processingVersion: string,
) {
  return (
    db
      .select()
      .from(conceptProcessingCheckpoints)
      .where(
        and(
          eq(conceptProcessingCheckpoints.sessionId, sessionId),
          eq(conceptProcessingCheckpoints.processingVersion, processingVersion),
        ),
      )
      .get() ?? null
  );
}

function isUniqueConstraintError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const message = "message" in error ? String(error.message) : "";
  return (
    message.includes("UNIQUE constraint failed") ||
    message.includes("PRIMARY KEY constraint failed") ||
    message.includes("concept_processing_checkpoints")
  );
}

/**
 * Server-owned completion proof. Planning success alone is not enough:
 * existing_match must be appended/already_present, NEW must finish Policy
 * (and ADMIT apply). provisional_new is deferred and does not block.
 */
export function validateIncrementalConceptCompletionProof(
  proof: unknown,
): IncrementalConceptCompletionValidation {
  if (!proof || typeof proof !== "object") {
    return failValidation("malformed_proof", "object");
  }
  const userKey = objectHasUserContent(proof);
  if (userKey) {
    return failValidation("user_content_forbidden", userKey);
  }

  const sessionId = (proof as { sessionId?: unknown }).sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return failValidation("malformed_proof", "sessionId");
  }

  const processingVersion = (proof as { processingVersion?: unknown })
    .processingVersion;
  if (typeof processingVersion !== "string" || !processingVersion.trim()) {
    return failValidation("malformed_proof", "processingVersion");
  }
  if (processingVersion !== CONCEPT_INCREMENTAL_PROCESSING_VERSION) {
    return failValidation("processing_version_mismatch", processingVersion);
  }

  const planning = (proof as { planning?: unknown }).planning;
  if (!planning || typeof planning !== "object") {
    return failValidation("malformed_proof", "planning");
  }
  const nestedUser = objectHasUserContent(planning);
  if (nestedUser) {
    return failValidation("user_content_forbidden", nestedUser);
  }

  const planningStatus = (planning as { status?: unknown }).status;
  if (typeof planningStatus !== "string") {
    return failValidation("malformed_proof", "planning.status");
  }
  if (BLOCKED_PLANNING_STATUSES.has(planningStatus)) {
    return failValidation("blocked_planning", planningStatus);
  }
  if (
    planningStatus !== "planned" &&
    planningStatus !== "no_actions"
  ) {
    return failValidation("blocked_planning", planningStatus);
  }

  const existingMatchCount = (planning as { existingMatchCount?: unknown })
    .existingMatchCount;
  const newCandidateCount = (planning as { newCandidateCount?: unknown })
    .newCandidateCount;
  const provisionalNewCount = (planning as { provisionalNewCount?: unknown })
    .provisionalNewCount;
  const groundingRejectedCount = (
    planning as { groundingRejectedCount?: unknown }
  ).groundingRejectedCount;
  if (!isNonNegativeInteger(existingMatchCount)) {
    return failValidation("malformed_proof", "existingMatchCount");
  }
  if (!isNonNegativeInteger(newCandidateCount)) {
    return failValidation("malformed_proof", "newCandidateCount");
  }
  if (!isNonNegativeInteger(provisionalNewCount)) {
    return failValidation("malformed_proof", "provisionalNewCount");
  }
  if (!isNonNegativeInteger(groundingRejectedCount)) {
    return failValidation("malformed_proof", "groundingRejectedCount");
  }

  const existing = (proof as { existing?: unknown }).existing;
  if (!existing || typeof existing !== "object") {
    return failValidation("malformed_proof", "existing");
  }
  const existingCompleted = (existing as { completedCount?: unknown })
    .completedCount;
  if (!isNonNegativeInteger(existingCompleted)) {
    return failValidation("malformed_proof", "existing.completedCount");
  }

  const newCandidates = (proof as { newCandidates?: unknown }).newCandidates;
  if (!newCandidates || typeof newCandidates !== "object") {
    return failValidation("malformed_proof", "newCandidates");
  }
  const newCompleted = (newCandidates as { completedCount?: unknown })
    .completedCount;
  if (!isNonNegativeInteger(newCompleted)) {
    return failValidation("malformed_proof", "newCandidates.completedCount");
  }

  if (planningStatus === "no_actions") {
    if (
      existingMatchCount !== 0 ||
      newCandidateCount !== 0 ||
      provisionalNewCount !== 0
    ) {
      return failValidation("no_actions_mismatch", "nonzero_planning_counts");
    }
  }

  if (existingCompleted !== existingMatchCount) {
    return failValidation(
      "existing_incomplete",
      `${existingCompleted}/${existingMatchCount}`,
    );
  }
  if (newCompleted !== newCandidateCount) {
    return failValidation(
      "new_incomplete",
      `${newCompleted}/${newCandidateCount}`,
    );
  }

  return {
    ok: true,
    proof: {
      sessionId,
      processingVersion,
      planning: {
        status: planningStatus,
        existingMatchCount,
        newCandidateCount,
        provisionalNewCount,
        groundingRejectedCount,
      },
      existing: { completedCount: existingCompleted },
      newCandidates: { completedCount: newCompleted },
    },
  };
}

export function hasIncrementalConceptProcessingCheckpoint(input: {
  sessionId: string;
  processingVersion: string;
  db: ConceptQueryDb;
}): boolean {
  return loadCheckpointRow(input.db, input.sessionId, input.processingVersion) !==
    null;
}

export function markIncrementalConceptSessionCompleted(
  proof: IncrementalConceptCompletionProof | unknown,
  input: { db: ConceptQueryDb; now?: string },
): IncrementalConceptCheckpointWrite {
  const validated = validateIncrementalConceptCompletionProof(proof);
  if (!validated.ok) {
    return { ok: false, code: validated.code, detail: validated.detail };
  }

  const session = loadSessionRow(input.db, validated.proof.sessionId);
  if (!session) {
    return {
      ok: false,
      code: "missing_session",
      detail: validated.proof.sessionId,
    };
  }

  const existing = loadCheckpointRow(
    input.db,
    validated.proof.sessionId,
    validated.proof.processingVersion,
  );
  if (existing) {
    return {
      ok: true,
      status: "already_completed",
      sessionId: existing.sessionId,
      processingVersion: existing.processingVersion,
      completedAt: existing.completedAt,
      existingMatchCount: existing.existingMatchCount,
      newCandidateCount: existing.newCandidateCount,
      provisionalNewCount: existing.provisionalNewCount,
      groundingRejectedCount: existing.groundingRejectedCount,
    };
  }

  const completedAt = input.now ?? new Date().toISOString();
  try {
    input.db
      .insert(conceptProcessingCheckpoints)
      .values({
        sessionId: validated.proof.sessionId,
        processingVersion: validated.proof.processingVersion,
        completedAt,
        existingMatchCount: validated.proof.planning.existingMatchCount,
        newCandidateCount: validated.proof.planning.newCandidateCount,
        provisionalNewCount: validated.proof.planning.provisionalNewCount,
        groundingRejectedCount: validated.proof.planning.groundingRejectedCount,
      })
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const raced = loadCheckpointRow(
        input.db,
        validated.proof.sessionId,
        validated.proof.processingVersion,
      );
      if (raced) {
        return {
          ok: true,
          status: "already_completed",
          sessionId: raced.sessionId,
          processingVersion: raced.processingVersion,
          completedAt: raced.completedAt,
          existingMatchCount: raced.existingMatchCount,
          newCandidateCount: raced.newCandidateCount,
          provisionalNewCount: raced.provisionalNewCount,
          groundingRejectedCount: raced.groundingRejectedCount,
        };
      }
    }
    throw error;
  }

  const inserted = loadCheckpointRow(
    input.db,
    validated.proof.sessionId,
    validated.proof.processingVersion,
  );
  if (!inserted) {
    return {
      ok: false,
      code: "checkpoint_insert_missing",
      detail: validated.proof.sessionId,
    };
  }

  return {
    ok: true,
    status: "completed",
    sessionId: inserted.sessionId,
    processingVersion: inserted.processingVersion,
    completedAt: inserted.completedAt,
    existingMatchCount: inserted.existingMatchCount,
    newCandidateCount: inserted.newCandidateCount,
    provisionalNewCount: inserted.provisionalNewCount,
    groundingRejectedCount: inserted.groundingRejectedCount,
  };
}
