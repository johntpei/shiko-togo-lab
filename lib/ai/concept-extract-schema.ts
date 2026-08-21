import { z } from "zod";
import { MAX_CONCEPTS_PER_UNIT } from "@/lib/concepts/actions";

export const CONCEPT_EXTRACT_SCHEMA_NAME = "concept_extract_v3";

const evidenceRefSchema = z.string().min(1);
const surfaceFormSchema = z.string();

export const conceptExtractMatchConceptSchema = z.object({
  action: z.literal("match"),
  surfaceForm: surfaceFormSchema,
  existingConceptRef: z.string().min(1),
});

export const conceptExtractNewConceptSchema = z.object({
  action: z.literal("new"),
  surfaceForm: surfaceFormSchema,
});

export const conceptExtractConceptSchema = z.discriminatedUnion("action", [
  conceptExtractMatchConceptSchema,
  conceptExtractNewConceptSchema,
]);

export const conceptExtractUnitResultSchema = z.object({
  evidenceRef: evidenceRefSchema,
  disposition: z.enum(["extracted", "skip", "uncertain"]),
  concepts: z.array(conceptExtractConceptSchema).max(MAX_CONCEPTS_PER_UNIT),
});

export const conceptExtractOutputSchema = z.object({
  units: z.array(conceptExtractUnitResultSchema),
});

export type ConceptExtractOutput = z.infer<typeof conceptExtractOutputSchema>;
