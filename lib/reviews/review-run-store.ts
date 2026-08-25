import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db/client";
import {
  reviewProcessingRuns,
  type ReviewProcessingRunRecord,
} from "@/lib/db/schema";
import {
  INTEGRATED_REVIEW_PROCESSING_VERSION,
  SUPPORTED_INTEGRATED_REVIEW_PROCESSING_VERSIONS,
  type ReviewProcessingRunFailureStage,
  type ReviewProcessingRunPhase,
} from "./review-run-types";

type AppDb = ReturnType<typeof getDb>;
type AppTx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

export function insertReviewProcessingRunInTransaction(
  tx: AppTx,
  input: {
    reviewId: string;
    now: string;
    createRunId?: () => string;
  },
): string {
  const runId = (input.createRunId ?? (() => randomUUID()))();
  tx.insert(reviewProcessingRuns)
    .values({
      runId,
      reviewId: input.reviewId,
      processingVersion: INTEGRATED_REVIEW_PROCESSING_VERSION,
      phase: "review_saved",
      projectedObservationCount: null,
      lastFailureStage: null,
      lastFailureCode: null,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .run();
  return runId;
}

export function loadReviewProcessingRunByReviewId(input: {
  reviewId: string;
  processingVersion?: string;
  db: AppDb;
}): ReviewProcessingRunRecord | null {
  if (input.processingVersion) {
    return (
      input.db
        .select()
        .from(reviewProcessingRuns)
        .where(
          and(
            eq(reviewProcessingRuns.reviewId, input.reviewId),
            eq(reviewProcessingRuns.processingVersion, input.processingVersion),
          ),
        )
        .get() ?? null
    );
  }
  return listReviewProcessingRunsByReviewId(input).at(0) ?? null;
}

function processingVersionRank(version: string) {
  const rank = (
    SUPPORTED_INTEGRATED_REVIEW_PROCESSING_VERSIONS as readonly string[]
  ).indexOf(version);
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
}

export function listReviewProcessingRunsByReviewId(input: {
  reviewId: string;
  db: AppDb;
}): ReviewProcessingRunRecord[] {
  return input.db
      .select()
      .from(reviewProcessingRuns)
      .where(eq(reviewProcessingRuns.reviewId, input.reviewId))
      .all()
      .sort((left, right) => {
        const byVersion =
          processingVersionRank(left.processingVersion) -
          processingVersionRank(right.processingVersion);
        if (byVersion !== 0) {
          return byVersion;
        }
        const byUpdated = right.updatedAt.localeCompare(left.updatedAt);
        if (byUpdated !== 0) {
          return byUpdated;
        }
        return left.runId.localeCompare(right.runId);
      });
}

export function updateReviewProcessingRunPhase(input: {
  runId: string;
  phase: ReviewProcessingRunPhase;
  db: AppDb;
  now?: () => string;
  projectedObservationCount?: number | null;
  lastFailureStage?: ReviewProcessingRunFailureStage | null;
  lastFailureCode?: string | null;
}): void {
  const now = (input.now ?? (() => new Date().toISOString()))();
  input.db
    .update(reviewProcessingRuns)
    .set({
      phase: input.phase,
      updatedAt: now,
      projectedObservationCount: input.projectedObservationCount ?? null,
      lastFailureStage: input.lastFailureStage ?? null,
      lastFailureCode: input.lastFailureCode ?? null,
    })
    .where(eq(reviewProcessingRuns.runId, input.runId))
    .run();
}

export function countReviewProcessingRuns(db: AppDb): number {
  return db.select().from(reviewProcessingRuns).all().length;
}
