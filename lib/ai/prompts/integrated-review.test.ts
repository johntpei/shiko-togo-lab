import assert from "node:assert/strict";
import test from "node:test";
import { currentProjectContext } from "@/lib/app/current-context";
import { createReviewEvidenceAliasContractV2 } from "@/lib/ai/review-evidence-transport";
import {
  INTEGRATED_REVIEW_PROMPT_V1,
  INTEGRATED_REVIEW_PROMPT_V2,
  INTEGRATED_REVIEW_PROMPT_V3,
  INTEGRATED_REVIEW_PROMPT_V4,
  INTEGRATED_REVIEW_PROMPT_V5,
  INTEGRATED_REVIEW_PROMPT_V6,
  INTEGRATED_REVIEW_PROMPT_V7,
  INTEGRATED_REVIEW_PROMPT_V8,
  INTEGRATED_REVIEW_PROMPT_V9,
  INTEGRATED_REVIEW_PROMPT_VERSION,
  INTEGRATED_REVIEW_SYSTEM_PROMPT,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V1,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V4,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V5,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V6,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V7,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V8,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V9,
  buildIntegratedReviewUserPromptV5,
  buildIntegratedReviewUserPromptV6,
  buildIntegratedReviewUserPromptV7,
  buildIntegratedReviewUserPromptV8,
  buildIntegratedReviewUserPromptV9,
} from "./integrated-review";

test("現行 promptVersion は integrated-review-v9", () => {
  assert.equal(INTEGRATED_REVIEW_PROMPT_VERSION, "integrated-review-v9");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V9, "integrated-review-v9");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V8, "integrated-review-v8");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V7, "integrated-review-v7");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V6, "integrated-review-v6");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V5, "integrated-review-v5");
  assert.equal(INTEGRATED_REVIEW_SYSTEM_PROMPT, INTEGRATED_REVIEW_SYSTEM_PROMPT_V9);
});

test("v1〜v5 プロンプトは残している", () => {
  assert.equal(INTEGRATED_REVIEW_PROMPT_V1, "integrated-review-v1");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V2, "integrated-review-v2");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V3, "integrated-review-v3");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V4, "integrated-review-v4");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V5, "integrated-review-v5");
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V1, /要約ではありません/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V4, /解釈文そのものが原文に無くてよい/);
});

test("v6 は v5 semantic policyを維持してtransport参照だけalias化する", () => {
  for (const semantic of [
    "Claimを先に考え、後からEvidenceを探してはいけない",
    "PHASE A",
    "PHASE B",
    "PHASE C",
    "2 Session 未満の Theme / Tension / Insight / Hypothesis は出さない",
  ]) {
    assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, new RegExp(semantic));
    assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V6, new RegExp(semantic));
  }
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V6, /EvidenceAlias/);
  assert.doesNotMatch(INTEGRATED_REVIEW_SYSTEM_PROMPT_V6, /S01:M003:E02/);
  const user = buildIntegratedReviewUserPromptV6(
    "#S\tS01\n#M\tM001\tU\n0\tEvidence本文",
  );
  assert.match(user, /ASCII EvidenceAlias/);
  assert.match(user, /evidenceAliases/);
  assert.match(user, /UはUSER、AはASSISTANT/);
  assert.match(user, /一字も変えず/);
});

test("v7 は v6 semantic policyを維持しalias exact-copy contractだけを強化する", () => {
  for (const semantic of [
    "Claimを先に考え、後からEvidenceを探してはいけない",
    "PHASE A",
    "PHASE B",
    "PHASE C",
    "2 Session 未満の Theme / Tension / Insight / Hypothesis は出さない",
  ]) {
    assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V6, new RegExp(semantic));
    assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V7, new RegExp(semantic));
  }
  const user = buildIntegratedReviewUserPromptV7(
    "#S\tS01\n#M\tM001\tU\n0A\tEvidence本文",
    2,
  );
  assert.match(user, /正確に 2 文字/);
  assert.match(user, /0-9、A-Z、a-z/);
  assert.match(user, /大文字と小文字は区別/);
  assert.match(user, /prefix、括弧、引用符、前後の空白を追加しない/);
  assert.match(user, /旧形式のSession\/Message\/Evidence参照/);
  assert.match(user, /入力のEvidence行に実在するaliasだけ/);
  assert.doesNotMatch(user, /EvidenceRef/);
  assert.doesNotMatch(user, /S01:M003:E02/);
});

