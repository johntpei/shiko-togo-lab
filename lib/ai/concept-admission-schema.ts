import { z } from "zod";
import {
  ADMISSION_DECISIONS,
  ADMISSION_REASON_CODES,
} from "@/lib/concepts/admission/types";

export const CONCEPT_ADMISSION_SCHEMA_NAME = "concept_admission_v1";

export const conceptAdmissionDecisionItemSchema = z
  .object({
    candidateRef: z.string().min(1),
    decision: z.enum(ADMISSION_DECISIONS),
    reasonCode: z.enum(ADMISSION_REASON_CODES),
  })
  .strict();

export const conceptAdmissionOutputSchema = z.object({
  decisions: z.array(conceptAdmissionDecisionItemSchema),
});

export type ConceptAdmissionOutput = z.infer<
  typeof conceptAdmissionOutputSchema
>;
