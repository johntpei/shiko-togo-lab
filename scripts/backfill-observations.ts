import { listReviews, listSessionsByReviewId } from "@/lib/db/queries";
import { backfillObservationsFromReviews } from "@/lib/observations/backfill-reviews";

const reviews = listReviews().map((review) => ({
  id: review.id,
  promptVersion: review.promptVersion,
  payload: review.payload,
  sessions: listSessionsByReviewId(review.id).map((session) => ({
    id: session.id,
    occurredAt: session.occurredAt,
  })),
}));

const result = backfillObservationsFromReviews(reviews);
console.log(
  JSON.stringify(
    {
      considered: result.considered,
      projected: result.projected,
      skippedUnsupported: result.skippedUnsupported,
      skippedInvalidPayload: result.skippedInvalidPayload,
      inserted: result.inserted,
      skippedExisting: result.skippedExisting,
    },
    null,
    2,
  ),
);
