import assert from "node:assert/strict";
import test from "node:test";
import { conceptExtractOutputSchema } from "./concept-extract-schema";

test("MATCH / NEW / SKIP / UNCERTAIN を受け付ける", () => {
  const parsed = conceptExtractOutputSchema.safeParse({
    items: [
      {
        action: "match",
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        existingConceptRef: "C01",
      },
      {
        action: "new",
        evidenceRef: "M003:E01",
        surfaceForm: "距離感",
        proposedCanonicalLabel: "距離感",
        aliases: ["対人距離"],
      },
      {
        action: "skip",
        evidenceRef: "M003:E01",
        surfaceForm: "方法",
      },
      {
        action: "uncertain",
        evidenceRef: "M003:E01",
        surfaceForm: "それ",
      },
    ],
  });
  assert.equal(parsed.success, true);
});

test("aliases は最大2件。3件は拒否する", () => {
  const ok = conceptExtractOutputSchema.safeParse({
    items: [
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        proposedCanonicalLabel: "AI性能",
        aliases: ["高性能AI", "AIの性能"],
      },
    ],
  });
  assert.equal(ok.success, true);

  const tooMany = conceptExtractOutputSchema.safeParse({
    items: [
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        proposedCanonicalLabel: "AI性能",
        aliases: ["a", "b", "c"],
      },
    ],
  });
  assert.equal(tooMany.success, false);
});

test("不正 schema は拒否する", () => {
  assert.equal(
    conceptExtractOutputSchema.safeParse({ items: "nope" }).success,
    false,
  );
  assert.equal(
    conceptExtractOutputSchema.safeParse({
      items: [{ action: "merge", evidenceRef: "M001:E01", surfaceForm: "x" }],
    }).success,
    false,
  );
  assert.equal(
    conceptExtractOutputSchema.safeParse({
      items: [
        {
          action: "match",
          evidenceRef: "M001:E01",
          surfaceForm: "高性能AI",
        },
      ],
    }).success,
    false,
  );
});
