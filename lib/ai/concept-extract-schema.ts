import { z } from "zod";
import { MAX_PROPOSED_ALIASES } from "@/lib/concepts/actions";

export const CONCEPT_EXTRACT_SCHEMA_NAME = "concept_extract_v1";

const evidenceRefSchema = z.string().min(1);
const surfaceFormSchema = z.string();

export const conceptExtractMatchItemSchema = z.object({
  action: z.literal("match"),
  evidenceRef: evidenceRefSchema,
  surfaceForm: surfaceFormSchema,
  existingConceptRef: z.string().min(1),
});

export const conceptExtractNewItemSchema = z.object({
  action: z.literal("new"),
  evidenceRef: evidenceRefSchema,
  surfaceForm: surfaceFormSchema,
  proposedCanonicalLabel: z.string().min(1),
  aliases: z.array(z.string()).max(MAX_PROPOSED_ALIASES),
});

export const conceptExtractSkipItemSchema = z.object({
  action: z.literal("skip"),
  evidenceRef: evidenceRefSchema,
  surfaceForm: surfaceFormSchema,
});

export const conceptExtractUncertainItemSchema = z.object({
  action: z.literal("uncertain"),
  evidenceRef: evidenceRefSchema,
  surfaceForm: surfaceFormSchema,
});

export const conceptExtractItemSchema = z.discriminatedUnion("action", [
  conceptExtractMatchItemSchema,
  conceptExtractNewItemSchema,
  conceptExtractSkipItemSchema,
  conceptExtractUncertainItemSchema,
]);

export const conceptExtractOutputSchema = z.object({
  items: z.array(conceptExtractItemSchema),
});

export type ConceptExtractOutput = z.infer<typeof conceptExtractOutputSchema>;
