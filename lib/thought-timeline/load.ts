import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import {
  countConceptOccurrences,
} from "@/lib/db/concept-queries";
import { listObservationSessionIdsByObservationIds } from "@/lib/db/observation-queries";
import { observations } from "@/lib/db/schema";
import {
  buildThoughtTimelineDiagnostic,
  thoughtTimelineDateCounts,
  thoughtTimelineSessionCounts,
  type ThoughtTimelineDiagnostic,
} from "./diagnostic";
import { assembleThoughtTimeline, buildThoughtTimeline } from "./timeline";
import type { ThoughtTimeline } from "./types";
import type { ThoughtTimelineSourceObservation } from "./types";

export type ThoughtTimelineSource = {
  observations: ThoughtTimelineSourceObservation[];
  hasObservationConceptsRelation: false;
  conceptOccurrenceCount: number;
};

export type ThoughtTimelineAudit = {
  timeline: ThoughtTimeline;
  diagnostic: ThoughtTimelineDiagnostic;
};

/**
 * SELECT Observation rows + linked Session ids.
 * Does not open a default DB. Does not write.
 * relatedConcepts is always [] — there is no Observation-to-Concept join table.
 */
export function loadThoughtTimelineSource(input: {
  db: ConceptQueryDb;
}): ThoughtTimelineSource {
  const records = input.db.select().from(observations).all();
  const sessionIdsByObservation = listObservationSessionIdsByObservationIds(
    records.map((record) => record.id),
    input.db,
  );

  return {
    observations: records.map((record) => ({
      id: record.id,
      kind: record.kind,
      title: record.title,
      body: record.body,
      payload: record.payload,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      detectedAt: record.detectedAt,
      createdAt: record.createdAt,
      sessionIds: sessionIdsByObservation.get(record.id) ?? [],
      relatedConcepts: [],
    })),
    hasObservationConceptsRelation: false,
    conceptOccurrenceCount: countConceptOccurrences(input.db),
  };
}

export function loadThoughtTimeline(input: { db: ConceptQueryDb }): ThoughtTimeline {
  return buildThoughtTimeline({
    observations: loadThoughtTimelineSource(input).observations,
  });
}

export function loadThoughtTimelineAudit(input: {
  db: ConceptQueryDb;
}): ThoughtTimelineAudit {
  const source = loadThoughtTimelineSource(input);
  const assembled = assembleThoughtTimeline({
    observations: source.observations,
  });
  return {
    timeline: assembled.timeline,
    diagnostic: buildThoughtTimelineDiagnostic({
      sourceObservationCount: source.observations.length,
      timeline: assembled.timeline,
      skipped: assembled.skipped,
      hasObservationConceptsRelation: source.hasObservationConceptsRelation,
      conceptOccurrenceCount: source.conceptOccurrenceCount,
    }),
  };
}

export function thoughtTimelinePreviewExtras(timeline: ThoughtTimeline) {
  return {
    dateCounts: thoughtTimelineDateCounts(timeline),
    sessionCounts: thoughtTimelineSessionCounts(timeline),
  };
}
