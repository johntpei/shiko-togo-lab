import { parseStoredReviewPayload } from "@/lib/ai/review-schemas";
import type { ReviewRecord } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { getReviewById, insertReview, listSessionsByReviewId } from "@/lib/db/queries";
import {
  loadReviewProcessingRunByReviewId,
  updateReviewProcessingRunPhase,
} from "@/lib/reviews/review-run-store";
import {
  createDbProjectStore,
  type ProjectReviewStore,
} from "@/lib/db/observation-queries";
import { reviewProjectionEligibility } from "@/lib/reviews/projection-eligibility";
import { fromReview } from "./from-review";
import type { Observation, ObservationSessionInput } from "./types";

export type ProjectReviewInput = {
  reviewId: string;
  promptVersion: string;
  payload: string | Parameters<typeof fromReview>[0]["payload"];
  sessions?: readonly ObservationSessionInput[];
  sessionIds?: string[];
  detectedAt?: string;
};

export type ProjectReviewResult =
  | {
      status: "projected";
      reviewId: string;
      inserted: number;
      skippedExisting: number;
      observationIds: string[];
    }
  | {
      status: "skipped";
      reason: "unsupported_review_version" | "invalid_payload";
      reviewId: string;
      promptVersion: string;
      inserted: 0;
      skippedExisting: 0;
      observationIds: [];
    };

function isUniqueConstraintError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  return (
    code.includes("CONSTRAINT") ||
    message.includes("UNIQUE constraint failed") ||
    message.includes("observations_source_identity_unique")
  );
}

function resolvePayload(payload: ProjectReviewInput["payload"]) {
  if (typeof payload === "string") {
    return parseStoredReviewPayload(payload);
  }
  return payload;
}

function existingSessionIds(
  requested: string[],
  store: ProjectReviewStore,
) {
  if (requested.length === 0) {
    return [];
  }
  const known = new Set(
    store.listSessionsByIds(requested).map((session) => session.id),
  );
  return requested.filter((id) => known.has(id));
}

function lookupSessions(
  input: ProjectReviewInput,
  store: ProjectReviewStore,
): ObservationSessionInput[] {
  if (input.sessions) {
    return [...input.sessions];
  }
  const ids = input.sessionIds ?? [];
  return store.listSessionsByIds(ids);
}

export function projectReviewToObservations(
  input: ProjectReviewInput,
  store: ProjectReviewStore = createDbProjectStore(),
  now: () => string = () => new Date().toISOString(),
): ProjectReviewResult {
  const eligibility = reviewProjectionEligibility(input.promptVersion);
  if (!eligibility.eligible) {
    return {
      status: "skipped",
      reason: "unsupported_review_version",
      reviewId: input.reviewId,
      promptVersion: input.promptVersion,
      inserted: 0,
      skippedExisting: 0,
      observationIds: [],
    };
  }

  const payload = resolvePayload(input.payload);
  if (!payload) {
    return {
      status: "skipped",
      reason: "invalid_payload",
      reviewId: input.reviewId,
      promptVersion: input.promptVersion,
      inserted: 0,
      skippedExisting: 0,
      observationIds: [],
    };
  }

  const detectedAt = input.detectedAt ?? now();
  const sessions = lookupSessions(input, store);
  const generated = fromReview({
    reviewId: input.reviewId,
    promptVersion: input.promptVersion,
    payload,
    sessions,
    detectedAt,
  });

  let inserted = 0;
  let skippedExisting = 0;
  const observationIds: string[] = [];

  for (const observation of generated) {
    const identity = {
      sourceReviewId: observation.sourceReviewId,
      sourceRef: observation.sourceRef,
      projectionVersion: observation.projectionVersion,
    };
    const existing = store.findObservationByIdentity(identity);
    if (existing) {
      skippedExisting += 1;
      observationIds.push(existing.id);
      continue;
    }

    const row = toInsertRow(observation, detectedAt, now(), store);
    try {
      store.insertObservation(row);
      inserted += 1;
      observationIds.push(row.id);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        skippedExisting += 1;
        continue;
      }
      throw error;
    }
  }

  return {
    status: "projected",
    reviewId: input.reviewId,
    inserted,
    skippedExisting,
    observationIds,
  };
}

