import assert from "node:assert/strict";
import test from "node:test";
import { INTEGRATED_REVIEW_MAX_INPUT_CHARS } from "@/lib/ai/limits";
import type { StoredReviewPayload } from "@/lib/ai/review-schemas";
import {
  buildContextCandidates,
  formatContextCandidatesForAi,
} from "./candidates";

function reviewPayload(): StoredReviewPayload {
  return {
    summary: "運用の設計が主題になっている。",
    commonThemes: [
      {
        text: "人間側の整理が繰り返されている。",
        evidence: [],
        semanticValid: true,
        supportType: "cross_session_interpretation",
      },
      {
        text: "除外されたテーマ",
        evidence: [],
        semanticValid: false,
        invalidReason: "insufficient_distinct_sessions",
      },
    ],
    shifts: [],
    tensions: [],
    crossInsights: [
      {
        text: "ボトルネックが人間側の知見管理へ移っている。",
        evidence: [],
        semanticValid: true,
        supportType: "cross_session_interpretation",
      },
    ],
    hypotheses: [
      {
        text: "自分で期限を置くと進みやすい可能性がある。",
        evidence: [],
        semanticValid: true,
        supportType: "hypothesis",
        rationale: "自由と締切の両方を述べているため。",
        validationIdea: "置いた週と置かない週を比較する。",
      },
    ],
    openQuestions: [
      {
        text: "保存と再利用のどちらを先に減らすべきか？",
        evidence: [],
        semanticValid: true,
      },
    ],
    nextQuestions: [],
    settings: {
      provider: "openai",
      store: false,
      maxInputChars: INTEGRATED_REVIEW_MAX_INPUT_CHARS,
    },
  };
}

test("Case E: Guard除外itemはCandidateにならない", () => {
  const candidates = buildContextCandidates({
    reviewId: "review-1",
    reviewPayload: reviewPayload(),
    sessions: [],
  });
  assert.equal(
    candidates.some((item) => item.text === "除外されたテーマ"),
    false,
  );
  assert.equal(
    candidates.some((item) => item.ref === "R:THEME:01"),
    true,
  );
});

test("Case H: Current Context に思考統合研究所が入る", () => {
  const candidates = buildContextCandidates({
    reviewId: "review-1",
    reviewPayload: reviewPayload(),
    sessions: [],
  });
  const name = candidates.find((item) => item.ref === "C:PROJECT_NAME");
  assert.equal(name?.text, "思考統合研究所");
});

test("Case I: 古いprojectNameはCurrent Contextにならない", () => {
  const candidates = buildContextCandidates({
    reviewId: "review-1",
    reviewPayload: reviewPayload(),
    sessions: [
      {
        id: "s1",
        title: "旧名",
        occurredAt: "2026-07-01",
        analysis: {
          summary: "旧名称の話",
          items: [
            {
              kind: "decision",
              subject: "user",
              text: "プロジェクト名は旧ラボにする。",
              evidence: [
                {
                  messageRef: "M001:E01",
                  quote: "旧ラボにする",
                  validated: true,
                  messageId: "m1",
                  role: "user",
                },
              ],
              semanticValid: true,
            },
          ],
          settings: {
            provider: "openai",
            store: false,
            maxInputChars: 40000,
          },
        },
      },
    ],
  });
  const name = candidates.find((item) => item.ref === "C:PROJECT_NAME");
  assert.equal(name?.text, "思考統合研究所");
  assert.notEqual(name?.text, "旧ラボ");
  assert.equal(
    candidates.some((item) => item.ref.startsWith("D:") && item.text.includes("旧ラボ")),
    true,
  );
});

test("Assistant提案だけのDecisionはCandidateにしない", () => {
  const candidates = buildContextCandidates({
    reviewId: "review-1",
    reviewPayload: reviewPayload(),
    sessions: [
      {
        id: "s1",
        title: "S1",
        occurredAt: "2026-08-01",
        analysis: {
          summary: "提案",
          items: [
            {
              kind: "decision",
              subject: "user",
              text: "KnowledgeをMVPに入れる。",
              evidence: [
                {
                  messageRef: "M002:E01",
                  quote: "入れるのがおすすめ",
                  validated: true,
                  messageId: "m2",
                  role: "assistant",
                },
              ],
              semanticValid: true,
            },
          ],
          settings: {
            provider: "openai",
            store: false,
            maxInputChars: 40000,
          },
        },
      },
    ],
  });
  assert.equal(
    candidates.some((item) => item.type === "decision"),
    false,
  );
});

test("AI入力用テキストにRaw Messageラベルを付けない", () => {
  const labeled = formatContextCandidatesForAi(
    buildContextCandidates({
      reviewId: "review-1",
      reviewPayload: reviewPayload(),
      sessions: [],
    }),
  );
  assert.match(labeled, /C:PROJECT_NAME/);
  assert.doesNotMatch(labeled, /SESSION S01/);
  assert.doesNotMatch(labeled, /USER:/);
});
