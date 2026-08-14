import { z } from "zod";
import { EVIDENCE_FAILURE_REASONS } from "./evidence";
import { REVIEW_RELATION_TYPES } from "./evidence-groups";
import { EVIDENCE_ROLES } from "./evidence-units";
import { INTEGRATED_REVIEW_MAX_INPUT_CHARS } from "./limits";

export const REVIEW_SEMANTIC_FAILURE_REASONS = [
  "insufficient_distinct_sessions",
  "missing_user_evidence",
  "invalid_chronology",
  "invalid_evidence_ref",
  "evidence_role_mismatch",
  "unsupported_cross_session_claim",
  "domain_leap",
  "unrelated_interpretation",
  "generic_interpretation",
  "unsupported_exaggeration",
  "weak_next_question",
  "duplicate_interpretation",
] as const;

export type ReviewSemanticFailureReason =
  (typeof REVIEW_SEMANTIC_FAILURE_REASONS)[number];

export const REVIEW_SUPPORT_TYPES = [
  "direct",
  "cross_session_interpretation",
  "hypothesis",
] as const;

export type ReviewSupportType = (typeof REVIEW_SUPPORT_TYPES)[number];

export const REVIEW_GUARD_TYPES = ["hard", "interpretation"] as const;

export type ReviewGuardType = (typeof REVIEW_GUARD_TYPES)[number];

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

export const reviewHypothesisV3ItemSchema = z.object({
  text: z.string(),
  rationale: z.string(),
  validationIdea: z.string(),
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

export const integratedReviewV3OutputSchema = z.object({
  summary: z.string(),
  commonThemes: z.array(reviewItemSchema),
  shifts: z.array(reviewShiftItemSchema),
  tensions: z.array(reviewItemSchema),
  crossInsights: z.array(reviewItemSchema),
  hypotheses: z.array(reviewHypothesisV3ItemSchema),
  openQuestions: z.array(reviewItemSchema),
  nextQuestions: z.array(reviewItemSchema),
});

export type IntegratedReviewV3Output = z.infer<
  typeof integratedReviewV3OutputSchema
>;

export const integratedReviewV4OutputSchema = integratedReviewV3OutputSchema;

export type IntegratedReviewV4Output = IntegratedReviewV3Output;

export const reviewEvidenceGroupSchema = z.object({
  sessionRef: z.string(),
  evidenceRefs: z.array(z.string()),
});

export const reviewTensionSideSchema = z.object({
  text: z.string(),
  evidenceRefs: z.array(z.string()),
});

const groupedReviewItemSchema = z.object({
  text: z.string(),
  relationType: z.enum(REVIEW_RELATION_TYPES),
  evidenceGroups: z.array(reviewEvidenceGroupSchema),
  evidenceRefs: z.array(z.string()),
});

export const reviewHypothesisV5ItemSchema = z.object({
  text: z.string(),
  rationale: z.string(),
  validationIdea: z.string(),
  relationType: z.enum(REVIEW_RELATION_TYPES),
  evidenceGroups: z.array(reviewEvidenceGroupSchema),
  evidenceRefs: z.array(z.string()),
});

export const reviewTensionV5ItemSchema = z.object({
  text: z.string(),
  relationType: z.enum(REVIEW_RELATION_TYPES),
  sideA: reviewTensionSideSchema,
  sideB: reviewTensionSideSchema,
  evidenceGroups: z.array(reviewEvidenceGroupSchema),
  evidenceRefs: z.array(z.string()),
});

export const integratedReviewV5OutputSchema = z.object({
  summary: z.string(),
  commonThemes: z.array(groupedReviewItemSchema),
  shifts: z.array(reviewShiftItemSchema),
  tensions: z.array(reviewTensionV5ItemSchema),
  crossInsights: z.array(groupedReviewItemSchema),
  hypotheses: z.array(reviewHypothesisV5ItemSchema),
  openQuestions: z.array(reviewItemSchema),
  nextQuestions: z.array(reviewItemSchema),
});

export type IntegratedReviewV5Output = z.infer<
  typeof integratedReviewV5OutputSchema
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
  validationIdea: z.string().optional(),
  supportType: z.enum(REVIEW_SUPPORT_TYPES).optional(),
  guardType: z.enum(REVIEW_GUARD_TYPES).optional(),
  relationType: z.enum(REVIEW_RELATION_TYPES).optional(),
  distinctSessionCount: z.number().optional(),
  sideA: z
    .object({
      text: z.string(),
      evidence: z.array(storedReviewEvidenceSchema),
    })
    .optional(),
  sideB: z
    .object({
      text: z.string(),
      evidence: z.array(storedReviewEvidenceSchema),
    })
    .optional(),
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
      hardItemCount: z.number().optional(),
      hardValidCount: z.number().optional(),
      hardValidationRate: z.number().optional(),
      hardExcludedCount: z.number().optional(),
      interpretationItemCount: z.number().optional(),
      interpretationValidCount: z.number().optional(),
      interpretationValidationRate: z.number().optional(),
      interpretationExcludedCount: z.number().optional(),
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
