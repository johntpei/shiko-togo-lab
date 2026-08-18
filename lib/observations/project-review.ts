import { parseStoredReviewPayload } from "@/lib/ai/review-schemas";
import type { ReviewRecord } from "@/lib/db/schema";
import { insertReview } from "@/lib/db/queries";
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

/**
 * Review を先に確定保存し、Observation は派生データとして後から投影する。
 * 投影失敗でも Review は残す。
 */
export function insertReviewAndProject(
  input: Parameters<typeof insertReview>[0],
): ReviewRecord {
  const record = insertReview(input);
  try {
    projectReviewToObservations({
      reviewId: record.id,
      promptVersion: record.promptVersion,
      payload: input.payload,
      sessionIds: input.sessionIds,
    });
  } catch (error) {
    console.error("observation projection failed", {
      reviewId: record.id,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
  return record;
}
