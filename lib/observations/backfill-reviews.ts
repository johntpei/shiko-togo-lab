import {
  createDbProjectStore,
  type ProjectReviewStore,
} from "@/lib/db/observation-queries";
import { projectSavedReview } from "./project-review";

export type BackfillReviewSource = {
  id: string;
  promptVersion: string;
  payload: string;
  sessions: Array<{ id: string; occurredAt: string }>;
};

export type BackfillObservationsResult = {
  considered: number;
  projected: number;
  skippedUnsupported: number;
  skippedInvalidPayload: number;
  inserted: number;
  skippedExisting: number;
};

export function backfillObservationsFromReviews(
  reviews: BackfillReviewSource[],
  store: ProjectReviewStore = createDbProjectStore(),
): BackfillObservationsResult {
  const result: BackfillObservationsResult = {
    considered: 0,
    projected: 0,
    skippedUnsupported: 0,
    skippedInvalidPayload: 0,
    inserted: 0,
    skippedExisting: 0,
  };

  for (const review of reviews) {
    result.considered += 1;
    const projected = projectSavedReview(review, review.sessions, store);
    if (projected.status === "skipped") {
      if (projected.reason === "unsupported_review_version") {
        result.skippedUnsupported += 1;
      } else {
        result.skippedInvalidPayload += 1;
      }
      continue;
    }
    result.projected += 1;
    result.inserted += projected.inserted;
    result.skippedExisting += projected.skippedExisting;
  }

  return result;
}
