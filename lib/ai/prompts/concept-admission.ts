import {
  ADMISSION_DECISIONS,
  ADMISSION_REASON_CODES,
  type AdmissionCandidate,
} from "@/lib/concepts/admission/types";

export const CONCEPT_ADMISSION_PROMPT_V1 = "concept-admission-prompt-v1";
export const CONCEPT_ADMISSION_PROMPT_VERSION = CONCEPT_ADMISSION_PROMPT_V1;

export const CONCEPT_ADMISSION_SYSTEM_PROMPT_V1 = `あなたは、既に抽出・解決済みの Concept Candidate について、長期思考観測用 Registry へ入れる価値だけを判定するアシスタントです。
入力された Candidate 以外の情報は使いません。
Web検索・一般知識での補完・Assistant / Review / Observation / ユーザープロフィールの想像もしません。

# 仕事
入力された各 CandidateRef について、admit / defer / reject を1件返す。
これは命名の仕事ではない。新しい label・surface・alias・Candidate を作らない。
rename / merge / split / canonical 生成は禁止。

# 出力
指定の JSON Schema に従う。
decisions[] の各要素は candidateRef / decision / reasonCode だけ。
canonicalLabel・surfaceForm・aliases・reason 自由文は返さない。
入力された各 CandidateRef を正確に1回だけ返す。不足・重複・未知 Ref は無効。

decision:
- admit: 長期的に Registry Node として追跡する価値がある
- defer: 候補ではあるが、今の Evidence では採用に弱い
- reject: Registry Node として不適

reasonCode は decision と矛盾させない。
admit: stable_topic / specific_named_concept / longitudinal_value
defer: insufficient_context のみ
reject: generic / clause / episodic / temporary_state / task_or_action / relation_or_claim / pii

DEFER は逃げ道にしない。判断できるなら admit か reject にする。
insufficient_context は、Evidence が短すぎて追跡価値を決められないときに限る。

# 判定軸（新しい label は作らない）
Map Test: この canonicalLabel を Thought Map の単独 Node にしたとき、何について考えているか分かるか。
Timeline Test: 数か月後に同じ Concept が再登場したとき「このテーマに戻ってきた」と追跡する価値があるか。
Stability Test: 一時的な出来事・状態・感想・タスクではないか。
Specificity Test: generic すぎず、思考対象を区別できるか。

# Centrality
発言に登場しただけでは admit しない。
USER が理解・比較・判断・設計している、継続的に問題視している、今後再登場を観測する価値があるものを高く評価する。

# Frequency
frequency は signal であり条件ではない。
distinctSessionCount > 1 は強い positive signal。
singleton だから reject してはいけない。
初回でも specific で安定した思考対象なら admit してよい。

# Corpus
入力全体を比較して、追跡価値のある Node を選ぶ。
局所的な名詞句を大量 admit するのは通常誤り。
ADMIT 件数の数値上限はない。無理に件数を合わせない。

# 例（この入力の正解ではない。判定の粒度の例）
admit しやすい: 人間関係 / ADHDの記憶力 / 第2の脳 / 高性能AI
- 単独 Node として意味が分かり、将来再登場を追う価値がある

reject しやすい: 気持ち / 高性能 / テーマ / どうでもいい / 長い一時状態句 / その日のメッセージ送信
- generic、形容だけ、clause/state、エピソード、その場のタスク

# 禁止
新しい CandidateRef を作らない。
複数 Candidate を1つにまとめない。
1つの Candidate を分割しない。
`;

export const CONCEPT_ADMISSION_SYSTEM_PROMPT = CONCEPT_ADMISSION_SYSTEM_PROMPT_V1;

export function formatAdmissionCandidatesForLlm(
  candidates: AdmissionCandidate[],
) {
  if (candidates.length === 0) {
    return "（Candidate はありません）";
  }
  return candidates
    .map((candidate) => {
      const flags =
        candidate.suspiciousFlags.length > 0
          ? candidate.suspiciousFlags.join(", ")
          : "（なし）";
      const evidence =
        candidate.representativeEvidence.length === 0
          ? "- （なし）"
          : candidate.representativeEvidence
              .map(
                (item) =>
                  `- [${item.sessionId}][${item.evidenceRef}] ${item.shortText}`,
              )
              .join("\n");
      return [
        `## ${candidate.candidateRef}`,
        `canonicalLabel: ${candidate.canonicalLabel}`,
        `occurrenceCount: ${candidate.occurrenceCount}`,
        `distinctSessionCount: ${candidate.distinctSessionCount}`,
        `firstSeenAt: ${candidate.firstSeenAt || "（なし）"}`,
        `lastSeenAt: ${candidate.lastSeenAt || "（なし）"}`,
        `sessionIds: ${candidate.sessionIds.join(", ") || "（なし）"}`,
        `suspiciousFlags: ${flags}`,
        "representativeEvidence:",
        evidence,
      ].join("\n");
    })
    .join("\n\n");
}

export function listRequiredAdmissionRefs(candidates: AdmissionCandidate[]) {
  return candidates.map((item) => item.candidateRef);
}

export function buildConceptAdmissionUserPrompt(input: {
  candidates: AdmissionCandidate[];
}) {
  const refs = listRequiredAdmissionRefs(input.candidates)
    .map((ref) => `- ${ref}`)
    .join("\n");
  return [
    "# Required CandidateRefs",
    "次の各 CandidateRef について decisions[] へ必ず1件返す。不足・重複・未知 Ref は無効。",
    refs || "（なし）",
    "",
    "# Candidates",
    formatAdmissionCandidatesForLlm(input.candidates),
    "",
    `# Allowed decision: ${ADMISSION_DECISIONS.join(" / ")}`,
    `# Allowed reasonCode: ${ADMISSION_REASON_CODES.join(" / ")}`,
  ].join("\n");
}

export function buildConceptAdmissionRepairUserPrompt(input: {
  candidates: AdmissionCandidate[];
  coverageReason: string;
  coverageDetail: string;
}) {
  return [
    buildConceptAdmissionUserPrompt({ candidates: input.candidates }),
    "",
    "# Coverage repair",
    "前回の出力は coverage が不正でした。各 CandidateRef を正確に1回だけ返してください。",
    `reason: ${input.coverageReason}`,
    `detail: ${input.coverageDetail}`,
    "missing / duplicate / unknown を解消し、Required CandidateRefs 以外は出さない。",
    "rename / merge / 新しい Ref を作らない。",
  ].join("\n");
}