test("v8 は v7 semantic policyを維持しSession/Message metadataとの区別だけを明確化する", () => {
  for (const semantic of [
    "Claimを先に考え、後からEvidenceを探してはいけない",
    "PHASE A",
    "PHASE B",
    "PHASE C",
    "2 Session 未満の Theme / Tension / Insight / Hypothesis は出さない",
  ]) {
    assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V7, new RegExp(semantic));
    assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V8, new RegExp(semantic));
  }
  const user = buildIntegratedReviewUserPromptV8(
    "#S\tS01\n#M\tM001\tU\n0A\tEvidence本文",
    2,
  );
  assert.match(user, /正確に 2 文字/);
  assert.match(user, /S01.*metadataでありEvidenceAliasではありません/);
  assert.match(user, /M001.*metadataでありEvidenceAliasではありません/);
  assert.match(user, /evidenceGroups\.sessionRefだけ/);
  assert.match(user, /bare EvidenceAliasだけ/);
  assert.doesNotMatch(user, /EvidenceRef/);
  assert.doesNotMatch(user, /S01:M003:E02/);
});

test("v9 は v8 semantic policyを維持しreserved namespace contractだけを追加する", () => {
  for (const semantic of [
    "Claimを先に考え、後からEvidenceを探してはいけない",
    "PHASE A",
    "PHASE B",
    "PHASE C",
    "2 Session 未満の Theme / Tension / Insight / Hypothesis は出さない",
  ]) {
    assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V8, new RegExp(semantic));
    assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V9, new RegExp(semantic));
  }
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V9, /大文字のMまたはS/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V9, /M001.*MessageRef/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V9, /S01.*SessionRef/);
});

test("v9 prompt examples and reserved namespace instructions follow each request contract", () => {
  for (const count of [1, 61, 3_721]) {
    const contract = createReviewEvidenceAliasContractV2(count);
    const evidenceAlias = contract.exampleAliases[0]!;
    const user = buildIntegratedReviewUserPromptV9(
      `#S\tS01\n#M\tM001\tU\n${evidenceAlias}\tEvidence本文`,
      contract,
    );

    assert.match(user, new RegExp(`正確に ${contract.width} 文字`));
    assert.match(user, new RegExp(`正しいEvidenceAliasの例: ${evidenceAlias}`));
    assert.match(user, /大文字のMとSは予約/);
    assert.match(user, /M001はMessageRef、S01はSessionRef/);
    assert.match(user, /evidenceGroups\.sessionRefだけ/);
    assert.equal(contract.isLexicallyValid(evidenceAlias), true);
    assert.equal(evidenceAlias.length, contract.width);
  }
});

test("v5 は Evidence-first でありプロジェクト名をハードコードしない", () => {
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /Claimを先に考え、後からEvidenceを探してはいけない/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /PHASE A/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /PHASE B/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /PHASE C/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /evidenceGroups/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /relationType/);
  assert.doesNotMatch(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V5,
    new RegExp(currentProjectContext.projectName),
  );
});

test("Case L: Current Context は Evidence に数えない", () => {
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V5,
    /Current Context は Evidence ではない。session数にも数えない/,
  );
  const user = buildIntegratedReviewUserPromptV5("SESSION S01");
  const contextIdx = user.indexOf("CURRENT CONTEXT");
  const sessionIdx = user.indexOf("SESSION S01");
  assert.ok(contextIdx >= 0 && sessionIdx > contextIdx);
});

test("v6でもCurrent Contextをcompact Sessionより前に置く", () => {
  const user = buildIntegratedReviewUserPromptV6("#S\tS01");
  assert.ok(user.indexOf("CURRENT CONTEXT") < user.indexOf("#S\tS01"));
});

test("Case H: fake EvidenceRef を作らない", () => {
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /存在しないrefを作らない/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /fake ref を作らず/);
});

test("v6 はfake aliasを作らない", () => {
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V6, /存在しないaliasを作らない/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V6, /fake alias を作らず/);
});

test("Case M / N: Next Question は発見から作り、一般質問は禁止", () => {
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V5,
    /有効になった Cross Insight \/ Tension \/ Shift \/ Hypothesis \/ Open Question から作る/,
  );
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /次のステップは何か？/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /保存・統合・再利用のどこを最も優先/);
});
