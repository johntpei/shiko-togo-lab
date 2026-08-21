import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCEPT_ADMISSION_SCHEMA_NAME,
  conceptAdmissionOutputSchema,
} from "./concept-admission-schema";

test("schema name は concept_admission_v1", () => {
  assert.equal(CONCEPT_ADMISSION_SCHEMA_NAME, "concept_admission_v1");
});

test("decision item は candidateRef / decision / reasonCode だけ", () => {
  const parsed = conceptAdmissionOutputSchema.safeParse({
    decisions: [
      {
        candidateRef: "C20",
        decision: "admit",
        reasonCode: "longitudinal_value",
      },
      { candidateRef: "C31", decision: "reject", reasonCode: "generic" },
      {
        candidateRef: "C22",
        decision: "defer",
        reasonCode: "insufficient_context",
      },
    ],
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) {
    return;
  }
  const item = parsed.data.decisions[0];
  assert.equal(item && "canonicalLabel" in item, false);
  assert.equal(item && "surfaceForm" in item, false);
  assert.equal(item && "aliases" in item, false);
});

test("label や未知 enum は拒否する", () => {
  assert.equal(
    conceptAdmissionOutputSchema.safeParse({
      decisions: [
        {
          candidateRef: "C20",
          decision: "admit",
          reasonCode: "longitudinal_value",
          canonicalLabel: "人間関係",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    conceptAdmissionOutputSchema.safeParse({
      decisions: [{ candidateRef: "C20", decision: "keep", reasonCode: "generic" }],
    }).success,
    false,
  );
  assert.equal(
    conceptAdmissionOutputSchema.safeParse({
      items: [{ candidateRef: "C20", decision: "admit", reasonCode: "stable_topic" }],
    }).success,
    false,
  );
});
