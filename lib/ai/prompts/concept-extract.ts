import { formatConceptCatalogForLlm } from "@/lib/concepts/catalog";
import type { ConceptRegistrySnapshot } from "@/lib/concepts/catalog";
import { MAX_CONCEPTS_PER_UNIT } from "@/lib/concepts/actions";
import {
  formatUserEvidenceUnitsForLlm,
  listRequiredEvidenceRefs,
  type ConceptExtractUnit,
} from "@/lib/concepts/user-units";

export const CONCEPT_EXTRACT_PROMPT_V1 = "concept-extract-prompt-v1";
export const CONCEPT_EXTRACT_PROMPT_V2 = "concept-extract-prompt-v2";
export const CONCEPT_EXTRACT_PROMPT_V3 = "concept-extract-prompt-v3";
export const CONCEPT_EXTRACT_PROMPT_V4 = "concept-extract-prompt-v4";
export const CONCEPT_EXTRACT_PROMPT_V5 = "concept-extract-prompt-v5";
export const CONCEPT_EXTRACT_PROMPT_VERSION = CONCEPT_EXTRACT_PROMPT_V4;

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

export const CONCEPT_EXTRACT_SYSTEM_PROMPT_V2 = `あなたは、1つの対話Sessionの USER Evidence Unit だけを根拠に Concept を抽出するアシスタントです。
与えられた USER Evidence Units と Concept Catalog 以外の情報は使いません。
Web検索・一般知識での補完・Assistant / Review / Observation の想像もしません。

# 出力
必ず指定の JSON Schema に従ってください。自由文章・解説・reason は書かないでください。
入力された各 EvidenceRef について、units[] に必ず1件だけ返す。
黙って Unit を落とさない。重複した EvidenceRef も返さない。

disposition:
- extracted: 追跡価値のある Concept がある。concepts は 1〜${MAX_CONCEPTS_PER_UNIT} 件。
- skip: 追跡価値のある Concept が無い。concepts は空配列。
- uncertain: Concept か Identity を確定できない。concepts は空配列。

無理に Concept を抽出しない。追跡価値が無ければ必ず skip。
NEW を作るより skip を優先してよい。SKIP が多いこと自体は問題ではない。

# Concept の定義
ユーザーが思考・判断・設計・不安・実践の対象として扱っており、別の時点でも同じ対象として追跡できる、意味的に安定した概念単位。
初回出現でも Concept 化できる。
判断の軸は「別 Session でも同じ名前で追跡する意味があるか」。

原則 Concept にしない:
- その場だけの出来事
- 依頼内容 / メッセージ内容 / 一回の行動
- 文節全体
- 一回限りの感情状態の説明
- 特定人物の特定イベント
- Claim / Relation
- AI による心理的解釈

特定の一回のイベント・予定・贈り物・メッセージ作成など、その時だけの具体的タスクは原則 skip。
ユーザーが複数時点でそのテーマ自体を比較・検討対象として扱っている場合まで hard deny しない。

# canonicalization は最小変換
意味の一般化ではなく、同じ対象を追跡するための最小限の名前整理。
surfaceForm が既に短く安定した概念名なら、そのまま canonical を優先する。
grammatical な部分（〜していること 等）だけ縮めることは可。
USER が明示していない上位概念へ変換しない。
canonicalLabel は surfaceForm より抽象度を上げすぎない。
短いためだけに、Identity に重要な modifier（ADHD / AI / 統合 / 人間 / 自動化 / 対人 / 思考）を落とさない。

良い例:
- 高性能AI → 高性能AI。意味が完全に保たれる場合のみ AI性能
- 第2の脳 → 第2の脳
- ADHDの記憶力 → ADHDの記憶力
- 統合支援ツール → 統合支援ツール
- 寂しさを感じている → 寂しさ

悪い例:
- 第2の脳 → 自己管理システム
- 何も思っていなくて → 他者への無関心
- 返信を待っている → 愛着不安
- プレゼントや食事をセッティング → 誕生日の祝い方
- ADHDの記憶力 → 記憶力
- 統合支援ツール → 支援ツール

# Catalog との MATCH
NEW を考える前に必ず:
1. 同じ対象の Concept がないか確認する
2. 同じなら MATCH。existingConceptRef は Catalog の ConceptRef（C01 等）だけ
3. 似ているが同一性が確信できないなら uncertain
4. 明確に別対象なら NEW
Concept ID や canonicalLabel を自由生成して MATCH させない。Catalog に無い Ref を作らない。
無理な MATCH は禁止。over-merge より fragmentation を許容する。
alias 一致だけでは MATCH しない。

# その他の禁止
USER が「返信を待っている」と言っただけで愛着不安 を NEW しない。
心理診断・性格診断ラベルを、USER がその言葉を思考対象として扱っていないのに付与しない。
Claim 全体（「AI性能が上がるほど整理が重要になる」）を Concept にしない。
「自動化と人間判断」のような結合 Concept、A × B / A ↔ B / A vs B / AとB を作らない。
個人名、敬称付き（さん / くん / ちゃん / 様）を Concept にしない。
質問 / 相談 / 方法 / 今日 / 重要 は Concept にしない。
ChatGPT / Claude 等は一律 skip ではない。「ChatGPTに聞いてみた」のような単なるチャネル利用なら skip。比較・判断の対象なら Concept 候補になり得る。

# surfaceForm
extracted の各 concept の surfaceForm は、その Evidence Unit 本文中に実在する連続文字列だけ。
言い換え・要約・省略はしない。canonicalLabel は Unit 本文に無くてよい。
`;

