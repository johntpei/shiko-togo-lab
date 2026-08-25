import { asc, eq, inArray } from "drizzle-orm";
import type { ReviewSessionSource } from "@/lib/ai/review-input";
import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import { messages, sessions } from "@/lib/db/schema";

function canonicalSessionIds(sessionIds: readonly string[]) {
  return [...new Set(sessionIds.map((id) => id.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

/** Unified Processing Review sources. Manual Review may additionally supply analysis. */
export function loadCanonicalReviewSessionSources(
  sessionIds: readonly string[],
  db: ConceptQueryDb,
): ReviewSessionSource[] {
  const normalized = canonicalSessionIds(sessionIds);
  const records = db
    .select()
    .from(sessions)
    .where(inArray(sessions.id, normalized))
    .all();
  const byId = new Map(records.map((session) => [session.id, session]));

  return normalized.flatMap((sessionId) => {
    const session = byId.get(sessionId);
    if (!session) {
      return [];
    }
    const sessionMessages = db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.index), asc(messages.id))
      .all()
      .map((message) => ({
        id: message.id,
        index: message.index,
        role: message.role,
        content: message.content,
        attachmentsJson: message.attachmentsJson,
      }));
    return [
      {
        session: {
          id: session.id,
          title: session.title,
          occurredAt: session.occurredAt,
          source: session.source,
          category: session.category,
          createdAt: session.createdAt,
        },
        messages: sessionMessages,
        analysis: null,
      },
    ];
  });
}
