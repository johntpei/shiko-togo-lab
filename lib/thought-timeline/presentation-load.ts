import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import { loadTopicSignalSource } from "@/lib/concepts/topic-signal/load";
import { buildTopicSignalSnapshot } from "@/lib/concepts/topic-signal/snapshot";
import {
  buildThoughtTimelinePresentation,
  type ThoughtTimelinePresentation,
} from "./presentation";
import { loadThoughtTimeline } from "./load";

/**
 * SELECT via existing Timeline + ConceptOccurrence source, then pure
 * presentation. Caller injects db. No writes.
 */
export function loadThoughtTimelinePresentation(input: {
  db: ConceptQueryDb;
}): ThoughtTimelinePresentation {
  const timeline = loadThoughtTimeline({ db: input.db });
  const source = loadTopicSignalSource({ db: input.db });
  const snapshot = buildTopicSignalSnapshot(source);
  return buildThoughtTimelinePresentation({
    timeline,
    snapshot,
    occurrences: source.occurrences,
  });
}
