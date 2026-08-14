import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYZE_SESSION_PROMPT_V1,
  ANALYZE_SESSION_PROMPT_V2,
  ANALYZE_SESSION_PROMPT_V3,
  ANALYZE_SESSION_PROMPT_V4,
  ANALYZE_SESSION_PROMPT_VERSION,
  ANALYZE_SESSION_SYSTEM_PROMPT,
  ANALYZE_SESSION_SYSTEM_PROMPT_V1,
  ANALYZE_SESSION_SYSTEM_PROMPT_V2,
  ANALYZE_SESSION_SYSTEM_PROMPT_V3,
  ANALYZE_SESSION_SYSTEM_PROMPT_V4,
} from "./analyze-session";

test("現行 promptVersion は analyze-session-v4", () => {
  assert.equal(ANALYZE_SESSION_PROMPT_VERSION, "analyze-session-v4");
  assert.equal(ANALYZE_SESSION_PROMPT_V4, "analyze-session-v4");
  assert.equal(ANALYZE_SESSION_SYSTEM_PROMPT, ANALYZE_SESSION_SYSTEM_PROMPT_V4);
});

test("v1 / v2 / v3 プロンプトは残している", () => {
  assert.equal(ANALYZE_SESSION_PROMPT_V1, "analyze-session-v1");
  assert.equal(ANALYZE_SESSION_PROMPT_V2, "analyze-session-v2");
  assert.equal(ANALYZE_SESSION_PROMPT_V3, "analyze-session-v3");
  assert.match(ANALYZE_SESSION_SYSTEM_PROMPT_V1, /quote は必ず/);
  assert.match(ANALYZE_SESSION_SYSTEM_PROMPT_V2, /一字一句そのままコピー/);
  assert.match(ANALYZE_SESSION_SYSTEM_PROMPT_V3, /Evidence本文を生成しない/);
});

test("v4: EvidenceRef + role + subject を使う", () => {
  const prompt = ANALYZE_SESSION_SYSTEM_PROMPT_V4;
  assert.match(prompt, /Evidence本文を生成しない/);
  assert.match(prompt, /subject/);
  assert.match(prompt, /\[M003:E01\]\[USER\]/);
  assert.match(prompt, /\[M004:E01\]\[ASSISTANT\]/);
});

test("v4: Decision / Action は USER Evidence 必須", () => {
  const prompt = ANALYZE_SESSION_SYSTEM_PROMPT_V4;
  assert.match(prompt, /USER Evidence が無ければ Decision を絶対に生成しない/);
  assert.match(prompt, /USER Evidence が無ければ Action を絶対に生成しない/);
  assert.match(prompt, /私もその設計を支持します/);
  assert.match(prompt, /STEP 4に進みたいです/);
});

test("v4: Assistant 提案を Decision / Action にしない", () => {
  const prompt = ANALYZE_SESSION_SYSTEM_PROMPT_V4;
  assert.match(prompt, /5時間で区切るのがおすすめです/);
  assert.match(prompt, /次はSTEP 4に進みましょう/);
});

test("v4: 疑問文を User Fact にしない", () => {
  const prompt = ANALYZE_SESSION_SYSTEM_PROMPT_V4;
  assert.match(prompt, /Claude Codeだけで代替できてしまわないですか/);
  assert.match(prompt, /ユーザーはClaude Codeでかなりの部分を代替可能だと認識している/);
  assert.match(prompt, /疑問文は、その内容を User Fact として扱わない/);
});

test("v4: 探索発言と Action / Decision を区別する", () => {
  const prompt = ANALYZE_SESSION_SYSTEM_PROMPT_V4;
  assert.match(prompt, /Claude Codeも試した方がいいですか/);
  assert.match(prompt, /Claude Codeも試してみます/);
  assert.match(prompt, /Knowledge機能は外してもよいでしょうか/);
});

test("v4: Insight の interpretation は統合的解釈として書く", () => {
  const prompt = ANALYZE_SESSION_SYSTEM_PROMPT_V4;
  assert.match(prompt, /〜と考えられる/);
  assert.match(prompt, /subject = interpretation/);
});
