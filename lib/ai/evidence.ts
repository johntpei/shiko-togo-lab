import type { EvidenceRole } from "./evidence-units";

export type RawEvidence = {
  messageRef: string;
  quote: string;
};

export const EVIDENCE_FAILURE_REASONS = [
  "invalid_message_ref",
  "quote_not_found",
  "empty_quote",
  "unsupported_claim",
  "invalid_evidence_ref",
] as const;

export type EvidenceFailureReason = (typeof EVIDENCE_FAILURE_REASONS)[number];

export type ValidatedEvidence = RawEvidence & {
  messageId: string | null;
  validated: boolean;
  reason: EvidenceFailureReason | null;
  role?: EvidenceRole | null;
  sessionId?: string | null;
  sessionTitle?: string | null;
  occurredAt?: string | null;
};

const KINDS_REQUIRING_EVIDENCE = new Set(["fact", "decision", "action"]);

/**
 * 意味を変えない技術的正規化だけ行う。
 * - CRLF / CR → LF
 * - Unicode NFC
 * 空白削除・句読点削除・Markdown削除はしない。
 */
export function normalizeForQuoteMatch(text: string) {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").normalize("NFC");
}

export function quoteExistsInContent(content: string, quote: string) {
  if (!quote) {
    return false;
  }
  const normalizedContent = normalizeForQuoteMatch(content);
  const normalizedQuote = normalizeForQuoteMatch(quote);
  if (normalizedContent.includes(normalizedQuote)) {
    return true;
  }
  const trimmed = normalizedQuote.trim();
  return trimmed.length > 0 && normalizedContent.includes(trimmed);
}

export function classifyEvidenceFailure(
  evidence: RawEvidence,
  refToMessageId: Map<string, string>,
  contentByMessageId: Map<string, string>,
): EvidenceFailureReason | null {
  if (!evidence.quote || evidence.quote.trim().length === 0) {
    return "empty_quote";
  }
  const messageId = refToMessageId.get(evidence.messageRef) ?? null;
  if (!messageId) {
    return "invalid_message_ref";
  }
  const content = contentByMessageId.get(messageId) ?? "";
  if (!quoteExistsInContent(content, evidence.quote)) {
    return "quote_not_found";
  }
  return null;
}

export function validateEvidence(
  evidence: RawEvidence,
  refToMessageId: Map<string, string>,
  contentByMessageId: Map<string, string>,
): ValidatedEvidence {
  const reason = classifyEvidenceFailure(
    evidence,
    refToMessageId,
    contentByMessageId,
  );
  const messageId = refToMessageId.get(evidence.messageRef) ?? null;
  return {
    messageRef: evidence.messageRef,
    quote: evidence.quote,
    messageId,
    validated: reason == null,
    reason,
  };
}

export function validateEvidenceList(
  evidence: RawEvidence[],
  refToMessageId: Map<string, string>,
  contentByMessageId: Map<string, string>,
) {
  return evidence.map((item) =>
    validateEvidence(item, refToMessageId, contentByMessageId),
  );
}

export function itemNeedsEvidence(kind: string) {
  return KINDS_REQUIRING_EVIDENCE.has(kind);
}

export function isUnsupportedClaim(
  kind: string,
  evidence: Array<{ validated: boolean }>,
) {
  if (!itemNeedsEvidence(kind)) {
    return false;
  }
  return !evidence.some((item) => item.validated);
}

export function computeEvidenceStats(
  items: Array<{ evidence: Array<{ validated: boolean }> }>,
) {
  const evidenceCount = items.reduce(
    (sum, item) => sum + item.evidence.length,
    0,
  );
  const validatedCount = items.reduce(
    (sum, item) => sum + item.evidence.filter((ev) => ev.validated).length,
    0,
  );
  const validationRate =
    evidenceCount === 0 ? 0 : validatedCount / evidenceCount;
  return { evidenceCount, validatedCount, validationRate };
}

export const EVIDENCE_FAILURE_LABELS: Record<EvidenceFailureReason, string> = {
  invalid_message_ref: "参照Messageが見つかりません",
  quote_not_found: "引用が原文と一致しません",
  empty_quote: "引用が空です",
  unsupported_claim: "根拠が不足しています",
  invalid_evidence_ref: "参照Messageが見つかりません",
};
