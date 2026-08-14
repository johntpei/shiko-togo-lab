import assert from "node:assert/strict";
import test from "node:test";
import { INTEGRATED_REVIEW_MAX_INPUT_CHARS } from "./limits";
import {
  buildIntegratedReviewInput,
  buildReviewCurrentContextNote,
  type ReviewSessionSource,
} from "./review-input";
import { MIN_INTEGRATED_REVIEW_SESSIONS } from "./limits";
import { isIntegratedReviewInputTooLong } from "./limits";

function message(id: string, role: string, content: string) {
  return { id, role, content, attachmentsJson: null };
}

function source(
  id: string,
  title: string,
  occurredAt: string,
  messages: ReturnType<typeof message>[],
): ReviewSessionSource {
  return {
    session: {
      id,
      title,
      occurredAt,
      source: "chatgpt",
      category: "制作",
      createdAt: `${occurredAt}T00:00:00.000Z`,
    },
    messages,
    analysis: null,
  };
}

const userA = message(
  "u-a",
  "user",
  "この設計は素晴らしいですが、MVPでは外しても良いかと思います。",
);
const assistantA = message(
  "a-a",
  "assistant",
  "MVPではKnowledge機能を外すのが良いと思います。その方が早く出せます。",
);
const userB = message(
  "u-b",
  "user",
  "私もその設計を支持します。まずは小さく始めたいです。",
);
const userC = message(
  "u-c",
  "user",
  "過去の会話を次の対話へ再利用したいです。記憶が追いつきません。",
);

test("Case A: 2 Session 選択なら Review 入力を作れる", () => {
  const input = buildIntegratedReviewInput([
    source("s1", "Session A", "2026-07-18", [userA, assistantA, userB]),
    source("s2", "Session B", "2026-08-02", [userC]),
  ]);
  assert.ok(input.analyzableSessionCount >= MIN_INTEGRATED_REVIEW_SESSIONS);
  assert.match(input.labeledTranscript, /SESSION S01/);
  assert.match(input.labeledTranscript, /SESSION S02/);
  assert.match(input.labeledTranscript, /\[S01:M001:E01\]\[USER\]/);
  assert.match(input.labeledTranscript, /\[S02:M001:E01\]\[USER\]/);
  assert.equal(input.sessionIdByRef.get("S01"), "s1");
  assert.equal(input.unitsByRef.get("S01:M001:E01")?.sessionId, "s1");
});

test("Case B: 1 Session のみでは analyzableSessionCount が 1", () => {
  const input = buildIntegratedReviewInput([
    source("s1", "Session A", "2026-07-18", [userA, userB]),
  ]);
  assert.equal(input.analyzableSessionCount, 1);
  assert.equal(input.analyzableSessionCount < MIN_INTEGRATED_REVIEW_SESSIONS, true);
});

test("Case N: ユーザーが選択していない Session は AI 入力へ含まれない", () => {
  const input = buildIntegratedReviewInput([
    source("s1", "選んだA", "2026-07-18", [userA]),
    source("s2", "選んだB", "2026-08-02", [userC]),
  ]);
  assert.doesNotMatch(input.labeledTranscript, /選んでいないC/);
  assert.equal(input.selectedSessionIds.includes("s3"), false);
  assert.equal(input.sessionIdByRef.has("S03"), false);
});

test("ローカル EvidenceRef は map に入れない", () => {
  const input = buildIntegratedReviewInput([
    source("s1", "Session A", "2026-07-18", [userA]),
    source("s2", "Session B", "2026-08-02", [userC]),
  ]);
  assert.equal(input.unitsByRef.has("M001:E01"), false);
  assert.ok(input.unitsByRef.has("S01:M001:E01"));
  assert.ok(input.unitsByRef.has("S02:M001:E01"));
});

test("入力上限判定は INTEGRATED_REVIEW_MAX_INPUT_CHARS を使う", () => {
  const huge = "あ".repeat(INTEGRATED_REVIEW_MAX_INPUT_CHARS + 50);
  const input = buildIntegratedReviewInput([
    source("s1", "巨大A", "2026-07-18", [message("u1", "user", huge)]),
    source("s2", "巨大B", "2026-08-02", [message("u2", "user", huge)]),
  ]);
  assert.equal(isIntegratedReviewInputTooLong(input.labeledTranscript), true);
});

test("Current Context は新しいSessionと現在名称を明示する", () => {
  const input = buildIntegratedReviewInput([
    source("s1", "思考補完計画｜統合研究所", "2026-07-18", [userA]),
    source("s2", "思考統合研究所", "2026-08-02", [userC]),
  ]);
  const note = buildReviewCurrentContextNote(input.sessions);
  assert.match(note, /思考統合研究所/);
  assert.match(note, /S02/);
  assert.match(note, /新しいSessionを古いSessionより優先/);
});

test("Case B: 古い名称は Session 入力から削除せず歴史として残る", () => {
  const input = buildIntegratedReviewInput([
    source("s1", "思考補完計画｜統合研究所", "2026-07-18", [userA]),
    source("s2", "思考統合研究所", "2026-08-02", [userC]),
  ]);
  assert.match(input.labeledTranscript, /思考補完計画｜統合研究所/);
  assert.doesNotMatch(input.labeledTranscript, /CURRENT CONTEXT/);
});
