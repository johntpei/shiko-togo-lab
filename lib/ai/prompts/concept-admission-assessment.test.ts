import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSESSMENT_SYNTHETIC_EXAMPLES,
  CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION,
  CONCEPT_ADMISSION_ASSESSMENT_SYSTEM_PROMPT,
  buildConceptAssessmentRepairUserPrompt,
  buildConceptAssessmentUserPrompt,
  formatAssessmentCandidatesForLlm,
  toAssessmentLlmCandidates,
} from "./concept-admission-assessment";
import { CONCEPT_ADMISSION_PROMPT_VERSION } from "./concept-admission";
import type { AdmissionCandidate } from "@/lib/concepts/admission/types";
import { unitTextKey } from "@/lib/concepts/admission/candidates";

const CALIBRATION_LEAK_LABELS = [
  "人間関係",
  "第2の脳",
  "ADHDの記憶力",
  "統合支援ツール",
  "高性能AI",
  "寂しさ",
  "負の連鎖",
  "気持ち",
  "高性能",
];

function candidate(
  patch: Partial<AdmissionCandidate> &
    Pick<AdmissionCandidate, "candidateRef" | "canonicalLabel">,
): AdmissionCandidate {
  return {
    normalizedKey: patch.canonicalLabel,
    occurrenceCount: 9,
    distinctSessionCount: 4,
    firstSeenAt: "2099-01-01",
    lastSeenAt: "2099-12-31",
    sessionIds: ["session-secret-id"],
    evidenceRefs: ["M001:E01"],
    suspiciousFlags: ["generic_surface", "singleton_new"],
    matchKindsSeen: ["exact", "observed_alias"],
    representativeEvidence: [
      {
        sessionId: "session-secret-id",
        evidenceRef: "M001:E01",
        occurredAt: "2099-01-01",
        shortText: "truncated",
      },
    ],
    provisionalHints: [
      {
        otherCandidateRef: "C99",
        otherCanonicalLabel: "merge-target",
        surfaceForm: "alias-hint",
        evidenceRef: "M001:E01",
      },
    ],
    ...patch,
  };
}

test("現行 assessment promptVersion は concept-admission-assessment-prompt-v2", () => {
  assert.equal(
    CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION,
    "concept-admission-assessment-prompt-v2",
  );
  assert.equal(CONCEPT_ADMISSION_PROMPT_VERSION, "concept-admission-prompt-v1");
});

test("Prompt v2 は 3属性のみで direct decision を禁止する", () => {
  const prompt = CONCEPT_ADMISSION_ASSESSMENT_SYSTEM_PROMPT;
  assert.match(prompt, /conceptForm \/ evidenceRole \/ longitudinalPotential/);
  assert.match(prompt, /admit \/ defer \/ reject は返さない/);
  assert.match(prompt, /decision・reasonCode/);
  assert.doesNotMatch(prompt, /admit \/ defer \/ reject を1件返す/);
});

test("Prompt v2 は independent assessment と no ranking を明示する", () => {
  const prompt = CONCEPT_ADMISSION_ASSESSMENT_SYSTEM_PROMPT;
  assert.match(prompt, /Each Candidate must be assessed independently/);
  assert.match(prompt, /Do not rank Candidates against each other/);
  assert.match(prompt, /Do not choose only the best Candidates in this batch/);
});

test("Prompt v2 は conceptForm を label 自体の分類とし frequency を使わない", () => {
  const prompt = CONCEPT_ADMISSION_ASSESSMENT_SYSTEM_PROMPT;
  assert.match(prompt, /canonicalLabel そのものの形を分類する/);
  assert.match(prompt, /label 自体を episodic_object にしない/);
  assert.match(prompt, /現在何回出ているかではない/);
  assert.match(prompt, /singleton でも high にしてよい/);
  assert.match(
    prompt,
    /Evidence snippets are examples of usage\. Their number is not a frequency signal/,
  );
});

test("Prompt v2 は synthetic examples を使い Calibration Candidate を使わない", () => {
  const prompt = CONCEPT_ADMISSION_ASSESSMENT_SYSTEM_PROMPT;
  assert.match(prompt, /例: 睡眠の質 \/ 仕事の優先順位/);
  assert.match(prompt, /例: 自己理解 \/ 生活習慣/);
  assert.match(prompt, /例: こと \/ 状態/);
  assert.match(prompt, /例: もっと早く行動できるようになりたいこと/);
  assert.match(prompt, /例: 昨日の買い物/);
  assert.match(prompt, /例: 今朝の疲れ/);
  assert.match(prompt, /例: 予約を変更する/);
  assert.match(prompt, /例: 彼の方が正しいという主張/);
  assert.match(prompt, /例: 住民票コード/);
  assert.equal(ASSESSMENT_SYNTHETIC_EXAMPLES.generic_head[0], "こと");
  for (const label of CALIBRATION_LEAK_LABELS) {
    assert.equal(prompt.includes(label), false, label);
  }
});

test("LLM Candidate View は Ref / label / USER 全文だけで frequency を隠す", () => {
  const longText =
    `睡眠の質を改善したいかどうかを自分で判断したい${"あ".repeat(80)}`;
  assert.ok([...longText].length > 80);
  const item = candidate({
    candidateRef: "C80",
    canonicalLabel: "睡眠の質",
  });
  const unitTexts = {
    [unitTextKey("session-secret-id", "M001:E01")]: longText,
  };
  const views = toAssessmentLlmCandidates([item], unitTexts);
  const formatted = formatAssessmentCandidatesForLlm(views);
  const userPrompt = buildConceptAssessmentUserPrompt({ candidates: views });

  assert.match(formatted, /## C80/);
  assert.match(formatted, /canonicalLabel: 睡眠の質/);
  assert.match(formatted, /Evidence A:/);
  assert.ok(formatted.includes(longText));
  assert.doesNotMatch(formatted, /truncated/);
  assert.doesNotMatch(userPrompt, /occurrenceCount/);
  assert.doesNotMatch(userPrompt, /distinctSessionCount/);
  assert.doesNotMatch(userPrompt, /sessionIds/);
  assert.doesNotMatch(userPrompt, /session-secret-id/);
  assert.doesNotMatch(userPrompt, /2099-01-01/);
  assert.doesNotMatch(userPrompt, /firstSeenAt/);
  assert.doesNotMatch(userPrompt, /lastSeenAt/);
  assert.doesNotMatch(userPrompt, /suspiciousFlags/);
  assert.doesNotMatch(userPrompt, /generic_surface/);
  assert.doesNotMatch(userPrompt, /provisionalHints/);
  assert.doesNotMatch(userPrompt, /merge-target/);
  assert.doesNotMatch(userPrompt, /matchKindsSeen/);
  assert.doesNotMatch(userPrompt, /normalizedKey/);
  assert.doesNotMatch(userPrompt, /了解しました/);
  assert.match(userPrompt, /Their number is not a frequency signal/);
  assert.match(userPrompt, /Do not rank Candidates/);
});

test("repair prompt は missing / duplicate / unknown を示し decision を返させない", () => {
  const repair = buildConceptAssessmentRepairUserPrompt({
    candidates: [
      {
        candidateRef: "C80",
        canonicalLabel: "睡眠の質",
        evidenceSnippets: ["睡眠の質を記録する。"],
      },
    ],
    coverageReason: "missing_candidate_ref",
    coverageDetail: "C80",
  });
  assert.match(repair, /Coverage repair/);
  assert.match(repair, /missing_candidate_ref/);
  assert.match(repair, /C80/);
  assert.match(repair, /正確に1回だけ/);
  assert.match(repair, /decision は返さない/);
});
