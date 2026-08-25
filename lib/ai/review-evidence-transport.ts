import type { EvidenceUnit } from "./evidence-units";
import {
  buildIntegratedReviewInput,
  type IntegratedReviewInput,
  type ReviewSessionSource,
} from "./review-input";
import { INTEGRATED_REVIEW_MAX_INPUT_CHARS } from "./limits";
import { formatOccurredAt } from "@/lib/sessions/labels";

export const REVIEW_EVIDENCE_TRANSPORT_VERSION =
  "review-evidence-compact-v1" as const;

export const REVIEW_EVIDENCE_ALIAS_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const INVALID_REVIEW_EVIDENCE_ALIAS_REF =
  "invalid_evidence_alias" as const;

export type CompactReviewEvidenceTransport = {
  serializationVersion: typeof REVIEW_EVIDENCE_TRANSPORT_VERSION;
  serializedEvidence: string;
  serializedChars: number;
  evidenceCount: number;
  sessionCount: number;
  aliasWidth: number;
  evidenceByAlias: Map<string, EvidenceUnit>;
  aliasByEvidenceRef: Map<string, string>;
};

export type CompactReviewEvidencePreflight = Pick<
  CompactReviewEvidenceTransport,
  | "serializationVersion"
  | "serializedChars"
  | "evidenceCount"
  | "sessionCount"
> & {
  withinLimit: boolean;
};

export type ReviewEvidenceAliasDiagnostics = {
  totalAliasReferences: number;
  uniqueReturnedAliasCount: number;
  expectedAliasWidth: number;
  base62OnlyCount: number;
  expectedWidthCount: number;
  exactMemberCount: number;
  nonBase62Count: number;
  unexpectedLengthCount: number;
  leadingOrTrailingWhitespaceCount: number;
  legacyEvidenceRefShapeCount: number;
  wrapperShapeCount: number;
  trimmedExactMemberCount: number;
  caseInsensitiveMemberCount: number;
  unwrappedExactMemberCount: number;
};

function aliasWidthForCount(count: number) {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Review Evidence count must be a non-negative safe integer");
  }
  let width = 1;
  let capacity = REVIEW_EVIDENCE_ALIAS_ALPHABET.length;
  while (capacity < count) {
    width += 1;
    capacity *= REVIEW_EVIDENCE_ALIAS_ALPHABET.length;
    if (!Number.isSafeInteger(capacity)) {
      throw new Error("Review Evidence alias namespace exceeds safe integer range");
    }
  }
  return width;
}

function encodeAlias(index: number, width: number) {
  const base = REVIEW_EVIDENCE_ALIAS_ALPHABET.length;
  let value = index;
  let encoded = "";
  do {
    encoded = REVIEW_EVIDENCE_ALIAS_ALPHABET[value % base]! + encoded;
    value = Math.floor(value / base);
  } while (value > 0);
  if (encoded.length > width) {
    throw new Error("Review Evidence alias width is too small");
  }
  return encoded.padStart(width, REVIEW_EVIDENCE_ALIAS_ALPHABET[0]);
}

export function isReviewEvidenceAliasLexicallySafe(alias: string) {
  if (alias.length === 0) {
    return false;
  }
  return [...alias].every((char) =>
    REVIEW_EVIDENCE_ALIAS_ALPHABET.includes(char),
  );
}

const LEGACY_REVIEW_EVIDENCE_REF_PATTERN = /^S\d+:M\d+:E\d+$/;
const ALIAS_WRAPPERS = new Map([
  ["[", "]"],
  ["(", ")"],
  ["{", "}"],
  ["<", ">"],
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
]);

function unwrappedAlias(alias: string): string | null {
  if (alias.length < 2) {
    return null;
  }
  const expectedClose = ALIAS_WRAPPERS.get(alias[0]!);
  if (!expectedClose || alias.at(-1) !== expectedClose) {
    return null;
  }
  return alias.slice(1, -1);
}

/**
 * Safe diagnostics for model-returned aliases. Raw values are used only for
 * in-memory counts and are never included in the returned structure.
 */