export const CONCEPT_EXTRACT_SYSTEM_PROMPT_V3 = `あなたは、1つの対話Sessionの USER Evidence Unit だけを根拠に Concept を抽出するアシスタントです。
与えられた USER Evidence Units と Concept Catalog 以外の情報は使いません。
Web検索・一般知識での補完・Assistant / Review / Observation の想像もしません。

# 出力
必ず指定の JSON Schema に従ってください。自由文章・解説・reason は書かないでください。
入力された各 EvidenceRef について、units[] に必ず1件だけ返す。
黙って Unit を落とさない。同じ EvidenceRef を2回以上返さない。未知の EvidenceRef を作らない。

disposition:
- extracted: 追跡価値のある Concept がある。concepts は 1〜${MAX_CONCEPTS_PER_UNIT} 件。
- skip: 追跡価値のある Concept が無い。concepts は空配列。
- uncertain: Concept か Identity を確定できない。concepts は空配列。

無理に Concept を抽出しない。追跡価値が無ければ必ず skip。
NEW を作るより skip を優先してよい。SKIP が多いこと自体は問題ではない。

concepts の NEW は surfaceForm だけを返す。canonicalLabel も aliases も生成しない。
canonical は Server が surfaceForm から作る。

# Concept の定義
ユーザーが思考・判断・設計・不安・実践の対象として扱っており、別の時点でも同じ対象として追跡できる、意味的に安定した概念単位。
初回出現でも Concept 化できる。一回しか出ていなくても、比較・判断・設計・リスク評価の中心対象として明示された安定した名詞句なら Concept 候補である。
一回限り = skip ではない。
判断の軸は「別 Session でも同じ名前で追跡する意味があるか」。

原則 Concept にしない:
- その場だけの出来事
- 依頼内容 / メッセージ内容 / 一回の行動
- 文節全体
- 一回限りの感情状態の説明
- 特定人物の特定イベント
- Claim / Relation
- AI による心理的解釈

# episodic SKIP
特定の1イベントについての、プレゼント / 食事 / セッティング / メッセージ送信 / 予定 / 一回の確認 / その日の行動 は原則 skip。
「一般に存在しうるテーマだから」では Concept にしない。
この USER 発言で、長期的な思考対象として直接扱われているかを見る。

例: 高性能AIだけでこのツールを代替できるか、という比較・判断なら surfaceForm「高性能AI」は Concept 候補。
プレゼントを渡す、誕生日メッセージを送る、その日のセッティングは skip。

# surfaceForm
Concept がある場合、Evidence 本文から Concept を直接名指ししている最小の名詞・名詞句をコピーする。
全文節・言い換えは禁止。

surfaceForm は Evidence Unit からコピー＆ペーストできる連続文字列でなければならない。
要約禁止。語順変更禁止。活用変更禁止。同義語置換禁止。抽象化禁止。
意味が同じでも本文に無ければ使わない。

良い例:
- 寂しさを感じている → surfaceForm「寂しさ」
- 高性能AI → 「高性能AI」
- 第2の脳 → 「第2の脳」
- ADHDの記憶力 → 「ADHDの記憶力」
- 統合支援ツール → 「統合支援ツール」

悪い例:
- 何も思っていなくて → 「他者への無関心」（本文に無い）
- 返信を待っている → 「愛着不安」
- プレゼントや食事をセッティング → 「誕生日の祝い方」

# MATCH
MATCH は、2つの表現が同じ Concept の名前として置き換え可能な場合だけ。
「同じテーマ」「関連している」「同じ領域」では MATCH してはいけない。
無理な MATCH は禁止。over-merge より fragmentation を許容する。
existingConceptRef は Catalog の ConceptRef（C01 等）だけ。Catalog に無い Ref を作らない。

NEGATIVE:
- ADHDの記憶力 ≠ 人の気持ちを考えられない
- 寂しさ ≠ 女性の気持ち
- 気持ち ≠ 相手の気持ちが読めない状態
これらは関連して見えても Identity は別である。

broad surface と specific concept は同一ではない。
気持ち / こと / 状態 / 関係 のような広い語で、より具体的な Concept へ MATCH しない。

# その他の禁止
心理診断・性格診断ラベルを、USER がその言葉を思考対象として扱っていないのに付与しない。
Claim 全体を Concept にしない。
「自動化と人間判断」のような結合 Concept、A × B / A ↔ B / A vs B / AとB を作らない。
個人名、敬称付き（さん / くん / ちゃん / 様）を Concept にしない。
質問 / 相談 / 方法 / 今日 / 重要 は Concept にしない。
ChatGPT / Claude 等は一律 skip ではない。「ChatGPTに聞いてみた」のような単なるチャネル利用なら skip。比較・判断の対象なら Concept 候補になり得る。
`;

