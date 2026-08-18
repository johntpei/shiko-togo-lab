import assert from "node:assert/strict";
import test from "node:test";
import { candidateMap } from "./candidates";
import { forceCurrentContext, resolveSourceRefs } from "./validation";
import type { ContextCandidate } from "./schema";

const candidates: ContextCandidate[] = [
  {
    ref: "C:PROJECT_NAME",
    type: "current_context",
    text: "思考統合研究所",
    supportType: "confirmed",
  },
  {
    ref: "C:CORE_PURPOSE",
    type: "current_context",
    text: "再利用できるようにする。",
    supportType: "confirmed",
  },
  {
    ref: "R:INSIGHT:01",
    type: "insight",
    text: "人間側の知見管理がボトルネック。",
    supportType: "cross_session_interpretation",
  },
];

test("Case D: 存在しないSourceRefは invalid_source_ref", () => {
  const result = resolveSourceRefs(
    ["R:INSIGHT:01", "R:INSIGHT:99"],
    candidateMap(candidates),
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.text, "人間側の知見管理がボトルネック。");
  assert.deepEqual(result.invalid, [
    { ref: "R:INSIGHT:99", reason: "invalid_source_ref" },
  ]);
});

test("Current Context は選択漏れでも固定挿入する", () => {
  const forced = forceCurrentContext([], candidateMap(candidates));
  assert.equal(forced[0]?.sourceRef, "C:PROJECT_NAME");
  assert.equal(forced[1]?.sourceRef, "C:CORE_PURPOSE");
});
