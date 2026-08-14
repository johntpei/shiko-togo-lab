import type { PreparedSession, VisibleMessage } from "./types";

function unixToLocalDate(unixSeconds: number | null) {
  const date = unixSeconds != null ? new Date(unixSeconds * 1000) : new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function unixToOccurredAt(unixSeconds: number | null) {
  const date = unixSeconds != null ? new Date(unixSeconds * 1000) : new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function unixToIso(unixSeconds: number | null) {
  if (unixSeconds == null || !Number.isFinite(unixSeconds)) {
    return null;
  }
  return new Date(unixSeconds * 1000).toISOString();
}

export function buildSessionTitles(
  conversationTitle: string,
  chunks: VisibleMessage[][],
) {
  const used = new Map<string, number>();
  return chunks.map((chunk) => {
    const dateLabel = unixToLocalDate(chunk[0]?.sourceCreatedAt ?? null);
    const count = (used.get(dateLabel) ?? 0) + 1;
    used.set(dateLabel, count);
    const suffix = count > 1 ? ` #${count}` : "";
    return `${conversationTitle} — ${dateLabel}${suffix}`;
  });
}

export function buildPreparedSession(
  title: string,
  messages: VisibleMessage[],
): PreparedSession {
  const pieces: string[] = [];
  const positioned: PreparedSession["messages"] = [];

  for (const message of messages) {
    if (pieces.length > 0) {
      pieces.push("\n\n");
    }
    const label = message.role === "user" ? "User:" : "Assistant:";
    pieces.push(`${label}\n`);
    const charStart = pieces.reduce((sum, piece) => sum + piece.length, 0);
    pieces.push(message.content);
    const charEnd = pieces.reduce((sum, piece) => sum + piece.length, 0);
    positioned.push({
      ...message,
      index: positioned.length,
      charStart,
      charEnd,
    });
  }

  const rawContent = pieces.join("");
  const first = messages[0];
  const last = messages[messages.length - 1];

  return {
    title,
    occurredAt: unixToOccurredAt(first?.sourceCreatedAt ?? null),
    sourceStartAt: unixToIso(first?.sourceCreatedAt ?? null),
    sourceEndAt: unixToIso(last?.sourceCreatedAt ?? null),
    rawContent,
    messages: positioned,
  };
}

export function assertTranscriptAnchors(session: PreparedSession) {
  for (const message of session.messages) {
    const slice = session.rawContent.slice(message.charStart, message.charEnd);
    if (slice !== message.content) {
      throw new Error(`rawContent anchor mismatch at index ${message.index}`);
    }
  }
}
