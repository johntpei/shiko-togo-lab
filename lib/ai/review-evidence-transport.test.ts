import assert from "node:assert/strict";
import test from "node:test";
import {
  INVALID_REVIEW_EVIDENCE_ALIAS_REF,
  REVIEW_EVIDENCE_ALIAS_ALPHABET,
  REVIEW_EVIDENCE_TRANSPORT_VERSION,
  buildCanonicalReviewEvidenceInput,
  decodeCompactReviewEvidenceText,
  diagnoseReviewEvidenceAliases,
  encodeCompactReviewEvidenceText,
  exactEvidenceRefForAlias,
  isReviewEvidenceAliasLexicallySafe,
} from "./review-evidence-transport";
import { resolveEvidenceRef } from "./evidence-refs";
import type { ReviewAnalyzeMessage, ReviewSessionSource } from "./review-input";

function message(
  id: string,
  index: number,
  role: string,
  content: string,
): ReviewAnalyzeMessage {
  return { id, index, role, content, attachmentsJson: null };
}

function source(
  id: string,
  occurredAt: string,
  messages: ReviewAnalyzeMessage[],
): ReviewSessionSource {
  return {
    session: {
      id,
      title: `Session ${id}`,
      occurredAt,
      source: "chatgpt",
      category: "test",
      createdAt: `${occurredAt}T00:00:00.000Z`,
    },
    messages,
    analysis: null,
  };
}

const sameText = "同じEvidence本文でも、provenanceが違えば別のIdentityとして保持します。";

test("compact transport is deterministic across incidental source/message order", () => {
  const a = source("a", "2026-07-01", [
    message("a-3", 1, "user", "同じindexではmessage IDをtie-breakerにします。"),
    message("a-2", 1, "assistant", "後のメッセージを明示indexで並べます。"),
    message("a-1", 0, "user", "先のメッセージを明示indexで並べます。"),
  ]);
  const b = source("b", "2026-08-01", [
    message("b-1", 0, "user", "別SessionのEvidenceも保持します。"),
  ]);

  const first = buildCanonicalReviewEvidenceInput([b, a]).transport;
  const second = buildCanonicalReviewEvidenceInput([
    { ...a, messages: [...a.messages].reverse() },
    b,
  ]).transport;

  assert.equal(first.serializationVersion, REVIEW_EVIDENCE_TRANSPORT_VERSION);
  assert.equal(first.serializedEvidence, second.serializedEvidence);
  assert.deepEqual(
    [...first.aliasByEvidenceRef.entries()],
    [...second.aliasByEvidenceRef.entries()],
  );
});

test("Session ordering uses stable ID after occurredAt and createdAt ties", () => {
  const a = source("a", "2026-07-01", [
    message("a-1", 0, "user", "Session Aの本文です。"),
  ]);
  const b = source("b", "2026-07-01", [
    message("b-1", 0, "user", "Session Bの本文です。"),
  ]);
  const { input, transport } = buildCanonicalReviewEvidenceInput([b, a]);

  assert.deepEqual(
    input.sessions.map((item) => item.sessionId),
    ["a", "b"],
  );
  assert.ok(
    transport.serializedEvidence.indexOf("#T\tSession a") <
      transport.serializedEvidence.indexOf("#T\tSession b"),
  );
});

test("aliases are unique, lexically safe, and exact refs round-trip", () => {
  const { input, transport } = buildCanonicalReviewEvidenceInput([
    source("a", "2026-07-01", [
      message("a-1", 0, "user", sameText),
      message("a-2", 1, "assistant", sameText),
    ]),
    source("b", "2026-08-01", [message("b-1", 0, "user", sameText)]),
  ]);

  assert.equal(transport.evidenceCount, input.units.length);
  assert.equal(transport.evidenceByAlias.size, input.units.length);
  assert.equal(transport.aliasByEvidenceRef.size, input.units.length);
  assert.equal(new Set(transport.evidenceByAlias.keys()).size, input.units.length);

  for (const unit of input.units) {
    const alias = transport.aliasByEvidenceRef.get(unit.ref);
    assert.ok(alias);
    assert.equal(alias.length, transport.aliasWidth);
    assert.equal(isReviewEvidenceAliasLexicallySafe(alias), true);
    assert.equal(exactEvidenceRefForAlias(alias, transport.evidenceByAlias), unit.ref);
    assert.match(alias, new RegExp(`^[${REVIEW_EVIDENCE_ALIAS_ALPHABET}]+$`));
    assert.ok(
      transport.serializedEvidence.includes(
        `${alias}\t${encodeCompactReviewEvidenceText(unit.text)}`,
      ),
    );
  }
});