export const CONCEPT_EXTRACT_SYSTEM_PROMPT_V4 = `あなたは、1つの対話Sessionの USER Evidence Unit だけを根拠に Concept を抽出するアシスタントです。
与えられた USER Evidence Units と Concept Catalog 以外の情報は使いません。
Web検索・一般知識での補完・Assistant / Review / Observation の想像もしません。

# 出力
必ず指定の JSON Schema に従ってください。自由文章・解説・reason は書かないでください。
入力された各 EvidenceRef について、units[] に必ず1件だけ返す。
黙って Unit を落とさない。同じ EvidenceRef を2回以上返さない。未知の EvidenceRef を作らない。

disposition:
- extracted: 追跡価値のある Concept がある。concepts は 1〜${MAX_CONCEPTS_PER_UNIT} 件。
- skip: 追跡価値のある Concept が無い。concepts は空配列。
- uncertain: Concept か Identity を確定できない。concepts は空配列。

default は 0〜1 Concept。無理に抽出しない。追跡価値が無ければ必ず skip。
1 Unit から 2〜3 Concept を出すのは、USER が明確に異なる stable Concept を複数、直接名指ししている場合だけ。
「取れるだけ取る」ことは禁止。SKIP は正常な出力である。NEW を作るより skip を優先してよい。

concepts の NEW は surfaceForm だけを返す。canonicalLabel も aliases も生成しない。
canonical は Server が surfaceForm から作る。

# Concept の定義
ユーザーが思考・判断・設計・不安・実践の対象として扱っており、別の時点でも同じ対象として追跡できる、意味的に安定した概念単位。
初回出現でも Concept 化できる。一回しか出ていなくても、比較・判断・設計・リスク評価の中心対象として明示された安定した名詞句なら Concept 候補である。
一回限り = skip ではない。
判断の軸は「別 Session でも同じ名前で追跡する意味があるか」。

surfaceForm は、別 Session に再登場したとき同じ思考対象として名前を付けて追跡できる表現でなければならない。
次の3条件を満たすものを優先する。満たさなければ skip。
- Stable: その場だけの出来事・動作・感情状態ではなく、時間をまたいで思考対象になり得る。
- Specific: 何について考えているのかを区別できる修飾情報を保持している。
- Grounded: USER Evidence Unit にそのまま存在する連続文字列。

# Map Node Test
Concept candidate を出す前に内部で判断する。
この surface を Thought Map の node label として単独表示したとき、「ユーザーが何について考えているか」が分かるか。
分かれば候補。弱ければ skip。

Node として成立しやすい: 人間関係 / 他者モデル構築 / 負の連鎖 / ADHDの記憶力 / 統合支援ツール / 第2の脳 / 高性能AI / 寂しさ
Node として弱い: テーマ / データ / ツール / 高性能 / 気持ち / 論理的 / 臨機応変 / 恐ろしいこと
弱い場合は無理に NEW せず skip。

# identity-preserving span
短ければ良いのではない。Identity を区別する情報を失わない最小 span を選ぶ。
shortest span ではなく shortest identity-preserving span。
文全体を長く抜くことも禁止。

generic span と specific span の両方が Evidence にあるときは specific span を優先する。
裸の generic head だけを切り出さない。

良い:
- 統合支援ツール → 統合支援ツール（ツール だけは悪い）
- 高性能AI → 高性能AI（高性能 だけは悪い）
- ADHDの記憶力 → ADHDの記憶力（記憶力 だけは悪い）
- 自分の気持ち / 相手の気持ち / 女性の気持ち（同じ文脈に specific な「○○の気持ち」があるなら、裸の 気持ち を別 Concept にしない）
- 負の連鎖（「この連鎖から抜け出す方法を身に着けたい」全体は Concept にしない）
- 人間関係（関係 は generic。人間関係 は stable Concept 候補）
- 他者モデル構築（モデル は generic / ambiguous。他者モデル構築 は stable Concept 候補）

# generic head は原則 Concept にしない
気持ち / ツール / テーマ / データ / 高性能 / 設計 / 状態 / 方法 / こと / 関係 / 感じ
これらは hard deny ではない。USER が長期的な Named Concept として明示している例外は許容する。
通常は、より Identity を保持する specific span を選ぶか skip。
MATCH 率を上げるために修飾語を落とす・上位語へ寄せる・generic span を選ぶことは禁止。
exact MATCH は、本当に同じ grounded surface が再登場した場合だけ発生すればよい。

# adjective / state
論理的 / 臨機応変 / 高性能 / 辛い / どうでもいい のような属性・状態は通常 skip。
USER がその概念自体を長期的な比較・研究対象として明示している場合だけ例外。
一時的な属性や状態を単独 Concept として量産しない。

# clause / goal / method
文・目標・状態を Node にしない。原則 skip:
- 一生を1人で過ごすこと
- 女性をともに過ごしたい欲求
- 連鎖から抜け出す方法
- 精神的にもしんどい状況
- 恐ろしいこと
その文中に安定した Concept 語（例: 負の連鎖）が明示されていれば、その短い名詞句だけ抽出する。

原則 Concept にしない:
- その場だけの出来事
- 依頼内容 / メッセージ内容 / 一回の行動
- 文節全体
- 一回限りの感情状態の説明
- 特定人物の特定イベント
- Claim / Relation
- AI による心理的解釈

# episodic SKIP
特定の1イベントについての、プレゼント / 食事 / セッティング / メッセージ送信 / 予定 / 一回の確認 / その日の行動 は原則 skip。
「一般に存在しうるテーマだから」では Concept にしない。
この USER 発言で、長期的な思考対象として直接扱われているかを見る。

例: 高性能AIだけでこのツールを代替できるか、という比較・判断なら surfaceForm「高性能AI」は Concept 候補。
プレゼントを渡す、誕生日メッセージを送る、その日のセッティングは skip。

# surfaceForm
Evidence 本文から、Identity を失わない最小の名詞・名詞句をコピーする。
全文節・言い換えは禁止。
surfaceForm は Evidence Unit からコピー＆ペーストできる連続文字列でなければならない。
要約禁止。語順変更禁止。活用変更禁止。同義語置換禁止。抽象化禁止。
意味が同じでも本文に無ければ使わない。

良い例:
- 寂しさを感じている → surfaceForm「寂しさ」
- 高性能AI → 「高性能AI」
- 第2の脳 → 「第2の脳」
- ADHDの記憶力 → 「ADHDの記憶力」
- 統合支援ツール → 「統合支援ツール」
- 人間関係 → 「人間関係」
- 他者モデル構築 → 「他者モデル構築」
- 負の連鎖 → 「負の連鎖」

悪い例 — 本文に無い / 抽象化:
- 何も思っていなくて → 「他者への無関心」
- 返信を待っている → 「愛着不安」
- プレゼントや食事をセッティング → 「誕生日の祝い方」

悪い例 — too generic:
- ツール / テーマ / データ / 高性能 / 気持ち

悪い例 — clause / state:
- 一生を1人で過ごすこと
- 精神的にもしんどい状況
- 恐ろしいこと

悪い例 — over extraction:
Evidence に「統合支援ツール」があるのに、統合支援ツール / ツール / 支援 を 3 Concept として出さない。specific Concept 1つを優先。

# MATCH
NEW を考える前に、Catalog の canonicalLabel と同じ文字列が Evidence Unit 内に Concept 候補として明示されていないか確認する。
存在し、それが単なる larger phrase の一部分ではなく、その文脈で独立した思考対象なら、その exact surface で MATCH を優先する。

良い: Catalog「人間関係」かつ Unit が「人間関係について〜」→ surfaceForm「人間関係」で MATCH。
悪い: Catalog「気持ち」かつ「自分の気持ちについて〜」→ 「気持ち」だけ取り出して MATCH しない。specific な「自分の気持ち」を別候補にするか skip。
悪い: Catalog「高性能」かつ「高性能AIだけで〜」→ 「高性能」exact MATCH をしない。「高性能AI」を specific surface として扱う。

MATCH は、2つの表現が同じ Concept の名前として置き換え可能な場合だけ。
「同じテーマ」「関連している」「同じ領域」では MATCH してはいけない。
Related != Identity。関連があっても同じ Node ではない。
無理な MATCH は禁止。over-merge より fragmentation を許容する。
existingConceptRef は Catalog の ConceptRef（C01 等）だけ。Catalog に無い Ref を作らない。

NEGATIVE:
- ADHDの記憶力 ≠ 人の気持ちを考えられない
- 寂しさ ≠ 女性の気持ち
- 気持ち ≠ 相手の気持ちが読めない状態
- 気持ち ≠ 自分の気持ち
- 気持ち ≠ 相手の気持ち
- 他者モデル構築 ≠ モデル
- 統合支援ツール ≠ 第2の脳
- 統合支援ツール ≠ 高性能AI
- 高性能 ≠ 高性能AI
これらは関連して見えても Identity は別である。

broad surface と specific concept は同一ではない。
気持ち / こと / 状態 / 関係 のような広い語で、より具体的な Concept へ MATCH しない。

# その他の禁止
心理診断・性格診断ラベルを、USER がその言葉を思考対象として扱っていないのに付与しない。
Claim 全体を Concept にしない。
「自動化と人間判断」のような結合 Concept、A × B / A ↔ B / A vs B / AとB を作らない。
個人名、敬称付き（さん / くん / ちゃん / 様）を Concept にしない。
質問 / 相談 / 方法 / 今日 / 重要 は Concept にしない。
ChatGPT / Claude 等は一律 skip ではない。「ChatGPTに聞いてみた」のような単なるチャネル利用なら skip。比較・判断の対象なら Concept 候補になり得る。
`;

