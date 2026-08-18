import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./client";
import {
  observationSessions,
  observations,
  sessions,
  type ObservationRecord,
} from "./schema";

type AppDb = ReturnType<typeof getDb>;

export type ObservationIdentity = {
  sourceReviewId: string;
  sourceRef: string;
  projectionVersion: string;
};

export type NewObservationInsert = {
  id: string;
  kind: string;
  projectionVersion: string;
  sourceReviewId: string;
  sourceRef: string;
  title: string;
  body: string;
  supportType: string | null;
  payload: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  detectedAt: string;
  distinctSessionCount: number;
  createdAt: string;
  sessionIds: string[];
};

export type ProjectReviewStore = {
  listSessionsByIds(
    ids: string[],
  ): Array<{ id: string; occurredAt: string }>;
  findObservationByIdentity(
    identity: ObservationIdentity,
  ): { id: string } | null;
  insertObservation(row: NewObservationInsert): void;
};

export function createDbProjectStore(db: AppDb = getDb()): ProjectReviewStore {
  return {
    listSessionsByIds(ids) {
      if (ids.length === 0) {
        return [];
      }
      const unique = [...new Set(ids)];
      const rows = db
        .select({
          id: sessions.id,
          occurredAt: sessions.occurredAt,
        })
        .from(sessions)
        .where(inArray(sessions.id, unique))
        .all();
      const byId = new Map(rows.map((row) => [row.id, row]));
      return unique.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      });
    },
    findObservationByIdentity(identity) {
      return (
        db
          .select({ id: observations.id })
          .from(observations)
          .where(
            and(
              eq(observations.sourceReviewId, identity.sourceReviewId),
              eq(observations.sourceRef, identity.sourceRef),
              eq(observations.projectionVersion, identity.projectionVersion),
            ),
          )
          .get() ?? null
      );
    },
    insertObservation(row) {
      const { sessionIds, ...record } = row;
      db.transaction((tx) => {
        tx.insert(observations).values(record).run();
        if (sessionIds.length > 0) {
          tx.insert(observationSessions)
            .values(
              sessionIds.map((sessionId) => ({
                observationId: record.id,
                sessionId,
              })),
            )
            .run();
        }
      });
    },
  };
}

export function listObservations(
  options?: {
    kind?: string;
    sourceReviewId?: string;
  },
  db: AppDb = getDb(),
): ObservationRecord[] {
  const filters = [
    options?.kind ? eq(observations.kind, options.kind) : undefined,
    options?.sourceReviewId
      ? eq(observations.sourceReviewId, options.sourceReviewId)
      : undefined,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));

  const query = db.select().from(observations);
  const filtered = filters.length > 0 ? query.where(and(...filters)) : query;
  return filtered
    .orderBy(desc(observations.lastSeenAt), desc(observations.detectedAt))
    .all();
}

export function listObservationSessionIds(
  observationId: string,
  db: AppDb = getDb(),
) {
  return db
    .select({ sessionId: observationSessions.sessionId })
    .from(observationSessions)
    .where(eq(observationSessions.observationId, observationId))
    .all()
    .map((row) => row.sessionId);
}

export function countObservations(db: AppDb = getDb()) {
  return db.select().from(observations).all().length;
}

export function listObservationSessionIdsByObservationIds(
  observationIds: string[],
  db: AppDb = getDb(),
) {
  const map = new Map<string, string[]>();
  if (observationIds.length === 0) {
    return map;
  }
  const rows = db
    .select({
      observationId: observationSessions.observationId,
      sessionId: observationSessions.sessionId,
    })
    .from(observationSessions)
    .where(inArray(observationSessions.observationId, observationIds))
    .all();
  for (const row of rows) {
    const current = map.get(row.observationId) ?? [];
    current.push(row.sessionId);
    map.set(row.observationId, current);
  }
  return map;
}
