import {
  CONCEPT_FORMS,
  EVIDENCE_ROLES,
  LONGITUDINAL_POTENTIALS,
} from "@/lib/concepts/admission/assessment-types";
import { unitTextKey } from "@/lib/concepts/admission/candidates";
import type { AdmissionCandidate } from "@/lib/concepts/admission/types";

export const CONCEPT_ADMISSION_ASSESSMENT_PROMPT_V2 =
  "concept-admission-assessment-prompt-v2";
export const CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION =
  CONCEPT_ADMISSION_ASSESSMENT_PROMPT_V2;

export type AssessmentLlmCandidate = {
  candidateRef: string;
  canonicalLabel: string;
  evidenceSnippets: string[];
};

export const ASSESSMENT_SYNTHETIC_EXAMPLES = {
  specific_named_concept: ["睡眠の質", "仕事の優先順位"],
  stable_topic: ["自己理解", "生活習慣"],
  generic_head: ["こと", "状態"],
  clause_or_statement: ["もっと早く行動できるようになりたいこと"],
  episodic_object: ["昨日の買い物"],
  temporary_state: ["今朝の疲れ"],
  task_or_action: ["予約を変更する"],
  relation_or_claim: ["彼の方が正しいという主張"],
  pii: ["住民票コード"],
} as const;

export const CONCEPT_ADMISSION_ASSESSMENT_SYSTEM_PROMPT_V2 = `あなたは、既に抽出・解決済みの Concept Candidate について、性質だけを観測するアシスタントです。
入力された Candidate 以外の情報は使いません。
Web検索・一般知識での補完・Assistant / Review / Observation / ユーザープロフィールの想像もしません。

# 仕事
入力された各 CandidateRef について、conceptForm / evidenceRole / longitudinalPotential を1件返す。
これは Registry への採用判定ではない。admit / defer / reject は返さない。
命名の仕事でもない。新しい label・surface・alias・Candidate を作らない。
rename / merge / split / canonical 生成は禁止。

# 出力
指定の JSON Schema に従う。
assessments[] の各要素は candidateRef / conceptForm / evidenceRole / longitudinalPotential だけ。
decision・reasonCode・canonicalLabel・explanation・自由文は返さない。
入力された各 CandidateRef を正確に1回だけ返す。不足・重複・未知 Ref は無効。

# 独立判定
Each Candidate must be assessed independently.
Do not rank Candidates against each other.
Do not choose only the best Candidates in this batch.
One Candidate's assessment must not change because another Candidate is present.
この batch から「残すもの」を選ばない。件数目標も持たない。

# conceptForm
canonicalLabel そのものの形を分類する。
Evidence に書かれた出来事・その日の話・一時的な文脈で label の形を変えない。
stable な label が一時的な出来事の中で語られていても、label 自体を episodic_object にしない。

- specific_named_concept: 単独で対象が比較的明確に区別できる、specific な名前・複合名詞・固有の概念語。例: ${ASSESSMENT_SYNTHETIC_EXAMPLES.specific_named_concept.join(" / ")}
- stable_topic: 一般的な語でも、単独で意味を持ち、数か月単位で思考テーマとして追跡可能。例: ${ASSESSMENT_SYNTHETIC_EXAMPLES.stable_topic.join(" / ")}
- generic_head: 修飾や対象が不足し、単独 Node では何について考えているか曖昧。例: ${ASSESSMENT_SYNTHETIC_EXAMPLES.generic_head.join(" / ")}
- clause_or_statement: 文・命題・長い説明句。例: ${ASSESSMENT_SYNTHETIC_EXAMPLES.clause_or_statement.join(" / ")}
- episodic_object: label そのものが特定の一回の出来事・エピソード対象。例: ${ASSESSMENT_SYNTHETIC_EXAMPLES.episodic_object.join(" / ")}
- temporary_state: 一時状態・その場だけの状態表現。例: ${ASSESSMENT_SYNTHETIC_EXAMPLES.temporary_state.join(" / ")}
- task_or_action: その場の依頼・作業。例: ${ASSESSMENT_SYNTHETIC_EXAMPLES.task_or_action.join(" / ")}
- relation_or_claim: 関係や命題そのもの。例: ${ASSESSMENT_SYNTHETIC_EXAMPLES.relation_or_claim.join(" / ")}
- pii: 個人識別情報。例: ${ASSESSMENT_SYNTHETIC_EXAMPLES.pii.join(" / ")}
- unclear: 形を決められないときだけ。逃げ道にしない。

# evidenceRole
conceptForm とは独立。代表 Evidence 内での使われ方。
- central: USER がその Concept を理解・比較・判断・設計している、または問題として考えている
- supporting: 主題を考えるための重要な構成要素だが、中心そのものではない
- incidental: 単なる言及、例、余談、通過
- unclear: Evidence だけでは判断困難

# longitudinalPotential
この Concept が数か月後に再び現れたとき、「このテーマに戻ってきた」と追跡する意味があるか。
現在何回出ているかではない。出現回数・Evidence 件数を長期価値そのものとしない。
singleton でも high にしてよい。
- high / medium / low

# Evidence
Evidence snippets are examples of usage. Their number is not a frequency signal.
Evidence の件数は出現頻度ではない。2件あるから重要、1件だから弱い、とは判断しない。

# 禁止
admit / defer / reject を返さない。
新しい CandidateRef を作らない。
複数 Candidate を1つにまとめない。
1つの Candidate を分割しない。
他 Candidate との相対比較で属性を変えない。
`;