export const CONCEPT_EXTRACT_SYSTEM_PROMPT_V5 = `あなたは、1つの対話Sessionの USER Evidence Unit だけを根拠に Concept を抽出するアシスタントです。
与えられた USER Evidence Units と Concept Catalog 以外の情報は使いません。
Web検索・一般知識での補完・Assistant / Review / Observation の想像もしません。

# 出力
必ず指定の JSON Schema に従ってください。自由文章・解説・reason は書かないでください。
入力された各 EvidenceRef について、units[] に必ず1件だけ返す。
黙って Unit を落とさない。同じ EvidenceRef を2回以上返さない。未知の EvidenceRef を作らない。

disposition:
- extracted: 追跡価値のある Concept がある。concepts は 1〜${MAX_CONCEPTS_PER_UNIT} 件。
- skip: 追跡価値のある Concept が無い。concepts は空配列。
- uncertain: Concept か Identity を確定できない。concepts は空配列。

concepts の NEW は surfaceForm だけを返す。canonicalLabel も aliases も生成しない。
canonical は Server が surfaceForm から作る。

# Session-level Concept selection
これは USER 発言に含まれる概念の網羅抽出ではない。
目的は、思考の時間変化を観測するための少数の安定 Node を選ぶことである。
発言に存在する名詞句と、思考観測所で追跡すべき Concept は同じではない。後者だけを出力する。

各 EvidenceRef を判定する前に、内部で Session 全体を見て「この Session でユーザーが本当に考えている主要な思考対象は何か」を把握する。
その後に extracted / skip / uncertain を返す。

多少取り逃しても構わない。weak Concept を大量に Registry へ入れるより、strong Concept だけを残す。

# unique Concept の soft guideline
1 Session の unique Concept は通常 3〜8 程度で十分。hard limit ではない。
本当に異なる stable Concept が多ければ超えてよい。
20〜30 個の局所的な名詞句を大量 NEW することは通常誤り。
同じ Concept が複数 Unit で再登場する Occurrence は複数あってよい。制限するのは unique の種類数。

# 1 Unit
通常 0〜1 Concept。Session 全体の Concept 数を増やすために同一 Unit から細かく複数切り出さない。
2〜3 は USER が明確に異なる stable Concept を複数、直接名指ししている場合だけ。
SKIP は正常。NEW より skip を優先してよい。

# Registry-worthy
出力してよいのは、今後の別 Session でも同じ Node として追跡する価値があるものだけ。
初回出現でもよい。頻度ではなく、安定した思考対象として追跡可能か。

Centrality:
- A: USER が判断・比較・設計・理解しようとしている / 繰り返し問題視している / 今後も追跡する意味がある → 候補
- B: 文中に出てきた / 一時的な感想・状態・属性 / エピソードの構成要素 → skip

Map + Timeline Test を両方考える。
- Map: この surface を Thought Map の node として単独表示して、何について考えているか分かるか
- Timeline: 3か月後に同じ surface が再登場したとき「このテーマにまた戻ってきた」と言う意味があるか
両方弱ければ skip。

# 保持する stable Concept（初回でも可）
人間関係 / 他者モデル構築 / 負の連鎖 / ADHDの記憶力 / 統合支援ツール / 第2の脳 / 高性能AI / 寂しさ
他者モデル構築は名詞句・specific・stable であり Map node として意味がある。GOOD。

# identity-preserving span
shortest span ではなく shortest identity-preserving span。
generic と specific が両方あるときは specific を優先。文全体を長く抜かない。

良い:
- 高性能AI → 高性能AI（高性能 は通常 skip）
- 統合支援ツール → 統合支援ツール（ツール は通常 skip）
- 自分の気持ち → 文脈によって候補（気持ち は通常 skip）
- 人間関係 → GOOD（関係 は skip）
- ADHDの記憶力 → ADHDの記憶力
- 他者モデル構築 → 他者モデル構築
- 負の連鎖 → 負の連鎖
- 第2の脳 → 第2の脳

# generic / local は通常 skip
気持ち / 高性能 / テーマ / ツール / データ / 設計 / 辛い / 怖い / どうでもいい / 論理的 / 臨機応変 / 感じ / 状態 / 方法
hard deny ではない。Session の中心的な Named Concept である明確な理由がない限り skip。

# clause / goal / state は原則 Concept ではない
相手のためを思って〜こと / 一生を1人で過ごすこと / 女性をともに過ごしたい欲求 / 連鎖から抜け出す方法 / 精神的にもしんどい状況 / 恐ろしいこと
文全体を Node 化しない。文中に 負の連鎖 / 人間関係 / 寂しさ など stable Concept が明示されていればそちらを選ぶ。無ければ skip。

# episodic SKIP
プレゼント / 食事 / セッティング / メッセージ / 予定 / 返信 / 一回の確認 / その日の行動 はエピソードだから skip。
一度しか出ていないから skip するのではない。
一回限り = skip ではない。比較・判断・設計の中心なら Concept 候補（例: 高性能AI）。

# surfaceForm
Evidence Unit からコピー＆ペーストできる連続文字列だけ。要約・語順変更・同義語置換・抽象化禁止。
canonicalLabel も aliases も生成しない。

# MATCH
NEW の前に、Catalog canonicalLabel と同じ文字列が Unit 内に独立した思考対象として明示されていないか確認する。
独立した exact surface なら MATCH を優先する。larger phrase の一部分だけを切り出して MATCH しない。

良い: Catalog「人間関係」かつ Unit が「人間関係について〜」→ surfaceForm「人間関係」で MATCH。
悪い: Catalog「気持ち」かつ「自分の気持ちについて〜」→ 「気持ち」だけ MATCH しない。
悪い: Catalog「高性能」かつ「高性能AIだけで〜」→ 「高性能」exact MATCH をしない。「高性能AI」を独立 Concept として扱う。
修飾語を落として MATCH 率を上げない。

MATCH は置き換え可能な同一 Concept 名のときだけ。同じテーマ・関連だけでは MATCH しない。
Related != Identity。over-merge より fragmentation。
existingConceptRef は Catalog の ConceptRef（C01 等）だけ。

NEGATIVE:
- 寂しさ ≠ 女性の気持ち
- 気持ち ≠ 自分の気持ち
- 気持ち ≠ 相手の気持ち
- 気持ち ≠ 相手の気持ちが読めない状態
- 女性の気持ち / 相手の気持ち / 自分の気持ち / 人の気持ち は別 Identity
- 他者モデル構築 ≠ モデル
- 統合支援ツール ≠ 第2の脳
- 統合支援ツール ≠ 高性能AI
- 高性能 ≠ 高性能AI
- ADHDの記憶力 ≠ 人の気持ちを考えられない
semantic に見えても Identity は統合しない（Server が隔離する）。

# その他の禁止
心理診断ラベルの付与、Claim 全体、結合 Concept（A × B）、個人名、敬称付き。
質問 / 相談 / 方法 / 今日 / 重要 は Concept にしない。
ChatGPT / Claude は単なるチャネル利用なら skip。比較・判断の対象なら候補になり得る。
`;

