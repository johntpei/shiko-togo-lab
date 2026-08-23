import { listConcepts } from "@/lib/db/concept-queries";
import type { ObservationConceptSupportDb } from "@/lib/db/observation-concept-support-queries";
import { listObservationConceptRelations } from "@/lib/db/observation-concept-support-queries";
import {
  listObservationSessionIdsByObservationIds,
  listObservations,
} from "@/lib/db/observation-queries";
import { observationFromRecord } from "@/lib/observations/from-record";
import { buildThoughtMap } from "./map";
import type { ThoughtMap } from "./types";

/**
 * Load Thought Map v0 from stable domain tables.
 * Caller must inject db. There is no getDb fallback.
 * Read-only: no inserts, updates, or reconciliation.
 */
export function loadThoughtMap(deps: { db: ObservationConceptSupportDb }): ThoughtMap {
  const conceptRows = listConcepts(deps.db);
  const observationRows = listObservations({}, deps.db);
  const sessionIdsByObservation = listObservationSessionIdsByObservationIds(
    observationRows.map((row) => row.id),
    deps.db,
  );
  const observations = observationRows.flatMap((row) => {
    const parsed = observationFromRecord(
      row,
      sessionIdsByObservation.get(row.id) ?? [],
    );
    if (!parsed) {
      return [];
    }
    return [
      {
        observationId: row.id,
        observationKind: parsed.kind,
        title: parsed.title,
        summary: parsed.body,
        lastSeenAt: parsed.lastSeenAt,
        firstSeenAt: parsed.firstSeenAt,
        detectedAt: parsed.detectedAt,
      },
    ];
  });
  const relations = listObservationConceptRelations(deps.db);

  return buildThoughtMap({
    concepts: conceptRows.map((row) => ({
      conceptId: row.id,
      canonicalLabel: row.canonicalLabel,
    })),
    observations,
    relations: relations.map((row) => ({
      observationId: row.observationId,
      conceptId: row.conceptId,
      relationVersion: row.relationVersion,
      supportCount: row.supportCount,
    })),
  });
}
