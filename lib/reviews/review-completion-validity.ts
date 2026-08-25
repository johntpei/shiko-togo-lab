import { eq } from "drizzle-orm";
import { parseStoredReviewPayload } from "@/lib/ai/review-schemas";
import type { getDb } from "@/lib/db/client";
import { evidences, observations, reviews } from "@/lib/db/schema";
import { INTEGRATED_REVIEW_PROCESSING_VERSION } from "./review-run-types";

type AppDb = ReturnType<typeof getDb>;

export type ReviewCompletionDurableFacts = {
  payloadParsed: boolean;
  semanticItemCount: number;
  semanticUsableItemCount: number;
  semanticInvalidItemCount: number;
  reviewEvidenceCount: number;
  observationCount: number;
};

export type ReviewCompletionValidityClassification =
  | "current_processing_completion"
  | "legacy_grounded_or_usable"
  | "legacy_genuine_empty"
  | "legacy_false_completion"
  | "legacy_ambiguous_preserved";

export type ReviewCompletionValidity = {
  usable: boolean;
  classification: ReviewCompletionValidityClassification;
  facts: ReviewCompletionDurableFacts;
};

function emptyFacts(): ReviewCompletionDurableFacts {
  return {
    payloadParsed: false,
    semanticItemCount: 0,
    semanticUsableItemCount: 0,
    semanticInvalidItemCount: 0,
    reviewEvidenceCount: 0,
    observationCount: 0,
  };
}

export function loadReviewCompletionDurableFacts(input: {
  reviewId: string;
  db: AppDb;
}): ReviewCompletionDurableFacts {
  const review = input.db
    .select({ payload: reviews.payload })
    .from(reviews)
    .where(eq(reviews.id, input.reviewId))
    .get();
  if (!review) {
    return emptyFacts();
  }

  const payload = parseStoredReviewPayload(review.payload);
  const items = payload
    ? [
        ...payload.commonThemes,
        ...payload.shifts,
        ...payload.tensions,
        ...payload.crossInsights,
        ...payload.hypotheses,
        ...payload.openQuestions,
        ...payload.nextQuestions,
      ]
    : [];
  const semanticUsableItemCount = items.filter(
    (item) => item.semanticValid !== false,
  ).length;
  const semanticInvalidItemCount = items.filter(
    (item) => item.semanticValid === false,
  ).length;

  return {
    payloadParsed: payload !== null,
    semanticItemCount: items.length,
    semanticUsableItemCount,
    semanticInvalidItemCount,
    reviewEvidenceCount: input.db
      .select({ id: evidences.id })
      .from(evidences)
      .where(eq(evidences.reviewId, input.reviewId))
      .all().length,
    observationCount: input.db
      .select({ id: observations.id })
      .from(observations)
      .where(eq(observations.sourceReviewId, input.reviewId))
      .all().length,
  };
}

/**
 * v2 completions are valid by construction. Historical completions are only
 * reopened for the conservative, fully durable false-completion signature.
 * Missing/invalid legacy detail is preserved as completed.
 */
export function classifyReviewCompletionValidity(input: {
  reviewId: string;
  processingVersion: string;
  db: AppDb;
}): ReviewCompletionValidity {
  const facts = loadReviewCompletionDurableFacts(input);
  if (input.processingVersion === INTEGRATED_REVIEW_PROCESSING_VERSION) {
    return {
      usable: true,
      classification: "current_processing_completion",
      facts,
    };
  }

  if (!facts.payloadParsed) {
    return {
      usable: true,
      classification: "legacy_ambiguous_preserved",
      facts,
    };
  }

  if (
    facts.semanticItemCount > 0 &&
    facts.semanticUsableItemCount === 0 &&
    facts.reviewEvidenceCount === 0 &&
    facts.observationCount === 0
  ) {
    return {
      usable: false,
      classification: "legacy_false_completion",
      facts,
    };
  }

  if (
    facts.semanticItemCount === 0 &&
    facts.reviewEvidenceCount === 0 &&
    facts.observationCount === 0
  ) {
    return {
      usable: true,
      classification: "legacy_genuine_empty",
      facts,
    };
  }

  if (
    facts.semanticUsableItemCount > 0 ||
    facts.reviewEvidenceCount > 0 ||
    facts.observationCount > 0
  ) {
    return {
      usable: true,
      classification: "legacy_grounded_or_usable",
      facts,
    };
  }

  return {
    usable: true,
    classification: "legacy_ambiguous_preserved",
    facts,
  };
}
