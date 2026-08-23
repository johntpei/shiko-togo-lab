import { calendarDateFromOccurredAt } from "@/lib/concepts/topic-signal/calendar";
import type {
  TopicSignalOccurrenceInput,
  TopicSignalSnapshot,
} from "@/lib/concepts/topic-signal/snapshot";
import { observationKindLabel } from "@/lib/observations/display";
import { formatThoughtDate } from "@/lib/observations/thought-date";
import type { ReviewObservationKind } from "@/lib/observations/types";
import type { ThoughtTimeline } from "./types";

export const THOUGHT_TIMELINE_PRESENTATION_VERSION =
  "thought-timeline-presentation-v0";

export const THOUGHT_TIMELINE_PRESENTATION_COPY = {
  eyebrow: "観測",
  title: "思考のタイムライン",
  subtitle:
    "観測された変化・接続・緊張と、その日に見えていたテーマを時間の流れでたどります。",
  themeHeading: "この日に見えていたテーマ",
  emptyTitle: "タイムラインに表示できる観測結果はまだありません。",
  emptyBody:
    "対話やレビューが蓄積されると、ここに思考の流れが現れます。",
} as const;

export type ThoughtTimelinePresentationObservation = {
  observationId: string;
  observationType: ReviewObservationKind;
  typeLabel: string;
  title: string;
  summary: string;
  sessionCount: number;
};

export type ThoughtTimelinePresentationTheme = {
  canonicalLabel: string;
  occurrenceCount: number;
};

export type ThoughtTimelinePresentationGroup = {
  date: string;
  dateLabel: string;
  observations: ThoughtTimelinePresentationObservation[];
  themes: ThoughtTimelinePresentationTheme[];
};

export type ThoughtTimelinePresentation = {
  version: typeof THOUGHT_TIMELINE_PRESENTATION_VERSION;
  range: {
    firstDate: string | null;
    lastDate: string | null;
  };
  rangeLabel: string | null;
  groups: ThoughtTimelinePresentationGroup[];
};

type ThemeAccumulator = {
  conceptId: string;
  canonicalLabel: string;
  occurrenceCount: number;
};

function compareThemes(left: ThemeAccumulator, right: ThemeAccumulator) {
  const byCount = right.occurrenceCount - left.occurrenceCount;
  if (byCount !== 0) {
    return byCount;
  }
  const byLabel = left.canonicalLabel.localeCompare(right.canonicalLabel);
  if (byLabel !== 0) {
    return byLabel;
  }
  return left.conceptId.localeCompare(right.conceptId);
}

function rangeLabel(firstDate: string | null, lastDate: string | null) {
  const first = formatThoughtDate(firstDate);
  const last = formatThoughtDate(lastDate);
  if (!first || !last) {
    return null;
  }
  if (first === last) {
    return first;
  }
  return `${first} — ${last}`;
}

/**
 * UI read model. Does not mutate thought-timeline-v0.
 * Themes are same-day supporting context, not Observation relations.
 */
export function buildThoughtTimelinePresentation(input: {
  timeline: ThoughtTimeline;
  snapshot: TopicSignalSnapshot;
  occurrences: readonly TopicSignalOccurrenceInput[];
}): ThoughtTimelinePresentation {
  const labelByConceptId = new Map(
    input.snapshot.concepts.map((concept) => [
      concept.conceptId,
      concept.canonicalLabel,
    ]),
  );

  const observationsByDate = new Map<
    string,
    ThoughtTimelinePresentationObservation[]
  >();
  for (const group of input.timeline.groups) {
    observationsByDate.set(
      group.date,
      group.items.map((item) => ({
        observationId: item.observationId,
        observationType: item.observationType,
        typeLabel: observationKindLabel(item.observationType),
        title: item.title,
        summary: item.summary,
        sessionCount: item.sessionIds.length,
      })),
    );
  }

  const themesByDate = new Map<string, Map<string, ThemeAccumulator>>();
  for (const occurrence of input.occurrences) {
    const date = calendarDateFromOccurredAt(occurrence.occurredAt);
    const canonicalLabel = labelByConceptId.get(occurrence.conceptId);
    if (!date || !canonicalLabel) {
      continue;
    }
    const onDate = themesByDate.get(date) ?? new Map();
    const current = onDate.get(occurrence.conceptId) ?? {
      conceptId: occurrence.conceptId,
      canonicalLabel,
      occurrenceCount: 0,
    };
    current.occurrenceCount += 1;
    onDate.set(occurrence.conceptId, current);
    themesByDate.set(date, onDate);
  }

  const unionDates = [
    ...new Set([...observationsByDate.keys(), ...themesByDate.keys()]),
  ].sort((left, right) => right.localeCompare(left));

  const groups: ThoughtTimelinePresentationGroup[] = unionDates.map((date) => ({
    date,
    dateLabel: formatThoughtDate(date) ?? date,
    observations: observationsByDate.get(date) ?? [],
    themes: [...(themesByDate.get(date)?.values() ?? [])]
      .sort(compareThemes)
      .map((theme) => ({
        canonicalLabel: theme.canonicalLabel,
        occurrenceCount: theme.occurrenceCount,
      })),
  }));

  const chronological = [...unionDates].sort((left, right) =>
    left.localeCompare(right),
  );

  return {
    version: THOUGHT_TIMELINE_PRESENTATION_VERSION,
    range: {
      firstDate: chronological[0] ?? null,
      lastDate: chronological[chronological.length - 1] ?? null,
    },
    rangeLabel: rangeLabel(
      chronological[0] ?? null,
      chronological[chronological.length - 1] ?? null,
    ),
    groups,
  };
}
