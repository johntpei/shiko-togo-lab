import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import type {
  AiProvider,
  StructuredGenerateUsage,
} from "@/lib/ai/provider";
import { runConceptExtractSession } from "@/lib/ai/tasks/concept-extract";
import {
  emptyConceptCatalog,
  type ConceptRegistrySnapshot,
} from "./catalog";
import { summarizeConceptResolve } from "./metrics";
import { CONCEPT_EXTRACTION_VERSION } from "./types";
import {
  detectSuspiciousConcepts,
  type SuspiciousFinding,
} from "./suspicious";
import type { ConceptExtractMessage } from "./user-units";
import type { ConceptOccurrenceOperation } from "./resolve";

export const CONCEPT_PILOT_DEFAULT_OUTPUT = "data/concept-pilot.json";
export const CONCEPT_PILOT_APPLY_ERROR = "apply is not implemented in 3C-1b";

export const CONCEPT_PILOT_HELP = `Usage:
  npm run concept:pilot -- --session <id> [--session <id> ...]

Always dry-run. Does not write Concept / Alias / Occurrence to the database.
--apply is not implemented in 3C-1b.

Options:
  --session <id>   Session to process (repeatable). Required.
  --output <path>  JSON report path (default: ${CONCEPT_PILOT_DEFAULT_OUTPUT})
`;

export type ConceptPilotSessionRecord = {
  sessionId: string;
  occurredAt: string;
  messages: ConceptExtractMessage[];
};

export type ConceptPilotFailedSession = {
  sessionId: string;
  code: string;
  error: string;
};

export type ConceptPilotActionRow = {
  sessionId: string;
  evidenceRef: string;
  surfaceForm: string;
  originalAction: string;
  resolvedAs: string | null;
  conceptRef: string | null;
  canonicalLabel: string | null;
  aliases: string[];
  rejectReason: string | null;
};

export type ConceptPilotConceptRow = {
  ref: string;
  canonicalLabel: string;
  normalizedKey: string;
  aliases: string[];
  occurrenceCount: number;
  distinctSessionCount: number;
};

export type ConceptPilotReport = {
  metadata: {
    generatedAt: string;
    model: string | null;
    promptVersion: string;
    extractionVersion: string;
    selectedSessionIds: string[];
    outputPath: string;
  };
  totals: {
    sessions: number;
    processedUnits: number;
    apiCalls: number;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    match: number;
    new: number;
    skip: number;
    uncertain: number;
    rejected: number;
    occurrences: number;
    uniqueConceptCandidates: number;
    aliases: number;
    failedSessions: number;
  };
  concepts: ConceptPilotConceptRow[];
  actions: ConceptPilotActionRow[];
  failedSessions: ConceptPilotFailedSession[];
  suspicious: SuspiciousFinding[];
};

export type ConceptPilotDeps = {
  generateStructured: AiProvider["generateStructured"];
  loadSession: (sessionId: string) => ConceptPilotSessionRecord | null;
  now?: () => string;
  writeReport?: (path: string, report: ConceptPilotReport) => void;
};

export type ConceptPilotRunResult =
  | { ok: true; report: ConceptPilotReport; outputPath: string }
  | { ok: false; error: string; code: string };

export function parseConceptPilotArgs(argv: string[]): {
  sessionIds: string[];
  apply: boolean;
  outputPath: string;
} {
  const sessionIds: string[] = [];
  let apply = false;
  let outputPath = CONCEPT_PILOT_DEFAULT_OUTPUT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--output") {
      const value = argv[i + 1];
      if (value) {
        outputPath = value;
        i += 1;
      }
      continue;
    }
    if (arg === "--session") {
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        sessionIds.push(value);
        i += 1;
      }
      continue;
    }
  }
  return { sessionIds, apply, outputPath };
}

export function sortPilotSessions<T extends { sessionId: string; occurredAt: string }>(
  sessions: T[],
): T[] {
  return [...sessions].sort((left, right) => {
    const byDate = left.occurredAt.localeCompare(right.occurredAt);
    if (byDate !== 0) {
      return byDate;
    }
    return left.sessionId.localeCompare(right.sessionId);
  });
}

function addUsage(
  current: StructuredGenerateUsage,
  next: StructuredGenerateUsage | null,
): StructuredGenerateUsage {
  if (!next) {
    return current;
  }
  const sum = (a: number | null, b: number | null) => {
    if (a == null && b == null) {
      return null;
    }
    return (a ?? 0) + (b ?? 0);
  };
  return {
    inputTokens: sum(current.inputTokens, next.inputTokens),
    outputTokens: sum(current.outputTokens, next.outputTokens),
    totalTokens: sum(current.totalTokens, next.totalTokens),
  };
}

export function writeConceptPilotReportFile(
  path: string,
  report: ConceptPilotReport,
) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function formatConceptPilotSummary(report: ConceptPilotReport) {
  const failed =
    report.failedSessions.length === 0
      ? "none"
      : report.failedSessions
          .map((item) => `${item.sessionId} (${item.code})`)
          .join(", ");
  return [
    "Concept extraction dry-run",
    `sessions: ${report.totals.sessions - report.totals.failedSessions} processed / ${report.totals.failedSessions} failed`,
    `units: ${report.totals.processedUnits}`,
    `NEW: ${report.totals.new}  MATCH: ${report.totals.match}  SKIP: ${report.totals.skip}  UNCERTAIN: ${report.totals.uncertain}  rejected: ${report.totals.rejected}`,
    `concepts: ${report.concepts.length}`,
    `failed: ${failed}`,
    `report: ${report.metadata.outputPath}`,
  ].join("\n");
}

