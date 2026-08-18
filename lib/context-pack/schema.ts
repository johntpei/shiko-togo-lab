import { z } from "zod";
import { CONTEXT_PACK_MAX_SOURCE_CHARS } from "@/lib/ai/limits";

export const CONTEXT_PACK_SUPPORT_TYPES = [
  "confirmed",
  "cross_session_interpretation",
  "hypothesis",
  "open_question",
] as const;

export type ContextPackSupportType =
  (typeof CONTEXT_PACK_SUPPORT_TYPES)[number];

export const CONTEXT_CANDIDATE_TYPES = [
  "current_context",
  "summary",
  "shift",
  "theme",
  "tension",
  "insight",
  "hypothesis",
  "open_question",
  "next_question",
  "decision",
  "user_fact",
] as const;

export type ContextCandidateType = (typeof CONTEXT_CANDIDATE_TYPES)[number];

export const contextPackEvidenceSchema = z.object({
  sessionId: z.string().nullable(),
  messageId: z.string().nullable(),
  sessionTitle: z.string().nullable().optional(),
  occurredAt: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  quote: z.string().optional(),
  validated: z.boolean().optional(),
});

export const storedContextPackItemSchema = z.object({
  sourceRef: z.string(),
  type: z.string(),
  text: z.string(),
  supportType: z.enum(CONTEXT_PACK_SUPPORT_TYPES),
  occurredAt: z.string().nullable().optional(),
  sourceReviewId: z.string().nullable().optional(),
  sourceSessionIds: z.array(z.string()).optional(),
  rationale: z.string().optional(),
  validationIdea: z.string().optional(),
  before: z.string().optional(),
  after: z.string().optional(),
  sideA: z.string().optional(),
  sideB: z.string().optional(),
  evidence: z.array(contextPackEvidenceSchema).optional(),
});

export const storedContextPackSelectedSchema = z.object({
  currentState: z.array(storedContextPackItemSchema),
  confirmedContext: z.array(storedContextPackItemSchema),
  crossSessionInsights: z.array(storedContextPackItemSchema),
  tensions: z.array(storedContextPackItemSchema),
  hypotheses: z.array(storedContextPackItemSchema),
  openQuestions: z.array(storedContextPackItemSchema),
});

export const storedContextPackPayloadSchema = z.object({
  currentQuestion: z.string(),
  selected: storedContextPackSelectedSchema,
  sourceRefs: z.array(z.string()),
  invalidSourceRefs: z
    .array(
      z.object({
        ref: z.string(),
        reason: z.literal("invalid_source_ref"),
      }),
    )
    .optional(),
  settings: z.object({
    provider: z.string(),
    store: z.literal(false),
    maxSourceChars: z.number(),
  }),
});

export type StoredContextPackItem = z.infer<typeof storedContextPackItemSchema>;
export type StoredContextPackPayload = z.infer<
  typeof storedContextPackPayloadSchema
>;

export const contextPackAiOutputSchema = z.object({
  currentState: z.array(z.string()),
  confirmedContext: z.array(z.string()),
  crossSessionInsights: z.array(z.string()),
  tensions: z.array(z.string()),
  hypotheses: z.array(z.string()),
  openQuestions: z.array(z.string()),
});

export type ContextPackAiOutput = z.infer<typeof contextPackAiOutputSchema>;

export function parseStoredContextPackPayload(
  raw: string,
): StoredContextPackPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = storedContextPackPayloadSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function defaultContextPackSettings(
  provider: string,
): StoredContextPackPayload["settings"] {
  return {
    provider,
    store: false,
    maxSourceChars: CONTEXT_PACK_MAX_SOURCE_CHARS,
  };
}

export type ContextCandidate = {
  ref: string;
  type: ContextCandidateType;
  text: string;
  supportType: ContextPackSupportType;
  sourceReviewId?: string;
  sourceSessionIds?: string[];
  occurredAt?: string | null;
  sessionTitle?: string | null;
  rationale?: string;
  validationIdea?: string;
  before?: string;
  after?: string;
  sideA?: string;
  sideB?: string;
  evidence?: StoredContextPackItem["evidence"];
};
