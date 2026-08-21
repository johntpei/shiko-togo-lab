import { formatConceptCatalogForLlm } from "@/lib/concepts/catalog";
import { MAX_CONCEPTS_PER_UNIT } from "@/lib/concepts/resolve";
import type { ConceptRegistrySnapshot } from "@/lib/concepts/catalog";
import { formatUserEvidenceUnitsForLlm } from "@/lib/concepts/user-units";
import type { ConceptExtractUnit } from "@/lib/concepts/user-units";

export const CONCEPT_EXTRACT_PROMPT_V1 = "concept-extract-prompt-v1";
export const CONCEPT_EXTRACT_PROMPT_VERSION = CONCEPT_EXTRACT_PROMPT_V1;

export const CONCEPT_EXTRACT_SYSTEM_PROMPT_V1 = `あなたは、1つの対話Sessionの USER Evidence Unit だけを根拠に Concept を抽出するアシスタントです。
与えられた USER Evidence Units と Concept Catalog 以外の情報は使いません。
Web検索・一般知識での補完・Assistant / Review / Observation の想像もしません。

# 出力
必ず指定の JSON Schema に従ってください。自由文章・解説・reason は書かないでください。
items のみを返します。

# Concept の定義
思考観測所の Concept は、ユーザー自身が思考・判断・不安・設計・実践の対象として明示的に扱っている、時間をまたいで追跡可能な意味的概念です。
複数回出現している必要はありません。初回出現でも Concept 候補になれます。

# 抽出してよいもの
USER 自身が直接扱っている判断対象・設計対象・問題意識・行動上の対象・継続的テーマ・比較対象。
短い名詞句を優先する。
例: AI性能 / 思考整理 / 自動化 / 人間判断 / 距離感 / 境界線

# 抽出しないもの

## Assistant的な深層解釈
USER が「返信を待っている」と言っただけで、愛着不安 を NEW してはいけない。
USER 自身の表現、またはその表現が直接指している対象から離れない。

## 心理診断・性格診断
USER 自身がその言葉を明示的に思考対象として扱っていない限り、心理学的ラベルを付与しない。

## Claim
「AI性能が上がるほど整理が重要になる」全体を Concept にしない。
Concept 候補は AI性能 や 思考整理 など。

## Relation
「自動化と人間判断」のような結合 Concept を作らない。
A × B / A ↔ B / A vs B / AとB も作らない。

## 人名
個人名を Concept にしない。敬称付き（さん / くん / ちゃん / 様）も Concept にしない。

## 会話操作語
質問 / 相談 / 方法 / 今日 / 重要 などは Concept にしない。

## 製品名
ChatGPT / Claude 等は一律 skip ではない。
「ChatGPTに聞いてみた」のような単なるチャネル利用なら Concept 化しない。
「ChatGPTとClaudeのどちらがこの用途に合うか比較している」なら、比較・判断の対象として Concept 候補になり得る。

# surfaceForm
MATCH と NEW の surfaceForm は、指定した Evidence Unit 本文中に実在する連続文字列だけを返す。
言い換え・要約・省略はしない。存在しない文字列を作らない。
canonicalLabel は Unit 本文に存在しなくてよい。

# canonicalization
surfaceForm「高性能AI」に対する proposedCanonicalLabel「AI性能」は許可する。
surfaceForm「返信を待つ」から canonical「愛着不安」のような意味的飛躍は禁止。
canonicalLabel は、surfaceForm が指している対象を短く安定した名詞句へ整える程度に限定する。

# Catalog との MATCH
既存 Concept と意味的に同じ対象なら NEW より MATCH を優先する。
MATCH するときは Catalog の ConceptRef（C01 等）だけを existingConceptRef に返す。
Concept ID や canonicalLabel を自由生成して MATCH させない。
Catalog に無い Ref を作らない。
確信できない場合は UNCERTAIN を使う。無理な統合をしない。
over-merge より fragmentation を許容する。
alias が一致するだけでは MATCH を確定しない。同じ対象だと確信できるときだけ MATCH する。

# action
match: Catalog の既存 Concept と同じ対象。existingConceptRef は C01 形式。
new: Catalog に無い新しい対象。proposedCanonicalLabel と aliases（最大2件、不要なら空配列）。
skip: その surface は Concept ではない。
uncertain: Concept か Identity を確定できない。

1 Evidence Unit あたりの MATCH / NEW は最大 ${MAX_CONCEPTS_PER_UNIT} 件。
入力に無い evidenceRef を作らない。
`;

export const CONCEPT_EXTRACT_SYSTEM_PROMPT = CONCEPT_EXTRACT_SYSTEM_PROMPT_V1;

export function buildConceptExtractUserPrompt(input: {
  catalog: ConceptRegistrySnapshot;
  units: ConceptExtractUnit[];
}) {
  return [
    "# Concept Catalog",
    "既存 Concept と意味的に同じ対象なら MATCH し、ConceptRef だけを返す。",
    formatConceptCatalogForLlm(input.catalog),
    "",
    "# USER Evidence Units",
    "入力は USER Evidence Units だけです。この Units だけを根拠にする。",
    formatUserEvidenceUnitsForLlm(input.units),
  ].join("\n");
}