export async function runConceptPilot(
  argv: string[],
  deps: ConceptPilotDeps,
): Promise<ConceptPilotRunResult> {
  const parsed = parseConceptPilotArgs(argv);
  if (parsed.apply) {
    return {
      ok: false,
      code: "apply_not_implemented",
      error: CONCEPT_PILOT_APPLY_ERROR,
    };
  }
  if (parsed.sessionIds.length === 0) {
    return {
      ok: false,
      code: "no_sessions",
      error: CONCEPT_PILOT_HELP,
    };
  }

  const failedSessions: ConceptPilotFailedSession[] = [];
  const loaded: ConceptPilotSessionRecord[] = [];
  for (const sessionId of parsed.sessionIds) {
    const session = deps.loadSession(sessionId);
    if (!session) {
      failedSessions.push({
        sessionId,
        code: "not_found",
        error: "Sessionが見つかりません。",
      });
      continue;
    }
    loaded.push(session);
  }

  const ordered = sortPilotSessions(loaded);
  let catalog: ConceptRegistrySnapshot = emptyConceptCatalog();
  const actions: ConceptPilotActionRow[] = [];
  const occurrences: ConceptOccurrenceOperation[] = [];
  let processedUnits = 0;
  let apiCalls = 0;
  let usage: StructuredGenerateUsage = {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  };
  let match = 0;
  let created = 0;
  let skip = 0;
  let uncertain = 0;
  let rejected = 0;
  let aliasCount = 0;
  let model: string | null = null;

  for (const session of ordered) {
    try {
      const result = await runConceptExtractSession(
        {
          sessionId: session.sessionId,
          occurredAt: session.occurredAt,
          messages: session.messages,
          catalog,
        },
        { generateStructured: deps.generateStructured },
      );
      if (!result.ok) {
        failedSessions.push({
          sessionId: session.sessionId,
          code: result.code,
          error: result.error,
        });
        continue;
      }
      catalog = result.resolve.nextCatalog;
      processedUnits += result.units.length;
      apiCalls += result.apiCalls;
      usage = addUsage(usage, result.usage);
      model = result.model || model;
      const metrics = summarizeConceptResolve(
        result.units.length,
        result.resolve,
      );
      match += metrics.match;
      created += metrics.new;
      skip += metrics.skip;
      uncertain += metrics.uncertain;
      rejected += metrics.rejected;
      aliasCount += metrics.aliases;
      occurrences.push(...result.resolve.occurrences);
      for (const outcome of result.resolve.outcomes) {
        actions.push({
          sessionId: session.sessionId,
          evidenceRef: outcome.evidenceRef,
          surfaceForm: outcome.surfaceForm,
          originalAction: outcome.originalAction,
          resolvedAs: outcome.resolvedAs ?? outcome.status,
          conceptRef: outcome.conceptRef ?? null,
          canonicalLabel: outcome.canonicalLabel ?? null,
          aliases: outcome.aliases ?? [],
          rejectReason: outcome.rejectReason
            ? outcome.detail
              ? `${outcome.rejectReason}:${outcome.detail}`
              : outcome.rejectReason
            : null,
        });
      }
    } catch (error) {
      failedSessions.push({
        sessionId: session.sessionId,
        code: "api",
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  const occurrenceByConcept = new Map<
    string,
    { count: number; sessions: Set<string> }
  >();
  for (const occurrence of occurrences) {
    const current = occurrenceByConcept.get(occurrence.conceptId) ?? {
      count: 0,
      sessions: new Set<string>(),
    };
    current.count += 1;
    current.sessions.add(occurrence.sessionId);
    occurrenceByConcept.set(occurrence.conceptId, current);
  }

  const concepts: ConceptPilotConceptRow[] = catalog.entries.map((entry) => {
    const stats = occurrenceByConcept.get(entry.conceptId);
    return {
      ref: entry.ref,
      canonicalLabel: entry.canonicalLabel,
      normalizedKey: entry.normalizedKey,
      aliases: entry.aliases,
      occurrenceCount: stats?.count ?? 0,
      distinctSessionCount: stats?.sessions.size ?? 0,
    };
  });

  const report: ConceptPilotReport = {
    metadata: {
      generatedAt: (deps.now ?? (() => new Date().toISOString()))(),
      model,
      promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
      selectedSessionIds: parsed.sessionIds,
      outputPath: parsed.outputPath,
    },
    totals: {
      sessions: parsed.sessionIds.length,
      processedUnits,
      apiCalls,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      match,
      new: created,
      skip,
      uncertain,
      rejected,
      occurrences: occurrences.length,
      uniqueConceptCandidates: catalog.entries.length,
      aliases: aliasCount,
      failedSessions: failedSessions.length,
    },
    concepts,
    actions,
    failedSessions,
    suspicious: detectSuspiciousConcepts({ catalog, occurrences }),
  };

  const writer = deps.writeReport ?? writeConceptPilotReportFile;
  writer(parsed.outputPath, report);
  return { ok: true, report, outputPath: parsed.outputPath };
}
