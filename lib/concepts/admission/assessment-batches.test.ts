import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSESSMENT_BATCH_TARGET_SIZE,
  balancedBatchSizes,
  partitionAssessmentBatches,
  sortCandidatesForAssessment,
} from "./assessment-batches";
import type { AdmissionCandidate } from "./types";

function candidate(ref: string): AdmissionCandidate {
  return {
    candidateRef: ref,
    canonicalLabel: ref,
    normalizedKey: ref,
    occurrenceCount: 1,
    distinctSessionCount: 1,
    firstSeenAt: "",
    lastSeenAt: "",
    sessionIds: ["s"],
    evidenceRefs: ["M001:E01"],
    suspiciousFlags: [],
    matchKindsSeen: ["new"],
    representativeEvidence: [],
    provisionalHints: [],
  };
}

test("batch size は target 6 で 1件尾を避ける", () => {
  assert.equal(ASSESSMENT_BATCH_TARGET_SIZE, 6);
  assert.deepEqual(balancedBatchSizes(0), []);
  assert.deepEqual(balancedBatchSizes(1), [1]);
  assert.deepEqual(balancedBatchSizes(7), [7]);
  assert.deepEqual(balancedBatchSizes(8), [8]);
  assert.deepEqual(balancedBatchSizes(12), [6, 6]);
  const sizes43 = balancedBatchSizes(43);
  assert.equal(sizes43.reduce((sum, size) => sum + size, 0), 43);
  assert.equal(sizes43.includes(1), false);
  assert.ok(sizes43.every((size) => size >= 5 && size <= 7));
});

test("partition は決定論的で各 Candidate が正確に1 batch", () => {
  const items = Array.from({ length: 43 }, (_, index) =>
    candidate(`C${String(index + 1).padStart(2, "0")}`),
  );
  const first = partitionAssessmentBatches(items);
  const second = partitionAssessmentBatches([...items].reverse());
  assert.deepEqual(
    first.map((batch) => batch.candidateRefs),
    second.map((batch) => batch.candidateRefs),
  );
  const refs = first.flatMap((batch) => batch.candidateRefs);
  assert.equal(refs.length, 43);
  assert.equal(new Set(refs).size, 43);
  assert.ok(first.every((batch) => batch.candidates.length >= 5));
  assert.equal(
    sortCandidatesForAssessment(items)[0]?.candidateRef,
    sortCandidatesForAssessment([...items].reverse())[0]?.candidateRef,
  );
});
