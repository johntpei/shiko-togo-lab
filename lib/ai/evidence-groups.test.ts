import assert from "node:assert/strict";
import test from "node:test";
import {
  distinctSessionRefsFromGroups,
  flattenEvidenceGroups,
  mergeGroupedEvidenceRefs,
  sessionRefFromEvidenceRef,
} from "./evidence-groups";

test("Case A: flatten で S01 と S02 の Evidence が残る", () => {
  const refs = flattenEvidenceGroups([
    { sessionRef: "S01", evidenceRefs: ["S01:M005:E01"] },
    { sessionRef: "S02", evidenceRefs: ["S02:M002:E04"] },
  ]);
  assert.deepEqual(refs, ["S01:M005:E01", "S02:M002:E04"]);
  assert.deepEqual(distinctSessionRefsFromGroups([
    { sessionRef: "S01", evidenceRefs: ["S01:M005:E01"] },
    { sessionRef: "S02", evidenceRefs: ["S02:M002:E04"] },
  ]), ["S01", "S02"]);
});

test("Case L: Current Context は sessionRef として数えない", () => {
  assert.equal(sessionRefFromEvidenceRef("CURRENT CONTEXT"), null);
  assert.equal(sessionRefFromEvidenceRef("S01:M001:E01"), "S01");
});

test("evidenceRefs だけでも flatten 相当になる", () => {
  assert.deepEqual(
    mergeGroupedEvidenceRefs(undefined, ["S01:M001:E01", "S03:M002:E01"]),
    ["S01:M001:E01", "S03:M002:E01"],
  );
});