export function diagnoseReviewEvidenceAliases(
  aliases: readonly string[],
  transport: Pick<
    CompactReviewEvidenceTransport,
    "aliasWidth" | "evidenceByAlias"
  >,
): ReviewEvidenceAliasDiagnostics {
  const canonicalLowercase = new Set(
    [...transport.evidenceByAlias.keys()].map((alias) => alias.toLowerCase()),
  );
  let base62OnlyCount = 0;
  let expectedWidthCount = 0;
  let exactMemberCount = 0;
  let leadingOrTrailingWhitespaceCount = 0;
  let legacyEvidenceRefShapeCount = 0;
  let wrapperShapeCount = 0;
  let trimmedExactMemberCount = 0;
  let caseInsensitiveMemberCount = 0;
  let unwrappedExactMemberCount = 0;

  for (const alias of aliases) {
    const exact = transport.evidenceByAlias.has(alias);
    if (isReviewEvidenceAliasLexicallySafe(alias)) {
      base62OnlyCount += 1;
    }
    if (alias.length === transport.aliasWidth) {
      expectedWidthCount += 1;
    }
    if (exact) {
      exactMemberCount += 1;
    }

    const trimmed = alias.trim();
    if (trimmed !== alias) {
      leadingOrTrailingWhitespaceCount += 1;
      if (!exact && transport.evidenceByAlias.has(trimmed)) {
        trimmedExactMemberCount += 1;
      }
    }
    if (LEGACY_REVIEW_EVIDENCE_REF_PATTERN.test(alias)) {
      legacyEvidenceRefShapeCount += 1;
    }

    const unwrapped = unwrappedAlias(alias);
    if (unwrapped !== null) {
      wrapperShapeCount += 1;
      if (!exact && transport.evidenceByAlias.has(unwrapped)) {
        unwrappedExactMemberCount += 1;
      }
    }
    if (!exact && canonicalLowercase.has(alias.toLowerCase())) {
      caseInsensitiveMemberCount += 1;
    }
  }

  return {
    totalAliasReferences: aliases.length,
    uniqueReturnedAliasCount: new Set(aliases).size,
    expectedAliasWidth: transport.aliasWidth,
    base62OnlyCount,
    expectedWidthCount,
    exactMemberCount,
    nonBase62Count: aliases.length - base62OnlyCount,
    unexpectedLengthCount: aliases.length - expectedWidthCount,
    leadingOrTrailingWhitespaceCount,
    legacyEvidenceRefShapeCount,
    wrapperShapeCount,
    trimmedExactMemberCount,
    caseInsensitiveMemberCount,
    unwrappedExactMemberCount,
  };
}

const COMPACT_TEXT_ESCAPE = "␛";
const COMPACT_TEXT_NEWLINE = "↵";
const COMPACT_TEXT_RETURN = "␍";
const COMPACT_TEXT_TAB = "↹";

/** Keep each transport record on one line with a reversible, length-neutral whitespace encoding. */
export function encodeCompactReviewEvidenceText(text: string) {
  return text
    .replaceAll(COMPACT_TEXT_ESCAPE, `${COMPACT_TEXT_ESCAPE}e`)
    .replaceAll(COMPACT_TEXT_NEWLINE, `${COMPACT_TEXT_ESCAPE}n`)
    .replaceAll(COMPACT_TEXT_RETURN, `${COMPACT_TEXT_ESCAPE}r`)
    .replaceAll(COMPACT_TEXT_TAB, `${COMPACT_TEXT_ESCAPE}t`)
    .replaceAll("\r", COMPACT_TEXT_RETURN)
    .replaceAll("\n", COMPACT_TEXT_NEWLINE)
    .replaceAll("\t", COMPACT_TEXT_TAB);
}

