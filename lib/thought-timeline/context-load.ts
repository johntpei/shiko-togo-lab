import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import {
  loadTopicSignalSource,
} from "@/lib/concepts/topic-signal/load";
import { buildTopicSignalSnapshot } from "@/lib/concepts/topic-signal/snapshot";
import {
  buildThoughtTimelineContextDiagnostic,
  type ThoughtTimelineContextDiagnostic,
} from "./context-diagnostic";
import { loadThoughtTimeline } from "./load";
import type { ThoughtTimeline } from "./types";

export type ThoughtTimelineContextAudit = {
  timeline: ThoughtTimeline;
  diagnostic: ThoughtTimelineContextDiagnostic;
};

/**
 * SELECT via existing Timeline + Topic Signal snapshot sources,
 * then pure context diagnostic. Caller injects db. No writes.
 */
export function loadThoughtTimelineContextAudit(input: {
  db: ConceptQueryDb;
}): ThoughtTimelineContextAudit {
  const timeline = loadThoughtTimeline({ db: input.db });
  const source = loadTopicSignalSource({ db: input.db });
  const snapshot = buildTopicSignalSnapshot(source);
  return {
    timeline,
    diagnostic: buildThoughtTimelineContextDiagnostic({
      timeline,
      snapshot,
      occurrences: source.occurrences,
    }),
  };
}
