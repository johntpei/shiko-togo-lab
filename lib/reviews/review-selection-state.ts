import { eq } from "drizzle-orm";
import type { getDb } from "@/lib/db/client";
import { reviewSessions } from "@/lib/db/schema";
import { classifyReviewCompletionValidity } from "./review-completion-validity";
import { listReviewProcessingRunsByReviewId } from "./review-run-store";
import {
  normalizeReviewSelectionSessionIds,
  reviewSessionSetsEqual,
} from "./review-selection";

type AppDb = ReturnType<typeof getDb>;

export type ExactReviewSelectionState = {
  exactCompletedReviewIds: string[];
  exactPendingReviewIds: string[];
  exactLegacyUnknownReviewIds: string[];
};

function sortReviewIds(ids: readonly string[]): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

/**
 * Classify reviews whose review_sessions set exactly matches the selection.
 * Legacy reviews (no processing run) are never inferred complete from Observations.
 */
export function classifyExactReviewSelectionState(
  db: AppDb,
  selectedSessionIds: readonly string[],
): ExactReviewSelectionState {
  const selection = normalizeReviewSelectionSessionIds(selectedSessionIds);
  if (selection.length === 0) {
    return {
      exactCompletedReviewIds: [],
      exactPendingReviewIds: [],
      exactLegacyUnknownReviewIds: [],
    };
  }

  const reviewIds = db
    .selectDistinct({ reviewId: reviewSessions.reviewId })
    .from(reviewSessions)
    .all()
    .map((row) => row.reviewId);

  const exactCompletedReviewIds: string[] = [];
  const exactPendingReviewIds: string[] = [];
  const exactLegacyUnknownReviewIds: string[] = [];

  for (const reviewId of reviewIds) {
    const sessionRows = db
      .select({ sessionId: reviewSessions.sessionId })
      .from(reviewSessions)
      .where(eq(reviewSessions.reviewId, reviewId))
      .all()
      .map((row) => row.sessionId);
    if (!reviewSessionSetsEqual(sessionRows, selection)) {
      continue;
    }

    const runs = listReviewProcessingRunsByReviewId({ reviewId, db });
    if (runs.length === 0) {
      exactLegacyUnknownReviewIds.push(reviewId);
      continue;
    }

    const usableCompleted = runs.find(
      (run) =>
        run.phase === "projection_done" &&
        classifyReviewCompletionValidity({
          reviewId,
          processingVersion: run.processingVersion,
          db,
        }).usable,
    );
    if (usableCompleted) {
      exactCompletedReviewIds.push(reviewId);
      continue;
    }

    if (runs.some((run) => run.phase !== "projection_done")) {
      exactPendingReviewIds.push(reviewId);
    }
  }

  return {
    exactCompletedReviewIds: sortReviewIds(exactCompletedReviewIds),
    exactPendingReviewIds: sortReviewIds(exactPendingReviewIds),
    exactLegacyUnknownReviewIds: sortReviewIds(exactLegacyUnknownReviewIds),
  };
}

/**
 * Per-session union diagnostic: sessions appearing in any review_sessions row.
 */
export function listReviewCoveredSessionIds(
  db: AppDb,
  validSessionIds: readonly string[],
): string[] {
  const validSet = new Set(normalizeReviewSelectionSessionIds(validSessionIds));
  if (validSet.size === 0) {
    return [];
  }
  const covered = db
    .select({ sessionId: reviewSessions.sessionId })
    .from(reviewSessions)
    .all()
    .map((row) => row.sessionId)
    .filter((sessionId) => validSet.has(sessionId));
  return normalizeReviewSelectionSessionIds(covered);
}