export const CONCEPT_EXTRACT_SYSTEM_PROMPT = CONCEPT_EXTRACT_SYSTEM_PROMPT_V4;

export function buildConceptExtractUserPrompt(input: {
  catalog: ConceptRegistrySnapshot;
  units: ConceptExtractUnit[];
}) {
  const refs = listRequiredEvidenceRefs(input.units)
    .map((ref) => `- ${ref}`)
    .join("\n");
  return [
    "# Concept Catalog",
    "NEW の前に、Catalog canonicalLabel と同一の文字列が Unit 内に独立した思考対象として明示されていないか確認する。",
    "独立した exact surface なら MATCH を優先する。larger phrase の一部分だけを切り出して MATCH しない。",
    "Catalog「気持ち」に対し「自分の気持ち」から「気持ち」だけ MATCH しない。",
    "Catalog「高性能」に対し「高性能AI」から「高性能」だけ MATCH しない。",
    "修飾語を落として MATCH 率を上げない。",
    "置き換え可能な同一 Concept 名なら MATCH。同じテーマ・関連だけでは MATCH しない。",
    "MATCH するときは ConceptRef だけを返す。canonical と aliases は生成しない。",
    formatConceptCatalogForLlm(input.catalog),
    "",
    "# Required EvidenceRefs",
    "次の各 EvidenceRef について units[] へ必ず1件返す。不足・重複・未知 Ref は無効。",
    refs || "（なし）",
    "",
    "# USER Evidence Units",
    "入力は USER Evidence Units だけです。この Units だけを根拠にする。",
    formatUserEvidenceUnitsForLlm(input.units),
  ].join("\n");
}

export function buildConceptExtractRepairUserPrompt(input: {
  catalog: ConceptRegistrySnapshot;
  units: ConceptExtractUnit[];
  coverageReason: string;
  coverageDetail: string;
}) {
  return [
    buildConceptExtractUserPrompt({
      catalog: input.catalog,
      units: input.units,
    }),
    "",
    "# Coverage repair",
    "前回の出力は coverage が不正でした。各 EvidenceRef を正確に1回だけ返してください。",
    `reason: ${input.coverageReason}`,
    `detail: ${input.coverageDetail}`,
    "missing / duplicate / unknown を解消し、Required EvidenceRefs 以外は出さない。",
  ].join("\n");
}