export function decodeCompactReviewEvidenceText(encoded: string) {
  let decoded = "";
  for (let index = 0; index < encoded.length; index += 1) {
    const char = encoded[index]!;
    if (char === COMPACT_TEXT_NEWLINE) {
      decoded += "\n";
      continue;
    }
    if (char === COMPACT_TEXT_RETURN) {
      decoded += "\r";
      continue;
    }
    if (char === COMPACT_TEXT_TAB) {
      decoded += "\t";
      continue;
    }
    if (char !== COMPACT_TEXT_ESCAPE) {
      decoded += char;
      continue;
    }
    const escaped = encoded[index + 1];
    if (escaped === undefined) {
      throw new Error("Invalid compact Review Evidence escape");
    }
    if (escaped === "e") {
      decoded += COMPACT_TEXT_ESCAPE;
    } else if (escaped === "r") {
      decoded += COMPACT_TEXT_RETURN;
    } else if (escaped === "n") {
      decoded += COMPACT_TEXT_NEWLINE;
    } else if (escaped === "t") {
      decoded += COMPACT_TEXT_TAB;
    } else {
      throw new Error("Unknown compact Review Evidence escape");
    }
    index += 1;
  }
  return decoded;
}

export function buildCompactReviewEvidenceTransport(
  input: IntegratedReviewInput,
): CompactReviewEvidenceTransport {
  const evidenceCount = input.units.length;
  const aliasWidth = aliasWidthForCount(evidenceCount);
  const evidenceByAlias = new Map<string, EvidenceUnit>();
  const aliasByEvidenceRef = new Map<string, string>();

  input.units.forEach((unit, index) => {
    const alias = encodeAlias(index, aliasWidth);
    if (evidenceByAlias.has(alias)) {
      throw new Error("Review Evidence alias collision");
    }
    if (aliasByEvidenceRef.has(unit.ref)) {
      throw new Error("Duplicate exact Review Evidence ref");
    }
    evidenceByAlias.set(alias, unit);
    aliasByEvidenceRef.set(unit.ref, alias);
  });

  if (
    evidenceByAlias.size !== evidenceCount ||
    aliasByEvidenceRef.size !== evidenceCount
  ) {
    throw new Error("Review Evidence alias map is not bijective");
  }

  const lines: string[] = [];
  for (const session of input.transportSessions) {
    lines.push(`#S\t${session.sessionRef}`);
    lines.push(`#T\t${encodeCompactReviewEvidenceText(session.title)}`);
    lines.push(`#D\t${formatOccurredAt(session.occurredAt)}`);
    for (const message of session.messages) {
      const role = message.role === "user" ? "U" : "A";
      lines.push(`#M\t${message.messageRef}\t${role}`);
      for (const unit of message.units) {
        const alias = aliasByEvidenceRef.get(unit.ref);
        if (!alias) {
          throw new Error("Review Evidence alias is missing");
        }
        lines.push(`${alias}\t${encodeCompactReviewEvidenceText(unit.text)}`);
      }
      if (message.hasAttachments) {
        lines.push("#F\tattachment-present");
      }
    }
    if (session.auxiliaryAnalysis) {
      lines.push(
        `#X\t${session.auxiliaryAnalysis.promptVersion}\t${encodeCompactReviewEvidenceText(session.auxiliaryAnalysis.text)}`,
      );
    }
  }

  const serializedEvidence = lines.join("\n").trim();
  return {
    serializationVersion: REVIEW_EVIDENCE_TRANSPORT_VERSION,
    serializedEvidence,
    serializedChars: serializedEvidence.length,
    evidenceCount,
    sessionCount: input.analyzableSessionCount,
    aliasWidth,
    evidenceByAlias,
    aliasByEvidenceRef,
  };
}

export function exactEvidenceRefForAlias(
  alias: string,
  evidenceByAlias: ReadonlyMap<string, EvidenceUnit>,
) {
  return evidenceByAlias.get(alias)?.ref ?? INVALID_REVIEW_EVIDENCE_ALIAS_REF;
}

/** Canonical v6 input and size semantics shared by Plan, Executor, and task. */
export function buildCanonicalReviewEvidenceInput(
  sources: ReviewSessionSource[],
) {
  const input = buildIntegratedReviewInput(sources);
  const transport = buildCompactReviewEvidenceTransport(input);
  const preflight: CompactReviewEvidencePreflight = {
    serializationVersion: transport.serializationVersion,
    serializedChars: transport.serializedChars,
    evidenceCount: transport.evidenceCount,
    sessionCount: transport.sessionCount,
    withinLimit:
      transport.serializedChars <= INTEGRATED_REVIEW_MAX_INPUT_CHARS,
  };
  return { input, transport, preflight };
}
