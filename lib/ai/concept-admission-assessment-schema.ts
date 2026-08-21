import { z } from "zod";
import {
  CONCEPT_FORMS,
  EVIDENCE_ROLES,
  LONGITUDINAL_POTENTIALS,
} from "@/lib/concepts/admission/assessment-types";

export const CONCEPT_ADMISSION_ASSESSMENT_SCHEMA_NAME =
  "concept_admission_assessment_v2";

export const conceptAssessmentItemSchema = z
  .object({
    candidateRef: z.string().min(1),
    conceptForm: z.enum(CONCEPT_FORMS),
    evidenceRole: z.enum(EVIDENCE_ROLES),
    longitudinalPotential: z.enum(LONGITUDINAL_POTENTIALS),
  })
  .strict();

export const conceptAssessmentOutputSchema = z.object({
  assessments: z.array(conceptAssessmentItemSchema),
});

export type ConceptAssessmentOutput = z.infer<
  typeof conceptAssessmentOutputSchema
>;
