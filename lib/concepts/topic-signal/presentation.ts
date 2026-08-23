import { formatThoughtDate } from "@/lib/observations/thought-date";
import type { TopicSignalSet } from "./signals";

export const TOPIC_SIGNAL_UI_COPY = {
  sectionTitle: "テーマの観測",
  overallEmpty:
    "テーマの観測結果は、会話が蓄積されるとここに表示されます。",
  asOfPrefix: "観測データ:",
  asOfSuffix: "まで",
  recentlyObservedTitle: "最近見えているテーマ",
  recentlyObservedDescription:
    "直近7日間の会話で観測されたテーマです。増えていることを意味するものではありません。",
  recentlyObservedEmpty: "最近観測されたテーマはまだありません。",
  recentlyObservedDetailSuffix: "に観測",
  recurrenceTitle: "会話をまたいで現れたテーマ",
  recurrenceDescription:
    "別々の会話で複数回観測されたテーマです。",
  recurrenceEmpty: "複数の会話で再び現れたテーマはまだありません。",
} as const;

export type TopicSignalPresentationItem = {
  canonicalLabel: string;
  detail: string;
};

export type TopicSignalPresentationModel = {
  asOfLabel: string | null;
  overallEmpty: boolean;
  recentlyObserved: TopicSignalPresentationItem[];
  recurrence: TopicSignalPresentationItem[];
};

function recentlyObservedDetail(lastSeenAt: string, occurrenceCount: number) {
  const date = formatThoughtDate(lastSeenAt);
  if (date) {
    return `${date} ${TOPIC_SIGNAL_UI_COPY.recentlyObservedDetailSuffix}`;
  }
  return `直近7日: ${occurrenceCount}回`;
}

function recurrenceDetail(input: {
  totalOccurrenceCount: number;
  distinctSessionCount: number;
}) {
  return `${input.totalOccurrenceCount}回・${input.distinctSessionCount}つの会話`;
}

export function buildTopicSignalPresentation(
  signals: TopicSignalSet,
): TopicSignalPresentationModel {
  const asOfDate = formatThoughtDate(signals.asOf);
  const recentlyObserved = signals.recentlyObserved.map((item) => ({
    canonicalLabel: item.canonicalLabel,
    detail: recentlyObservedDetail(
      item.lastSeenAt,
      item.recent7d.occurrenceCount,
    ),
  }));
  const recurrence = signals.crossSessionRecurrence.map((item) => ({
    canonicalLabel: item.canonicalLabel,
    detail: recurrenceDetail({
      totalOccurrenceCount: item.totalOccurrenceCount,
      distinctSessionCount: item.distinctSessionCount,
    }),
  }));
  return {
    asOfLabel: asOfDate
      ? `${TOPIC_SIGNAL_UI_COPY.asOfPrefix} ${asOfDate} ${TOPIC_SIGNAL_UI_COPY.asOfSuffix}`
      : null,
    overallEmpty: recentlyObserved.length === 0 && recurrence.length === 0,
    recentlyObserved,
    recurrence,
  };
}
