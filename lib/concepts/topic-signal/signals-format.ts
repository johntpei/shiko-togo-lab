import type { TopicSignalSet } from "./signals";

export function formatTopicSignalSet(signals: TopicSignalSet) {
  const lines = [
    "TOPIC_SIGNAL_V0",
    `asOf: ${signals.asOf ?? "null"}`,
    "",
    `recentlyObserved (${signals.recentlyObserved.length}):`,
  ];
  if (signals.recentlyObserved.length === 0) {
    lines.push("  (none)");
  }
  for (const item of signals.recentlyObserved) {
    lines.push(
      [
        `  ${item.canonicalLabel}`,
        item.conceptId,
        `last=${item.lastSeenAt}`,
        `recent7d=${item.recent7d.occurrenceCount}/${item.recent7d.distinctSessionCount}/${item.recent7d.activeDayCount}`,
        `reasonCode=${item.reasonCode}`,
        `reason.recent7dOccurrenceCount=${item.reason.recent7dOccurrenceCount}`,
      ].join(" | "),
    );
  }

  lines.push(
    "",
    `crossSessionRecurrence (${signals.crossSessionRecurrence.length}):`,
  );
  if (signals.crossSessionRecurrence.length === 0) {
    lines.push("  (none)");
  }
  for (const item of signals.crossSessionRecurrence) {
    lines.push(
      [
        `  ${item.canonicalLabel}`,
        item.conceptId,
        `total=${item.totalOccurrenceCount}`,
        `sessions=${item.distinctSessionCount}`,
        `days=${item.activeDayCount}`,
        `first=${item.firstSeenAt}`,
        `last=${item.lastSeenAt}`,
        `reasonCode=${item.reasonCode}`,
      ].join(" | "),
    );
  }
  return lines.join("\n");
}
