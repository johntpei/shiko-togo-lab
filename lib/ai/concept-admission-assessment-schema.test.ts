import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCEPT_ADMISSION_ASSESSMENT_SCHEMA_NAME,
  conceptAssessmentOutputSchema,
} from "./concept-admission-assessment-schema";
import { CONCEPT_ADMISSION_SCHEMA_NAME } from "./concept-admission-schema";

test("schema name は concept_admission_assessment_v2", () => {
  assert.equal(
    CONCEPT_ADMISSION_ASSESSMENT_SCHEMA_NAME,
    "concept_admission_assessment_v2",
  );
  assert.equal(CONCEPT_ADMISSION_SCHEMA_NAME, "concept_admission_v1");
});

test("assessment item は candidateRef + 3 enum だけ", () => {
  const parsed = conceptAssessmentOutputSchema.safeParse({
    assessments: [
      {
        candidateRef: "C80",
        conceptForm: "specific_named_concept",
        evidenceRole: "central",
        longitudinalPotential: "high",
      },
    ],
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) {
    return;
  }
  const item = parsed.data.assessments[0];
  assert.deepEqual(Object.keys(item ?? {}), [
    "candidateRef",
    "conceptForm",
    "evidenceRole",
    "longitudinalPotential",
  ]);
});

test("extra fields と decision を拒否する", () => {
  assert.equal(
    conceptAssessmentOutputSchema.safeParse({
      assessments: [
        {
          candidateRef: "C80",
          conceptForm: "stable_topic",
          evidenceRole: "central",
          longitudinalPotential: "high",
          decision: "admit",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    conceptAssessmentOutputSchema.safeParse({
      assessments: [
        {
          candidateRef: "C80",
          conceptForm: "stable_topic",
          evidenceRole: "central",
          longitudinalPotential: "high",
          canonicalLabel: "自己理解",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    conceptAssessmentOutputSchema.safeParse({
      decisions: [
        {
          candidateRef: "C80",
          decision: "admit",
          reasonCode: "stable_topic",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    conceptAssessmentOutputSchema.safeParse({
      assessments: [
        {
          candidateRef: "C80",
          conceptForm: "generic",
          evidenceRole: "central",
          longitudinalPotential: "high",
        },
      ],
    }).success,
    false,
  );
});