export const CONCEPT_ADMISSION_ASSESSMENT_SYSTEM_PROMPT =
  CONCEPT_ADMISSION_ASSESSMENT_SYSTEM_PROMPT_V2;

export function toAssessmentLlmCandidates(
  candidates: AdmissionCandidate[],
  unitTexts: Record<string, string>,
): AssessmentLlmCandidate[] {
  return candidates.map((candidate) => ({
    candidateRef: candidate.candidateRef,
    canonicalLabel: candidate.canonicalLabel,
    evidenceSnippets: candidate.representativeEvidence.flatMap((item) => {
      const text = unitTexts[unitTextKey(item.sessionId, item.evidenceRef)];
      const normalized = text?.replace(/\s+/gu, " ").trim();
      return normalized ? [normalized] : [];
    }),
  }));
}

export function formatAssessmentCandidatesForLlm(
  candidates: AssessmentLlmCandidate[],
) {
  if (candidates.length === 0) {
    return "（Candidate はありません）";
  }
  return candidates
    .map((candidate) => {
      const evidence =
        candidate.evidenceSnippets.length === 0
          ? "- （なし）"
          : candidate.evidenceSnippets
              .map((text, index) => {
                const label = String.fromCharCode(65 + index);
                return `Evidence ${label}:\n${text}`;
              })
              .join("\n\n");
      return [
        `## ${candidate.candidateRef}`,
        `canonicalLabel: ${candidate.canonicalLabel}`,
        "representativeEvidence:",
        evidence,
      ].join("\n");
    })
    .join("\n\n");
}

export function listRequiredAssessmentRefs(
  candidates: Array<{ candidateRef: string }>,
) {
  return candidates.map((item) => item.candidateRef);
}

export function buildConceptAssessmentUserPrompt(input: {
  candidates: AssessmentLlmCandidate[];
}) {
  const refs = listRequiredAssessmentRefs(input.candidates)
    .map((ref) => `- ${ref}`)
    .join("\n");
  return [
    "# Required CandidateRefs",
    "次の各 CandidateRef について assessments[] へ必ず1件返す。不足・重複・未知 Ref は無効。",
    refs || "（なし）",
    "",
    "# Candidates",
    formatAssessmentCandidatesForLlm(input.candidates),
    "",
    "Each Candidate must be assessed independently. Do not rank Candidates.",
    "Evidence snippets are examples of usage. Their number is not a frequency signal.",
    "",
    `# Allowed conceptForm: ${CONCEPT_FORMS.join(" / ")}`,
    `# Allowed evidenceRole: ${EVIDENCE_ROLES.join(" / ")}`,
    `# Allowed longitudinalPotential: ${LONGITUDINAL_POTENTIALS.join(" / ")}`,
  ].join("\n");
}

export function buildConceptAssessmentRepairUserPrompt(input: {
  candidates: AssessmentLlmCandidate[];
  coverageReason: string;
  coverageDetail: string;
}) {
  return [
    buildConceptAssessmentUserPrompt({ candidates: input.candidates }),
    "",
    "# Coverage repair",
    "前回の出力は coverage が不正でした。各 CandidateRef を正確に1回だけ返してください。",
    `reason: ${input.coverageReason}`,
    `detail: ${input.coverageDetail}`,
    "missing / duplicate / unknown を解消し、Required CandidateRefs 以外は出さない。",
    "rename / merge / 新しい Ref を作らない。",
    "decision は返さない。",
  ].join("\n");
}
