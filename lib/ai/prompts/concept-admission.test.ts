import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCEPT_ADMISSION_PROMPT_VERSION,
  CONCEPT_ADMISSION_SYSTEM_PROMPT,
  buildConceptAdmissionRepairUserPrompt,
  buildConceptAdmissionUserPrompt,
  formatAdmissionCandidatesForLlm,
} from "./concept-admission";
import type { AdmissionCandidate } from "@/lib/concepts/admission/types";

function candidate(
  patch: Partial<AdmissionCandidate> & Pick<AdmissionCandidate, "candidateRef" | "canonicalLabel">,
): AdmissionCandidate {
  return {
    normalizedKey: patch.canonicalLabel,
    occurrenceCount: 1,
    distinctSessionCount: 1,
    firstSeenAt: "2026-07-15",
    lastSeenAt: "2026-07-15",
    sessionIds: ["session-a"],
    evidenceRefs: ["M001:E01"],
    suspiciousFlags: [],
    matchKindsSeen: ["new"],
    representativeEvidence: [
      {
        sessionId: "session-a",
        evidenceRef: "M001:E01",
        occurredAt: "2026-07-15",
        shortText: patch.canonicalLabel,
      },
    ],
    provisionalHints: [],
    ...patch,
  };
}

test("現行 admission promptVersion は concept-admission-prompt-v1", () => {
  assert.equal(CONCEPT_ADMISSION_PROMPT_VERSION, "concept-admission-prompt-v1");
});

test("Prompt v1 は Ref-only で rename / merge を禁止する", () => {
  const prompt = CONCEPT_ADMISSION_SYSTEM_PROMPT;
  assert.match(prompt, /命名の仕事ではない/);
  assert.match(prompt, /rename \/ merge \/ split \/ canonical 生成は禁止/);
  assert.match(prompt, /新しい CandidateRef を作らない/);
  assert.match(prompt, /複数 Candidate を1つにまとめない/);
});

test("Prompt v1 は Map / Timeline / Stability / Specificity を明示する", () => {
  const prompt = CONCEPT_ADMISSION_SYSTEM_PROMPT;
  assert.match(prompt, /Map Test/);
  assert.match(prompt, /Timeline Test/);
  assert.match(prompt, /Stability Test/);
  assert.match(prompt, /Specificity Test/);
  assert.match(prompt, /このテーマに戻ってきた/);
});

test("Prompt v1 は singleton ADMIT 可で hard quota を持たない", () => {
  const prompt = CONCEPT_ADMISSION_SYSTEM_PROMPT;
  assert.match(prompt, /singleton だから reject してはいけない/);
  assert.match(prompt, /ADMIT 件数の数値上限はない/);
  assert.match(prompt, /DEFER は逃げ道にしない/);
});

test("User prompt は CandidateRef と representative Evidence を渡し provisionalHints を渡さない", () => {
  const items = [
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      occurrenceCount: 2,
      distinctSessionCount: 2,
      sessionIds: ["s-a", "s-b"],
      evidenceRefs: ["M011:E02", "M005:E02"],
      representativeEvidence: [
        {
          sessionId: "s-a",
          evidenceRef: "M011:E02",
          occurredAt: "2026-07-15",
          shortText: "これまでの人間関係",
        },
        {
          sessionId: "s-b",
          evidenceRef: "M005:E02",
          occurredAt: "2026-07-16",
          shortText: "人間関係を最小限にする",
        },
      ],
      provisionalHints: [
        {
          otherCandidateRef: "C31",
          otherCanonicalLabel: "高性能",
          surfaceForm: "高性能AI",
          evidenceRef: "M001:E01",
        },
      ],
    }),
  ];
  const userPrompt = buildConceptAdmissionUserPrompt({ candidates: items });
  assert.match(userPrompt, /# Required CandidateRefs/);
  assert.match(userPrompt, /- C20/);
  assert.match(userPrompt, /canonicalLabel: 人間関係/);
  assert.match(userPrompt, /\[s-a\]\[M011:E02\]/);
  assert.doesNotMatch(userPrompt, /provisionalHints/);
  assert.doesNotMatch(userPrompt, /高性能AI/);
  assert.doesNotMatch(userPrompt, /calibration/);
  assert.doesNotMatch(userPrompt, /A Strong/);
  const formatted = formatAdmissionCandidatesForLlm(items);
  assert.doesNotMatch(formatted, /otherCandidateRef/);
});

test("repair prompt は missing / duplicate / unknown を示す", () => {
  const repair = buildConceptAdmissionRepairUserPrompt({
    candidates: [candidate({ candidateRef: "C01", canonicalLabel: "高性能AI" })],
    coverageReason: "missing_candidate_ref",
    coverageDetail: "C01",
  });
  assert.match(repair, /Coverage repair/);
  assert.match(repair, /missing_candidate_ref/);
  assert.match(repair, /C01/);
  assert.match(repair, /正確に1回だけ/);
});
