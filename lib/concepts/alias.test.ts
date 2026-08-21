import assert from "node:assert/strict";
import test from "node:test";
import {
  containsHonorificPerson,
  isHonorificPersonLabel,
} from "./honorific";
import {
  isEpisodicPhrase,
  isLongClauseLabel,
  validateAliasCandidate,
} from "./alias";
import { collectAliasCandidates } from "./catalog";

test("敬称付き個人名は suffix でも句中でも検出する", () => {
  assert.equal(isHonorificPersonLabel("田中さん"), true);
  assert.equal(isHonorificPersonLabel("距離感"), false);
  assert.equal(isHonorificPersonLabel("皆さん"), false);
  assert.equal(containsHonorificPerson("田中さん"), true);
  assert.equal(containsHonorificPerson("マエさんの誕生日"), true);
  assert.equal(containsHonorificPerson("皆さん"), false);
  assert.equal(containsHonorificPerson("ADHDの記憶力"), false);
});

test("alias は honorific / generic / 空 / 長文 / episodic を拒否する", () => {
  assert.equal(validateAliasCandidate("").ok, false);
  assert.equal(validateAliasCandidate("   ").ok, false);
  assert.equal(validateAliasCandidate("方法").ok, false);
  assert.equal(validateAliasCandidate("マエさんの誕生日").ok, false);
  assert.equal(
    validateAliasCandidate("相手のためを思ってやっているのに").ok,
    false,
  );
  assert.equal(validateAliasCandidate("プレゼントや食事をセッティング").ok, false);
  assert.equal(isLongClauseLabel("寂しさ"), false);
  assert.equal(isEpisodicPhrase("誕生日"), false);
  assert.equal(validateAliasCandidate("高性能AI", "AI性能").ok, true);
});

test("surfaceForm は自動 alias にせず、提案 alias だけを検証する", () => {
  const none = collectAliasCandidates({
    canonicalLabel: "誕生日",
    proposedAliases: [],
  });
  assert.deepEqual(none.accepted, []);
  assert.equal(none.rejected.length, 0);

  const honorific = collectAliasCandidates({
    canonicalLabel: "誕生日",
    proposedAliases: ["マエさんの誕生日"],
  });
  assert.deepEqual(honorific.accepted, []);
  assert.equal(honorific.rejected[0]?.reason, "honorific_person");

  const ok = collectAliasCandidates({
    canonicalLabel: "AI性能",
    proposedAliases: ["高性能AI"],
  });
  assert.deepEqual(ok.accepted, ["高性能AI"]);
});
