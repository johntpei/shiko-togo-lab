import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYZE_SESSION_PROMPT_V1,
  ANALYZE_SESSION_PROMPT_V2,
  ANALYZE_SESSION_PROMPT_VERSION,
  ANALYZE_SESSION_SYSTEM_PROMPT,
  ANALYZE_SESSION_SYSTEM_PROMPT_V1,
  ANALYZE_SESSION_SYSTEM_PROMPT_V2,
  ANALYZE_SESSION_SYSTEM_PROMPT_V3,
} from "./analyze-session";

test("現行 promptVersion は analyze-session-v3", () => {
  assert.equal(ANALYZE_SESSION_PROMPT_VERSION, "analyze-session-v3");
  assert.equal(ANALYZE_SESSION_SYSTEM_PROMPT, ANALYZE_SESSION_SYSTEM_PROMPT_V3);
});

test("v1 / v2 プロンプトは残している", () => {
  assert.equal(ANALYZE_SESSION_PROMPT_V1, "analyze-session-v1");
  assert.equal(ANALYZE_SESSION_PROMPT_V2, "analyze-session-v2");
  assert.match(ANALYZE_SESSION_SYSTEM_PROMPT_V1, /quote は必ず/);
  assert.match(ANALYZE_SESSION_SYSTEM_PROMPT_V2, /一字一句そのままコピー/);
});

test("v3: Evidence本文を生成せず EvidenceRef だけ使う", () => {
  const prompt = ANALYZE_SESSION_SYSTEM_PROMPT_V3;
  assert.match(prompt, /Evidence本文を生成しない/);
  assert.match(prompt, /存在しない ref を作らない/);
  assert.match(prompt, /evidenceRefs/);
});

test("Case J: Assistant 提案のみは Decision にしない", () => {
  assert.match(
    ANALYZE_SESSION_SYSTEM_PROMPT_V3,
    /Assistant の提案だけでは Decision 禁止/,
  );
});

test("Case K: User が支持したら Decision 抽出可能", () => {
  assert.match(ANALYZE_SESSION_SYSTEM_PROMPT_V3, /この設計を支持します/);
  assert.match(ANALYZE_SESSION_SYSTEM_PROMPT_V3, /User Message 由来の EvidenceRef を必須/);
});

test("Case L: Assistant の実装提案だけでは Action にしない", () => {
  assert.match(ANALYZE_SESSION_SYSTEM_PROMPT_V3, /次に実装しましょう/);
  assert.match(ANALYZE_SESSION_SYSTEM_PROMPT_V3, /だけでは Action にしない/);
});

test("Case M: User が STEP 4 に進みたいなら Action 抽出可能", () => {
  assert.match(ANALYZE_SESSION_SYSTEM_PROMPT_V3, /STEP 4に進みたいです/);
});

test("Case N: 複数 Evidence からの整理は Insight として許可", () => {
  assert.match(ANALYZE_SESSION_SYSTEM_PROMPT_V3, /複数 Evidence から整理した理解を許可/);
});

test("Case O: 性格・動機の推測は Hypothesis", () => {
  assert.match(ANALYZE_SESSION_SYSTEM_PROMPT_V3, /性格・傾向・原因・動機/);
  assert.match(ANALYZE_SESSION_SYSTEM_PROMPT_V3, /原則 Hypothesis/);
});