function observationCountFromProjection(result: ProjectReviewResult): number {
  if (result.status === "projected") {
    return result.inserted + result.skippedExisting;
  }
  return 0;
}

function safeUpdateRunPhase(
  updateRunPhase: typeof updateReviewProcessingRunPhase,
  input: Parameters<typeof updateReviewProcessingRunPhase>[0],
) {
  try {
    updateRunPhase(input);
  } catch {
    // Phase is diagnostic; projection idempotency covers resume.
  }
}

export function projectPersistedReview(input: {
  reviewId: string;
  db: ReturnType<typeof getDb>;
  now?: () => string;
  updateRunPhase?: typeof updateReviewProcessingRunPhase;
}): {
  ok: true;
  projection: ProjectReviewResult;
  observationCount: number;
} | {
  ok: false;
  code: string;
  projection: ProjectReviewResult | null;
} {
  const review = getReviewById(input.reviewId, input.db);
  if (!review) {
    return { ok: false, code: "missing_review", projection: null };
  }
  const sessionIds = listSessionsByReviewId(review.id, input.db).map(
    (session) => session.id,
  );
  const nowFn = input.now ?? (() => new Date().toISOString());
  const updateRunPhase = input.updateRunPhase ?? updateReviewProcessingRunPhase;

  let projection: ProjectReviewResult;
  const store = createDbProjectStore(input.db);
  try {
    projection = projectReviewToObservations(
      {
        reviewId: review.id,
        promptVersion: review.promptVersion,
        payload: review.payload,
        sessionIds,
      },
      store,
      nowFn,
    );
  } catch (error) {
    const run = loadReviewProcessingRunByReviewId({
      reviewId: review.id,
      db: input.db,
    });
    if (run) {
      safeUpdateRunPhase(updateRunPhase, {
        runId: run.runId,
        phase: "review_saved",
        db: input.db,
        now: nowFn,
        lastFailureStage: "projection",
        lastFailureCode:
          error instanceof Error ? error.message : "projection_failed",
      });
    }
    throw error;
  }

  if (projection.status === "skipped") {
    return { ok: false, code: projection.reason, projection };
  }

  const observationCount = observationCountFromProjection(projection);
  const run = loadReviewProcessingRunByReviewId({
    reviewId: review.id,
    db: input.db,
  });
  if (run) {
    safeUpdateRunPhase(updateRunPhase, {
      runId: run.runId,
      phase: "projection_done",
      db: input.db,
      now: nowFn,
      projectedObservationCount: observationCount,
    });
  }

  return { ok: true, projection, observationCount };
}

function toInsertRow(
  observation: Observation,
  detectedAt: string,
  createdAt: string,
  store: ProjectReviewStore,
) {
  return {
    id: crypto.randomUUID(),
    kind: observation.kind,
    projectionVersion: observation.projectionVersion,
    sourceReviewId: observation.sourceReviewId,
    sourceRef: observation.sourceRef,
    title: observation.title,
    body: observation.body,
    supportType: observation.supportType ?? null,
    payload: JSON.stringify(observation.payload),
    firstSeenAt: observation.firstSeenAt,
    lastSeenAt: observation.lastSeenAt,
    detectedAt,
    distinctSessionCount: observation.distinctSessionCount,
    createdAt,
    sessionIds: existingSessionIds(observation.sessionIds, store),
  };
}

export function projectSavedReview(
  review: Pick<ReviewRecord, "id" | "promptVersion" | "payload">,
  sessions?: readonly ObservationSessionInput[],
  store?: ProjectReviewStore,
) {
  return projectReviewToObservations(
    {
      reviewId: review.id,
      promptVersion: review.promptVersion,
      payload: review.payload,
      sessions,
    },
    store,
  );
}

export function insertReviewAndProject(
  input: Parameters<typeof insertReview>[0],
): ReviewRecord {
  const record = insertReview(input);
  try {
    projectPersistedReview({
      reviewId: record.id,
      db: getDb(),
    });
  } catch (error) {
    console.error("observation projection failed", {
      reviewId: record.id,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
  return record;
}
