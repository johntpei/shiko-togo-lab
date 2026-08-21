import type { ConceptResolveResult } from "./resolve";

export type ConceptResolveMetrics = {
  processedUnits: number;
  match: number;
  new: number;
  skip: number;
  uncertain: number;
  rejected: number;
  occurrences: number;
  uniqueConceptCandidates: number;
    aliases: number;
    aliasRejected: number;
    provisionalMatch: number;
    rejectReasons: Record<string, number>;
    aliasRejectReasons: Record<string, number>;
  };

export function summarizeConceptResolve(
  processedUnits: number,
  result: ConceptResolveResult,
): ConceptResolveMetrics {
  const rejectReasons: Record<string, number> = {};
  for (const item of result.rejected) {
    const key = item.detail
      ? `${item.reason}:${item.detail}`
      : item.reason;
    rejectReasons[key] = (rejectReasons[key] ?? 0) + 1;
  }
  const aliasRejectReasons: Record<string, number> = {};
  for (const item of result.rejectedAliases) {
    aliasRejectReasons[item.reason] =
      (aliasRejectReasons[item.reason] ?? 0) + 1;
  }

  const uniqueConceptCandidates = new Set(
    result.occurrences.map((occurrence) => occurrence.conceptId),
  ).size;

  return {
    processedUnits,
    match: result.occurrences.filter((item) => item.resolvedAs === "match")
      .length,
    new: result.newConcepts.length,
    skip: result.skipped.length,
    uncertain: result.uncertain.length,
    rejected: result.rejected.length,
    occurrences: result.occurrences.length,
    uniqueConceptCandidates,
    aliases: result.aliasCandidates.length,
    aliasRejected: result.rejectedAliases.length,
    provisionalMatch: result.provisionalMatches.length,
    rejectReasons,
    aliasRejectReasons,
  };
}
