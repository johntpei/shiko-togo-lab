import type { TopicSignalSnapshot } from "./snapshot";

export type TopicSignalPreviewReport = {
  asOf: string | null;
  conceptCountWithOccurrences: number;
  conceptsWithoutOccurrences: number;
  totalOccurrenceCount: number;
  totalDistinctSessionCount: number;
  activeDateRange: {
    start: string | null;
    end: string | null;
  };
  concepts: Array<{
    conceptId: string;
    canonicalLabel: string;
    totalOccurrenceCount: number;
    distinctSessionCount: number;
    activeDayCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    recent7d: TopicSignalSnapshot["concepts"][number]["recent7d"];
    previous7d: TopicSignalSnapshot["concepts"][number]["previous7d"];
  }>;
};

export function buildTopicSignalPreviewReport(
  snapshot: TopicSignalSnapshot,
): TopicSignalPreviewReport {
  return {
    asOf: snapshot.asOf,
    conceptCountWithOccurrences: snapshot.concepts.length,
    conceptsWithoutOccurrences: snapshot.diagnostics.conceptsWithoutOccurrences,
    totalOccurrenceCount: snapshot.diagnostics.totalOccurrenceCount,
    totalDistinctSessionCount: snapshot.diagnostics.totalDistinctSessionCount,
    activeDateRange: snapshot.diagnostics.activeDateRange,
    concepts: snapshot.concepts.map((concept) => ({
      conceptId: concept.conceptId,
      canonicalLabel: concept.canonicalLabel,
      totalOccurrenceCount: concept.totalOccurrenceCount,
      distinctSessionCount: concept.distinctSessionCount,
      activeDayCount: concept.activeDayCount,
      firstSeenAt: concept.firstSeenAt,
      lastSeenAt: concept.lastSeenAt,
      recent7d: concept.recent7d,
      previous7d: concept.previous7d,
    })),
  };
}

export function formatTopicSignalPreviewReport(
  report: TopicSignalPreviewReport,
) {
  const range =
    report.activeDateRange.start && report.activeDateRange.end
      ? `${report.activeDateRange.start} .. ${report.activeDateRange.end}`
      : "(none)";
  const lines = [
    "TOPIC_SIGNAL_SNAPSHOT_V0",
    `asOf: ${report.asOf ?? "null"}`,
    `conceptCountWithOccurrences: ${report.conceptCountWithOccurrences}`,
    `conceptsWithoutOccurrences: ${report.conceptsWithoutOccurrences}`,
    `totalOccurrenceCount: ${report.totalOccurrenceCount}`,
    `totalDistinctSessionCount: ${report.totalDistinctSessionCount}`,
    `activeDateRange: ${range}`,
    "",
    "concepts (snapshot order: lastSeenAt DESC, conceptId ASC):",
  ];
  for (const concept of report.concepts) {
    lines.push(
      [
        `  ${concept.conceptId}`,
        concept.canonicalLabel,
        `total=${concept.totalOccurrenceCount}`,
        `sessions=${concept.distinctSessionCount}`,
        `days=${concept.activeDayCount}`,
        `first=${concept.firstSeenAt}`,
        `last=${concept.lastSeenAt}`,
        `recent7d=${concept.recent7d.occurrenceCount}/${concept.recent7d.distinctSessionCount}/${concept.recent7d.activeDayCount}`,
        `previous7d=${concept.previous7d.occurrenceCount}/${concept.previous7d.distinctSessionCount}/${concept.previous7d.activeDayCount}`,
      ].join(" | "),
    );
  }
  return lines.join("\n");
}