test("Evidence text inline escaping is exact and keeps record boundaries unambiguous", () => {
  const text = "先頭\t値\n00\t本文に見える行\r\n末尾\\path ↵␍↹␛";
  const encoded = encodeCompactReviewEvidenceText(text);
  assert.equal(encoded.includes("\n"), false);
  assert.equal(encoded.includes("\r"), false);
  assert.equal(encoded.includes("\t"), false);
  assert.equal(decodeCompactReviewEvidenceText(encoded), text);

  const { input, transport } = buildCanonicalReviewEvidenceInput([
    source("a", "2026-07-01", [message("m-1", 0, "user", text)]),
  ]);
  assert.equal(input.units.length, 1);
  assert.equal(input.units[0]?.text, text);
  assert.match(transport.serializedEvidence, /^#S\t/m);
  assert.match(transport.serializedEvidence, /^0\t/m);
  assert.doesNotMatch(transport.serializedEvidence, /^S\t/m);
});

test("alias width expands beyond the two-character base62 namespace", () => {
  const count = REVIEW_EVIDENCE_ALIAS_ALPHABET.length ** 2 + 1;
  const messages = Array.from({ length: count }, (_, index) =>
    message(`m-${String(index).padStart(5, "0")}`, index, "user", `Evidence ${index} は十分な長さを持つ本文です。`),
  );
  const { transport } = buildCanonicalReviewEvidenceInput([
    source("large", "2026-07-01", messages),
  ]);

  assert.equal(transport.evidenceCount, count);
  assert.equal(transport.aliasWidth, 3);
  assert.equal(transport.evidenceByAlias.size, count);
});

test("duplicate Evidence text and duplicate Session content remain distinct", () => {
  const duplicatedMessages = [message("m-1", 0, "user", sameText)];
  const { input, transport } = buildCanonicalReviewEvidenceInput([
    source("a", "2026-07-01", duplicatedMessages),
    source("b", "2026-08-01", [
      message("m-2", 0, "user", sameText),
    ]),
  ]);

  assert.equal(input.units.length, 2);
  assert.equal(input.units[0]?.text, input.units[1]?.text);
  assert.notEqual(input.units[0]?.sessionId, input.units[1]?.sessionId);
  assert.notEqual(input.units[0]?.ref, input.units[1]?.ref);
  assert.notEqual(
    transport.aliasByEvidenceRef.get(input.units[0]!.ref),
    transport.aliasByEvidenceRef.get(input.units[1]!.ref),
  );
});

test("unknown aliases never fuzzy-match an exact Evidence ref", () => {
  const { transport } = buildCanonicalReviewEvidenceInput([
    source("a", "2026-07-01", [message("m-1", 0, "user", sameText)]),
  ]);
  assert.equal(
    exactEvidenceRefForAlias("notAnAlias", transport.evidenceByAlias),
    INVALID_REVIEW_EVIDENCE_ALIAS_REF,
  );
});

test("alias resolution does not bypass the exact source substring guard", () => {
  const { input, transport } = buildCanonicalReviewEvidenceInput([
    source("a", "2026-07-01", [message("m-1", 0, "user", sameText)]),
  ]);
  const alias = [...transport.evidenceByAlias.keys()][0]!;
  const exactRef = exactEvidenceRefForAlias(alias, transport.evidenceByAlias);
  const unit = input.unitsByRef.get(exactRef)!;

  input.contentByMessageId.set(unit.messageId, "一致しないsource snapshot");
  const resolved = resolveEvidenceRef(
    exactRef,
    input.unitsByRef,
    input.contentByMessageId,
  );
  assert.equal(resolved.validated, false);
  assert.equal(resolved.reason, "quote_not_found");
});

test("alias shape diagnostics are aggregate-only and never normalize lookup", () => {
  const messages = Array.from({ length: 11 }, (_, index) =>
    message(`m-${index}`, index, "user", `Evidence ${index} の本文です。`),
  );
  const { transport } = buildCanonicalReviewEvidenceInput([
    source("a", "2026-07-01", messages),
  ]);
  const letterAlias = [...transport.evidenceByAlias.keys()].find(
    (alias) => alias === "A",
  );
  assert.ok(letterAlias);

  const rawAliases = [
    letterAlias,
    letterAlias.toLowerCase(),
    `${letterAlias} `,
    `[${letterAlias}]`,
    "S01:M001:E01",
    "!",
    "AA",
  ];
  const diagnostic = diagnoseReviewEvidenceAliases(rawAliases, transport);

  assert.deepEqual(diagnostic, {
    totalAliasReferences: 7,
    uniqueReturnedAliasCount: 7,
    expectedAliasWidth: 1,
    base62OnlyCount: 3,
    expectedWidthCount: 3,
    exactMemberCount: 1,
    nonBase62Count: 4,
    unexpectedLengthCount: 4,
    leadingOrTrailingWhitespaceCount: 1,
    legacyEvidenceRefShapeCount: 1,
    wrapperShapeCount: 1,
    trimmedExactMemberCount: 1,
    caseInsensitiveMemberCount: 1,
    unwrappedExactMemberCount: 1,
  });
  assert.equal(
    exactEvidenceRefForAlias(`${letterAlias} `, transport.evidenceByAlias),
    INVALID_REVIEW_EVIDENCE_ALIAS_REF,
  );
  assert.equal(
    exactEvidenceRefForAlias(`[${letterAlias}]`, transport.evidenceByAlias),
    INVALID_REVIEW_EVIDENCE_ALIAS_REF,
  );
  assert.doesNotMatch(JSON.stringify(diagnostic), /S01|M001|E01/);
});
