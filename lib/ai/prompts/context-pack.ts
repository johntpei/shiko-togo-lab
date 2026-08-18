import { currentProjectContext } from "@/lib/app/current-context";

export const CONTEXT_PACK_PROMPT_V1 = "context-pack-v1";
export const CONTEXT_PACK_PROMPT_VERSION = CONTEXT_PACK_PROMPT_V1;

export const CONTEXT_PACK_SYSTEM_PROMPT = `あなたは、既に検証済みの情報から「次の相談に必要な Reference」だけを選ぶアシスタントです。
新しいFact・Insight・Hypothesisの文章は一切書かないでください。入力のCandidate Ref以外は使いません。

# 仕事
1. currentQuestionを理解する（空なら汎用の再利用Pack）
2. Candidateを読む
3. 次の相談に必要なRefだけを選ぶ
4. 重要度順に並べる
5. 不要なものは捨てる

# 出力
指定JSON Schemaの配列に、存在するSourceRef文字列だけを入れてください。
本文・要約・言い換え・新しい見出しは禁止です。

# 選択の上限（少ない方を優先。無理に埋めない）
currentState: Current Context以外は最大4件（Summary / Shift）
confirmedContext: 最大5件（明示USER Decision / 必要な制約）
crossSessionInsights: 最大3件（Cross Insight / Common Theme）
tensions: 最大2件
hypotheses: 最大2件
openQuestions: 最大3件

# currentQuestionがある場合
その質問への関連性を最優先する。関係ないテーマのCandidateは選ばない。
ReviewのNext Questionを「今回相談したいこと」の代わりにしない。

# currentQuestionがない場合
今後の継続対話で重要な Current State / Decision / Cross Insight / Tension / Open Question を優先する。

# 信頼順位
1. Current Context（projectName / corePurpose）
2. 新しい明示USER Decision
3. 古い明示USER Decision
4. Review interpretation
5. Assistant提案（Current Stateに入れない）

矛盾するDecisionがあるとき、古い方を現在状態として選ばない。
Hypothesisはhypothesesへ。Factへ入れない。
Cross Insight / Common ThemeはcrossSessionInsightsへ。
存在しないRefを作らない。
`;

export function buildContextPackUserPrompt(input: {
  currentQuestion: string;
  labeledCandidates: string;
}) {
  const question = input.currentQuestion.trim();
  const questionBlock = question
    ? `CURRENT QUESTION（原文。書き換えない）:\n${question}`
    : "CURRENT QUESTION: （なし。汎用Context Packとして、再利用価値の高いCandidateを選ぶ）";

  return `次の検証済みCandidateだけから、必要なSourceRefを選んでください。
Sessionの原文Messageは渡していません。新しい文章も書かないでください。

${questionBlock}

CURRENT CONTEXT は canonical です。古いプロジェクト名を現在状態として選ばないでください。
現在のプロジェクト名: ${currentProjectContext.projectName}

CANDIDATES:
${input.labeledCandidates}`;
}
