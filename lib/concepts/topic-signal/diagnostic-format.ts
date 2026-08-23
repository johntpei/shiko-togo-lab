import type { TopicSignalDiagnosticReport } from "./diagnostic";

function formatWindow(metrics: {
  occurrenceCount: number;
  distinctSessionCount: number;
  activeDayCount: number;
}) {
  return `${metrics.occurrenceCount}/${metrics.distinctSessionCount}/${metrics.activeDayCount}`;
}

function formatSparsity(
  label: string,
  sparsity: TopicSignalDiagnosticReport["summary"]["windowSparsity7d"],
) {
  return `${label}: withOccurrence=${sparsity.withOccurrence} withoutOccurrence=${sparsity.withoutOccurrence} conceptTotal=${sparsity.conceptTotal}`;
}

export function formatTopicSignalDiagnosticReport(
  report: TopicSignalDiagnosticReport,
) {
  const summary = report.summary;
  const pairs = summary.recentPreviousPairCounts;
  const dist = summary.occurrenceCountDistribution;
  const sessions = summary.distinctSessionDistribution;
  const buckets = summary.daysSinceLastSeenDiagnosticBuckets;
  const lines = [
    "TOPIC_SIGNAL_DIAGNOSTIC_V0",
    "development diagnostic only; not a UI contract and not a Signal class",
    `asOf: ${report.asOf ?? "null"}`,
    `conceptCount: ${summary.conceptCount}`,
    "",
    "occurrenceCountDistribution:",
    `  one=${dist.one} two=${dist.two} threeOrMore=${dist.threeOrMore}`,
    "distinctSessionDistribution:",
    `  oneSession=${sessions.oneSession} twoOrMoreSessions=${sessions.twoOrMoreSessions}`,
    "",
    "window coverage (Concepts with >=1 Occurrence in window):",
    `  conceptsWithOccurrence7d=${summary.conceptsWithOccurrence7d}`,
    `  conceptsWithOccurrence14d=${summary.conceptsWithOccurrence14d}`,
    `  conceptsWithOccurrence30d=${summary.conceptsWithOccurrence30d}`,
    formatSparsity("  sparsity7d", summary.windowSparsity7d),
    formatSparsity("  sparsity14d", summary.windowSparsity14d),
    formatSparsity("  sparsity30d", summary.windowSparsity30d),
    "",
    "recent7d / previous7d raw pair counts:",
    `  recent>0 previous=0: ${pairs.recentPositivePreviousZero}`,
    `  recent=0 previous>0: ${pairs.recentZeroPreviousPositive}`,
    `  both>0: ${pairs.bothPositive}`,
    `  both=0: ${pairs.bothZero}`,
    "",
    `daysSinceLastSeenValues: ${summary.daysSinceLastSeenValues.join(",") || "(none)"}`,
    "daysSinceLastSeen diagnostic buckets (not a Product threshold):",
    `  0-6=${buckets.from0to6} 7-13=${buckets.from7to13} 14-29=${buckets.from14to29} 30+=${buckets.from30orMore}`,
    "",
    "conceptsWithMultipleOccurrences:",
  ];

  if (summary.conceptsWithMultipleOccurrences.length === 0) {
    lines.push("  (none)");
  }
  for (const row of summary.conceptsWithMultipleOccurrences) {
    lines.push(
      [
        `  ${row.canonicalLabel}`,
        `total=${row.totalOccurrenceCount}`,
        `sessions=${row.distinctSessionCount}`,
        `days=${row.activeDayCount}`,
        `first=${row.firstSeenAt}`,
        `last=${row.lastSeenAt}`,
        `gaps=${row.occurrenceGapDays.join(",") || "n/a"}`,
      ].join(" | "),
    );
  }

  lines.push("", "conceptsObservedInMultipleSessions:");
  if (summary.conceptsObservedInMultipleSessions.length === 0) {
    lines.push("  (none)");
  }
  for (const row of summary.conceptsObservedInMultipleSessions) {
    lines.push(
      `  ${row.canonicalLabel} total=${row.totalOccurrenceCount} sessions=${row.distinctSessionCount}`,
    );
  }

  lines.push("", "conceptsWithSameSessionMultipleOccurrences:");
  if (summary.conceptsWithSameSessionMultipleOccurrences.length === 0) {
    lines.push("  (none)");
  }
  for (const row of summary.conceptsWithSameSessionMultipleOccurrences) {
    lines.push(
      `  ${row.canonicalLabel} total=${row.totalOccurrenceCount} sessions=${row.distinctSessionCount}`,
    );
  }

  lines.push(
    "",
    "concepts (snapshot order). windows=occ/sessions/days; delta=recent7d-previous7d",
  );
  for (const concept of report.concepts) {
    lines.push(
      [
        `  ${concept.canonicalLabel}`,
        `total=${concept.totalOccurrenceCount}`,
        `sessions=${concept.distinctSessionCount}`,
        `span=${concept.observedSpanDays}`,
        `daysSinceLastSeen=${concept.daysSinceLastSeen}`,
        `7d=${concept.recent7dOccurrenceCount}/${concept.previous7dOccurrenceCount}`,
        `delta=${concept.recent7dOccurrenceDelta}`,
        `14d=${formatWindow(concept.last14d)}`,
        `30d=${formatWindow(concept.last30d)}`,
      ].join(" | "),
    );
  }
  return lines.join("\n");
}
