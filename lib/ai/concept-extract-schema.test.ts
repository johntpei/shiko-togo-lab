import assert from "node:assert/strict";
import test from "node:test";
import { CONCEPT_EXTRACT_SCHEMA_NAME, conceptExtractOutputSchema } from "./concept-extract-schema";

test("schema name は concept_extract_v3 のまま", () => {
  assert.equal(CONCEPT_EXTRACT_SCHEMA_NAME, "concept_extract_v3");
});

test("extracted / skip / uncertain を Unit 単位で受け付ける", () => {
  const parsed = conceptExtractOutputSchema.safeParse({
    units: [
      {
        evidenceRef: "M001:E01",
        disposition: "extracted",
        concepts: [
          {
            action: "match",
            surfaceForm: "高性能AI",
            existingConceptRef: "C01",
          },
          {
            action: "new",
            surfaceForm: "距離感",
          },
        ],
      },
      {
        evidenceRef: "M001:E02",
        disposition: "skip",
        concepts: [],
      },
      {
        evidenceRef: "M003:E01",
        disposition: "uncertain",
        concepts: [],
      },
    ],
  });
  assert.equal(parsed.success, true);
});

test("NEW は surfaceForm のみ。canonical / aliases を要求しない", () => {
  const parsed = conceptExtractOutputSchema.safeParse({
    units: [
      {
        evidenceRef: "M001:E01",
        disposition: "extracted",
        concepts: [
          {
            action: "new",
            surfaceForm: "高性能AI",
          },
        ],
      },
    ],
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    const concept = parsed.data.units[0]?.concepts[0];
    assert.equal(concept && "proposedCanonicalLabel" in concept, false);
    assert.equal(concept && "aliases" in concept, false);
  }
});

test("extracted は最大3 Concept。旧 items 形式は拒否する", () => {
  const tooManyConcepts = conceptExtractOutputSchema.safeParse({
    units: [
      {
        evidenceRef: "M001:E01",
        disposition: "extracted",
        concepts: [
          { action: "new", surfaceForm: "a" },
          { action: "new", surfaceForm: "b" },
          { action: "new", surfaceForm: "c" },
          { action: "new", surfaceForm: "d" },
        ],
      },
    ],
  });
  assert.equal(tooManyConcepts.success, false);
  assert.equal(
    conceptExtractOutputSchema.safeParse({
      items: [{ action: "skip", evidenceRef: "M001:E01", surfaceForm: "x" }],
    }).success,
    false,
  );
});

test("不正 schema は拒否する", () => {
  assert.equal(
    conceptExtractOutputSchema.safeParse({ units: "nope" }).success,
    false,
  );
  assert.equal(
    conceptExtractOutputSchema.safeParse({
      units: [{ evidenceRef: "M001:E01", disposition: "merge", concepts: [] }],
    }).success,
    false,
  );
  assert.equal(
    conceptExtractOutputSchema.safeParse({
      units: [
        {
          evidenceRef: "M001:E01",
          disposition: "extracted",
          concepts: [
            {
              action: "match",
              surfaceForm: "高性能AI",
            },
          ],
        },
      ],
    }).success,
    false,
  );
});
