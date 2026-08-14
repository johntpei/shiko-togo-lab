import { z } from "zod";
import { EVIDENCE_FAILURE_REASONS } from "./evidence";
import { EVIDENCE_ROLES } from "./evidence-units";
import { INTEGRATED_REVIEW_MAX_INPUT_CHARS } from "./limits";

export const REVIEW_SEMANTIC_FAILURE_REASONS = [
  "insufficient_distinct_sessions",
  "missing_user_evidence",
  "invalid_chronology",
  "invalid_evidence_ref",
  "evidence_role_mismatch",
  "unsupported_cross_session_claim",
] as const;

export type ReviewSemanticFailureReason =
  (typeof REVIEW_SEMANTIC_FAILURE_REASONS)[number];

const reviewItemSchema = z.object({
  text: z.string(),
  evidenceRefs: z.array(z.string()),
});

export const reviewShiftItemSchema = z.object({
  before: z.string(),
  after: z.string(),
  interpretation: z.string(),
  beforeEvidenceRefs: z.array(z.string()),
  afterEvidenceRefs: z.array(z.string()),
});

export const reviewHypothesisItemSchema = z.object({
  text: z.string(),
  rationale: z.string(),
  evidenceRefs: z.array(z.string()),
});

export const integratedReviewOutputSchema = z.object({
  summary: z.string(),
  commonThemes: z.array(reviewItemSchema),
  shifts: z.array(reviewShiftItemSchema),
  tensions: z.array(reviewItemSchema),
  crossInsights: z.array(reviewItemSchema),
  hypotheses: z.array(reviewItemSchema),
  openQuestions: z.array(reviewItemSchema),
  nextQuestions: z.array(reviewItemSchema),
});

export type IntegratedReviewOutput = z.infer<
  typeof integratedReviewOutputSchema
>;

export const integratedReviewV2OutputSchema = z.object({
  summary: z.string(),
  commonThemes: z.array(reviewItemSchema),
  shifts: z.array(reviewShiftItemSchema),
  tensions: z.array(reviewItemSchema),
  crossInsights: z.array(reviewItemSchema),
  hypotheses: z.array(reviewHypothesisItemSchema),
  openQuestions: z.array(reviewItemSchema),
  nextQuestions: z.array(reviewItemSchema),
});

export type IntegratedReviewV2Output = z.infer<
  typeof integratedReviewV2OutputSchema
>;

export const storedReviewEvidenceSchema = z.object({
  messageRef: z.string(),
  quote: z.string(),
  validated: z.boolean(),
  messageId: z.string().nullable(),
  sessionId: z.string().nullable().optional(),
  sessionTitle: z.string().nullable().optional(),
  occurredAt: z.string().nullable().optional(),
  role: z.enum(EVIDENCE_ROLES).nullable().optional(),
  reason: z.enum(EVIDENCE_FAILURE_REASONS).nullable().optional(),
});

const storedReviewItemBase = {
  text: z.string(),
  evidence: z.array(storedReviewEvidenceSchema),
  semanticValid: z.boolean().optional(),
  invalidReason: z.enum(REVIEW_SEMANTIC_FAILURE_REASONS).nullable().optional(),
  rationale: z.string().optional(),
};

export const storedReviewItemSchema = z.object(storedReviewItemBase);

export const storedReviewShiftItemSchema = z.object({
  ...storedReviewItemBase,
  before: z.string(),
  after: z.string(),
  interpretation: z.string(),
  beforeEvidence: z.array(storedReviewEvidenceSchema),
  afterEvidence: z.array(storedReviewEvidenceSchema),
});

export const storedReviewPayloadSchema = z.object({
  summary: z.string(),
  commonThemes: z.array(storedReviewItemSchema),
  shifts: z.array(storedReviewShiftItemSchema),
  tensions: z.array(storedReviewItemSchema),
  crossInsights: z.array(storedReviewItemSchema),
  hypotheses: z.array(storedReviewItemSchema),
  openQuestions: z.array(storedReviewItemSchema),
  nextQuestions: z.array(storedReviewItemSchema),
  settings: z.object({
    provider: z.string(),
    store: z.literal(false),
    maxInputChars: z.number(),
  }),
  metrics: z
    .object({
      evidenceCount: z.number(),
      validatedCount: z.number(),
      validationRate: z.number(),
      semanticItemCount: z.number().optional(),
      semanticValidCount: z.number().optional(),
      semanticValidationRate: z.number().optional(),
      sessionCount: z.number().optional(),
    })
    .optional(),
});

export type StoredReviewPayload = z.infer<typeof storedReviewPayloadSchema>;
export type StoredReviewItem = z.infer<typeof storedReviewItemSchema>;
export type StoredReviewShiftItem = z.infer<typeof storedReviewShiftItemSchema>;
export type StoredReviewEvidence = z.infer<typeof storedReviewEvidenceSchema>;

export function parseStoredReviewPayload(
  raw: string,
): StoredReviewPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = storedReviewPayloadSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function defaultReviewSettings(provider: string): StoredReviewPayload["settings"] {
  return {
    provider,
    store: false,
    maxInputChars: INTEGRATED_REVIEW_MAX_INPUT_CHARS,
  };
}
