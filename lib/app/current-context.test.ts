import assert from "node:assert/strict";
import test from "node:test";
import { APP_NAME } from "./identity";
import {
  currentProjectContext,
  formatCurrentContextBlock,
} from "./current-context";

test("Case A: Current Context の現在名称は思考統合研究所", () => {
  assert.equal(currentProjectContext.projectName, "思考統合研究所");
  assert.equal(APP_NAME, currentProjectContext.projectName);
  const block = formatCurrentContextBlock();
  assert.match(block, /CURRENT CONTEXT/);
  assert.match(block, /Project Name:\n思考統合研究所/);
  assert.match(block, /Core Purpose:/);
  assert.match(block, /次のAI対話へ再利用できるようにする/);
});

test("Case B: 歴史的な名称は Current Context から削除せず、歴史として扱う指示がある", () => {
  const block = formatCurrentContextBlock();
  assert.match(block, /Historical project names appearing in Sessions are historical context only/);
  assert.doesNotMatch(block, /思考補完計画/);
});

test("Case C: Current Context は Evidence ではなく、それだけで Shift を作らない", () => {
  const block = formatCurrentContextBlock();
  assert.match(block, /Current Context and Core Purpose are not Evidence/);
  assert.match(block, /invent a Shift or Cross Insight from them alone/);
});

test("将来フィールドがあれば CURRENT CONTEXT に出せる", () => {
  const block = formatCurrentContextBlock({
    projectName: "思考統合研究所",
    corePurpose: currentProjectContext.corePurpose,
    currentGoal: "対話を再利用する",
    currentMvpScope: "統合レビュー",
    adoptedDecisions: ["Cursorを使い続ける"],
    deprecatedDecisions: ["思考補完計画という名称"],
    currentTools: ["Cursor"],
  });
  assert.match(block, /Current Goal:\n対話を再利用する/);
  assert.match(block, /Current MVP Scope:\n統合レビュー/);
  assert.match(block, /- Cursorを使い続ける/);
  assert.match(block, /- 思考補完計画という名称/);
  assert.match(block, /- Cursor/);
});
