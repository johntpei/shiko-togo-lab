import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import {
  conceptIncrementalSessionRuns,
  type ConceptIncrementalSessionRunRecord,
} from "@/lib/db/schema";
import { CONCEPT_INCREMENTAL_PROCESSING_VERSION } from "./checkpoint";
import { INCREMENTAL_CONCEPT_SESSION_PROCESSOR_VERSION } from "./session-processor";
import type { IncrementalConceptSessionPreparedPayload } from "./session-run-payload";
import { serializePreparedPayload } from "./session-run-payload";
import {
  INCREMENTAL_CONCEPT_SESSION_RUN_VERSION,
  type IncrementalSessionRunFailureStage,
  type IncrementalSessionRunPhase,
} from "./session-run-types";

function isUniqueConstraintError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const message = "message" in error ? String(error.message) : "";
  return (
    message.includes("UNIQUE constraint failed") ||
    message.includes("concept_incremental_session_runs_session_processing_unique")
  );
}

export function loadIncrementalSessionRunBySession(
  input: {
    sessionId: string;
    processingVersion?: string;
    db: ConceptQueryDb;
  },
): ConceptIncrementalSessionRunRecord | null {
  const processingVersion =
    input.processingVersion ?? CONCEPT_INCREMENTAL_PROCESSING_VERSION;
  return (
    input.db
      .select()
      .from(conceptIncrementalSessionRuns)
      .where(
        and(
          eq(conceptIncrementalSessionRuns.sessionId, input.sessionId),
          eq(
            conceptIncrementalSessionRuns.processingVersion,
            processingVersion,
          ),
        ),
      )
      .get() ?? null
  );
}

export type InsertPreparedRunResult =
  | { ok: true; runId: string }
  | { ok: false; code: "unique_conflict" | "insert_failed"; detail?: string };

export function insertPreparedIncrementalSessionRun(input: {
  sessionId: string;
  payload: IncrementalConceptSessionPreparedPayload;
  db: ConceptQueryDb;
  now?: () => string;
  createRunId?: () => string;
}): InsertPreparedRunResult {
  const now = (input.now ?? (() => new Date().toISOString()))();
  const runId = (input.createRunId ?? (() => randomUUID()))();
  try {
    input.db
      .insert(conceptIncrementalSessionRuns)
      .values({
        runId,
        sessionId: input.sessionId,
        processingVersion: CONCEPT_INCREMENTAL_PROCESSING_VERSION,
        processorVersion: INCREMENTAL_CONCEPT_SESSION_PROCESSOR_VERSION,
        runVersion: INCREMENTAL_CONCEPT_SESSION_RUN_VERSION,
        phase: "prepared",
        preparedPayload: serializePreparedPayload(input.payload),
        lastFailureStage: null,
        lastFailureCode: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return { ok: true, runId };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { ok: false, code: "unique_conflict" };
    }
    return {
      ok: false,
      code: "insert_failed",
      detail: error instanceof Error ? error.message : "unknown",
    };
  }
}

export function updateIncrementalSessionRunPhase(input: {
  runId: string;
  phase: IncrementalSessionRunPhase;
  db: ConceptQueryDb;
  now?: () => string;
  lastFailureStage?: IncrementalSessionRunFailureStage | null;
  lastFailureCode?: string | null;
}): void {
  const now = (input.now ?? (() => new Date().toISOString()))();
  input.db
    .update(conceptIncrementalSessionRuns)
    .set({
      phase: input.phase,
      updatedAt: now,
      lastFailureStage: input.lastFailureStage ?? null,
      lastFailureCode: input.lastFailureCode ?? null,
    })
    .where(eq(conceptIncrementalSessionRuns.runId, input.runId))
    .run();
}

export function countIncrementalSessionRuns(db: ConceptQueryDb): number {
  return db.select().from(conceptIncrementalSessionRuns).all().length;
}
