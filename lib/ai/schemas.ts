import { z } from "zod";
import { EVIDENCE_FAILURE_REASONS } from "./evidence";
import { EVIDENCE_ROLES } from "./evidence-units";
import { ANALYZE_SESSION_MAX_INPUT_CHARS } from "./limits";

export const ANALYSIS_KINDS = [
  "fact",
  "insight",
  "hypothesis",
  "decision",
  "open_question",
  "action",
] as const;

export type AnalysisKind = (typeof ANALYSIS_KINDS)[number];

export const ANALYSIS_SUBJECTS = [
  "user",
  "conversation",
  "external",
  "interpretation",
] as const;

export type AnalysisSubject = (typeof ANALYSIS_SUBJECTS)[number];

export const SEMANTIC_FAILURE_REASONS = [
  "missing_user_evidence",
  "invalid_evidence_ref",
  "evidence_role_mismatch",
  "unsupported_subject_kind",
] as const;

export type SemanticFailureReason = (typeof SEMANTIC_FAILURE_REASONS)[number];

export const analysisEvidenceSchema = z.object({
  messageRef: z.string(),
  quote: z.string(),
});

export const analysisItemSchema = z.object({
  kind: z.enum(ANALYSIS_KINDS),
  text: z.string(),
  evidence: z.array(analysisEvidenceSchema),
});

export const sessionAnalysisOutputSchema = z.object({
  summary: z.string(),
  items: z.array(analysisItemSchema),
});

export type SessionAnalysisOutput = z.infer<typeof sessionAnalysisOutputSchema>;

export const sessionAnalysisV3ItemSchema = z.object({
  kind: z.enum(ANALYSIS_KINDS),
  text: z.string(),
  evidenceRefs: z.array(z.string()),
});

export const sessionAnalysisV3OutputSchema = z.object({
  summary: z.string(),
  items: z.array(sessionAnalysisV3ItemSchema),
});

export type SessionAnalysisV3Output = z.infer<
  typeof sessionAnalysisV3OutputSchema
>;

export const sessionAnalysisV4ItemSchema = z.object({
  kind: z.enum(ANALYSIS_KINDS),
  subject: z.enum(ANALYSIS_SUBJECTS),
  text: z.string(),
  evidenceRefs: z.array(z.string()),
});

export const sessionAnalysisV4OutputSchema = z.object({
  summary: z.string(),
  items: z.array(sessionAnalysisV4ItemSchema),
});

export type SessionAnalysisV4Output = z.infer<
  typeof sessionAnalysisV4OutputSchema
>;

export const storedEvidenceSchema = z.object({
  messageRef: z.string(),
  quote: z.string(),
  validated: z.boolean(),
  messageId: z.string().nullable(),
  reason: z.enum(EVIDENCE_FAILURE_REASONS).nullable().optional(),
  role: z.enum(EVIDENCE_ROLES).nullable().optional(),
});

export const storedAnalysisItemSchema = z.object({
  kind: z.enum(ANALYSIS_KINDS),
  text: z.string(),
  evidence: z.array(storedEvidenceSchema),
  unsupportedClaim: z.boolean().optional(),
  subject: z.enum(ANALYSIS_SUBJECTS).optional(),
  semanticValid: z.boolean().optional(),
  invalidReason: z.enum(SEMANTIC_FAILURE_REASONS).nullable().optional(),
});

export const storedAnalysisPayloadSchema = z.object({
  summary: z.string(),
  items: z.array(storedAnalysisItemSchema),
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
    })
    .optional(),
});

export type StoredAnalysisPayload = z.infer<typeof storedAnalysisPayloadSchema>;

export function parseStoredAnalysisPayload(
  raw: string,
): StoredAnalysisPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = storedAnalysisPayloadSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function defaultAnalysisSettings(provider: string): StoredAnalysisPayload["settings"] {
  return {
    provider,
    store: false,
    maxInputChars: ANALYZE_SESSION_MAX_INPUT_CHARS,
  };
}
