import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { asc, eq } from "drizzle-orm";
import { toEvidenceRole } from "@/lib/ai/evidence-units";
import {
  CONCEPT_APPLY_APPLY_ERROR,
  CONCEPT_APPLY_DEFAULT_CANDIDATES,
  CONCEPT_APPLY_DEFAULT_MANIFEST,
} from "@/lib/concepts/admission/apply-manifest";
import { openReadonlyApplyDb } from "@/lib/concepts/admission/apply-preflight-pilot";
import { sortPilotSessions } from "@/lib/concepts/pilot";
import { prepareUserEvidenceUnits } from "@/lib/concepts/user-units";
import { getDbPath } from "@/lib/db/client";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  type ConceptQueryDb,
} from "@/lib/db/concept-queries";
import { conceptOccurrences, messages, sessions } from "@/lib/db/schema";
import {
  evaluateIncrementalSessionEligibility,
  loadInitialConceptProcessingCoverage,
  type IncrementalSessionEligibility,
} from "./eligibility";

export {
  CONCEPT_APPLY_APPLY_ERROR,
  CONCEPT_APPLY_DEFAULT_CANDIDATES,
  CONCEPT_APPLY_DEFAULT_MANIFEST,
};

export const CONCEPT_INCREMENTAL_PILOT_PREFLIGHT_DEFAULT_OUTPUT =
  "data/concept-incremental-pilot-preflight-v1.json";

export const CONCEPT_INCREMENTAL_PILOT_PREFLIGHT_ORDERING =
  "occurredAt_asc_then_sessionId_asc";

export const CONCEPT_INCREMENTAL_PILOT_PREFLIGHT_HELP = `Usage:
  npm run concept:incremental-pilot-preflight -- [--candidates <path>] [--manifest <path>] [--output <path>]

Read-only Incremental Pilot preflight against real SQLite.
Does not INSERT / UPDATE / DELETE. Does not call Extraction or planning.
--apply is not accepted.
`;

export type IncrementalPilotPreflightArgs = {
  apply: boolean;
  candidatesPath: string;
  manifestPath: string;
  outputPath: string;
};

export type IncrementalPilotDbCounts = {
  concepts: number;
  conceptAliases: number;
  conceptOccurrences: number;
  sessions: number;
  messages: number;
};

export type IncrementalPilotSessionRow = {
  sessionId: string;
  occurredAt: string | null;
  conversationId: string | null;
  userMessageCount: number | null;
  userEvidenceUnitCount: number | null;
  eligibility: IncrementalSessionEligibility["status"];
  reason: string | null;
  occurrenceCount: number;
};

export type IncrementalPilotCandidateRow = {
  sessionId: string;
  occurredAt: string;
  conversationId: string | null;
  userMessageCount: number;
  userEvidenceUnitCount: number;
};

export type IncrementalPilotPreflightReport = {
  status: "ready" | "blocked";
  blockers: Array<{ code: string; detail: string }>;
  generatedAt: string;
  ordering: typeof CONCEPT_INCREMENTAL_PILOT_PREFLIGHT_ORDERING;
  coverage: {
    ok: boolean;
    code: string | null;
    detail: string | null;
    sourceHash: string | null;
    expectedSourceHash: string;
    extractPromptVersion: string | null;
    extractionVersion: string | null;
    selectedSessionCount: number;
    selectedSessionIds: string[];
  };
  summary: {
    totalSessions: number;
    alreadyCoveredSessions: number;
    eligibleSessions: number;
    blockedSessions: number;
    eligibleWithUserEvidence: number;
    eligibleWithoutUserEvidence: number;
  };
  registry: {
    concepts: number;
    conceptAliases: number;
    conceptOccurrences: number;
  };
  db: {
    before: IncrementalPilotDbCounts;
    after: IncrementalPilotDbCounts;
  };
  initialCoveredInvariant: {
    ok: boolean;
    selectedSessionCount: number;
    presentInDb: number;
    alreadyCovered: number;
    missingFromDb: string[];
    notAlreadyCovered: string[];
  };
  coveredZeroOccurrenceSessionIds: string[];
  preferredPilotCandidates: IncrementalPilotCandidateRow[];
  eligibleWithoutUserEvidence: IncrementalPilotCandidateRow[];
  alreadyCovered: IncrementalPilotSessionRow[];
  blocked: IncrementalPilotSessionRow[];
};

export type IncrementalPilotPreflightDeps = {
  openDb: (dbPath: string) => ConceptQueryDb;
  dbPath?: string;
  readFile?: (path: string) => string;
  writeReport?: (path: string, payload: unknown) => void;
  now?: () => string;
};

function uniqueSorted(ids: string[]) {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function snapshotDbCounts(db: ConceptQueryDb): IncrementalPilotDbCounts {
  return {
    concepts: countConcepts(db),
    conceptAliases: countConceptAliases(db),
    conceptOccurrences: countConceptOccurrences(db),
    sessions: db.select().from(sessions).all().length,
    messages: db.select().from(messages).all().length,
  };
}

function occurrenceCountBySession(db: ConceptQueryDb): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of db.select().from(conceptOccurrences).all()) {
    counts.set(row.sessionId, (counts.get(row.sessionId) ?? 0) + 1);
  }
  return counts;
}

function loadSessionMessages(db: ConceptQueryDb, sessionId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.index))
    .all();
}

export function sourceCandidateReportHashFromManifestText(text: string):
  | { ok: true; hash: string }
  | { ok: false; code: string; detail: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "malformed_manifest", detail: "manifest_json" };
  }
  if (!raw || typeof raw !== "object") {
    return { ok: false, code: "malformed_manifest", detail: "manifest_object" };
  }
  const metadata = (raw as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") {
    return { ok: false, code: "malformed_manifest", detail: "metadata" };
  }
  const hash = (metadata as { sourceCandidateReportHash?: unknown })
    .sourceCandidateReportHash;
  if (typeof hash !== "string" || !hash.trim()) {
    return {
      ok: false,
      code: "malformed_manifest",
      detail: "sourceCandidateReportHash",
    };
  }
  return { ok: true, hash };
}

function sortSessionRows(rows: IncrementalPilotSessionRow[]) {
  const withOccurredAt = rows.filter(
    (row): row is IncrementalPilotSessionRow & { occurredAt: string } =>
      typeof row.occurredAt === "string",
  );
  const withoutOccurredAt = rows.filter((row) => row.occurredAt == null);
  const orderedPresent = sortPilotSessions(
    withOccurredAt.map((row) => ({
      sessionId: row.sessionId,
      occurredAt: row.occurredAt,
      row,
    })),
  ).map((item) => item.row);
  const orderedMissing = [...withoutOccurredAt].sort((left, right) =>
    left.sessionId.localeCompare(right.sessionId),
  );
  return [...orderedPresent, ...orderedMissing];
}

function toCandidateRow(
  row: IncrementalPilotSessionRow,
): IncrementalPilotCandidateRow | null {
  if (
    row.occurredAt == null ||
    row.userMessageCount == null ||
    row.userEvidenceUnitCount == null
  ) {
    return null;
  }
  return {
    sessionId: row.sessionId,
    occurredAt: row.occurredAt,
    conversationId: row.conversationId,
    userMessageCount: row.userMessageCount,
    userEvidenceUnitCount: row.userEvidenceUnitCount,
  };
}

function describeRow(db: ConceptQueryDb, sessionId: string): {
  occurredAt: string | null;
  conversationId: string | null;
  userMessageCount: number | null;
  userEvidenceUnitCount: number | null;
} {
  const session = db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
  if (!session) {
    return {
      occurredAt: null,
      conversationId: null,
      userMessageCount: null,
      userEvidenceUnitCount: null,
    };
  }
  const sessionMessages = loadSessionMessages(db, sessionId);
  const userMessageCount = sessionMessages.filter(
    (message) => toEvidenceRole(message.role) === "user",
  ).length;
  const userEvidenceUnitCount = prepareUserEvidenceUnits({
    sessionId,
    occurredAt: session.occurredAt,
    messages: sessionMessages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      sourceCreatedAt: message.sourceCreatedAt,
    })),
  }).length;
  return {
    occurredAt: session.occurredAt,
    conversationId: session.sourceConversationId,
    userMessageCount,
    userEvidenceUnitCount,
  };
}

export function buildIncrementalPilotPreflightReport(input: {
  db: ConceptQueryDb;
  candidateReportText: string;
  expectedSourceHash: string;
  now?: () => string;
}): IncrementalPilotPreflightReport {
  const before = snapshotDbCounts(input.db);
  const coverage = loadInitialConceptProcessingCoverage({
    candidateReportText: input.candidateReportText,
    expectedSourceHash: input.expectedSourceHash,
  });
  const dbSessionIds = input.db
    .select({ id: sessions.id })
    .from(sessions)
    .all()
    .map((row) => row.id);
  const coverageIds = coverage.ok ? coverage.coverage.sessionIds : [];
  const evaluateIds = uniqueSorted([...dbSessionIds, ...coverageIds]);
  const occCounts = occurrenceCountBySession(input.db);
  const dbIdSet = new Set(dbSessionIds);

  const rows: IncrementalPilotSessionRow[] = evaluateIds.map((sessionId) => {
    const eligibility = evaluateIncrementalSessionEligibility({
      sessionId,
      db: input.db,
      coverage,
    });
    const described = describeRow(input.db, sessionId);
    return {
      sessionId,
      occurredAt: described.occurredAt,
      conversationId: described.conversationId,
      userMessageCount: described.userMessageCount,
      userEvidenceUnitCount: described.userEvidenceUnitCount,
      eligibility: eligibility.status,
      reason:
        eligibility.status === "eligible" ? null : eligibility.reason,
      occurrenceCount: occCounts.get(sessionId) ?? 0,
    };
  });
  const orderedRows = sortSessionRows(rows);

  const alreadyCovered = orderedRows.filter(
    (row) => row.eligibility === "already_covered",
  );
  const eligible = orderedRows.filter((row) => row.eligibility === "eligible");
  const blocked = orderedRows.filter((row) => row.eligibility === "blocked");
  const eligibleWithEvidence = eligible.filter(
    (row) => (row.userEvidenceUnitCount ?? 0) >= 1,
  );
  const eligibleWithoutEvidence = eligible.filter(
    (row) => (row.userEvidenceUnitCount ?? 0) === 0,
  );

  const missingFromDb = uniqueSorted(
    coverageIds.filter((sessionId) => !dbIdSet.has(sessionId)),
  );
  const notAlreadyCovered = uniqueSorted(
    coverageIds.filter((sessionId) => {
      const row = orderedRows.find((item) => item.sessionId === sessionId);
      return row?.eligibility !== "already_covered";
    }),
  );
  const presentInDb = coverageIds.filter((sessionId) => dbIdSet.has(sessionId))
    .length;
  const alreadyCoveredSelected = coverageIds.filter((sessionId) => {
    const row = orderedRows.find((item) => item.sessionId === sessionId);
    return row?.eligibility === "already_covered";
  }).length;
  const invariantOk =
    coverage.ok &&
    missingFromDb.length === 0 &&
    notAlreadyCovered.length === 0 &&
    alreadyCoveredSelected === coverageIds.length;

  const blockers: Array<{ code: string; detail: string }> = [];
  if (!coverage.ok) {
    blockers.push({ code: coverage.code, detail: coverage.detail });
  }
  if (coverage.ok && !invariantOk) {
    blockers.push({
      code: "initial_covered_invariant",
      detail: [
        `missingFromDb=${missingFromDb.length}`,
        `notAlreadyCovered=${notAlreadyCovered.length}`,
      ].join(","),
    });
  }

  const after = snapshotDbCounts(input.db);
  const generatedAt = (input.now ?? (() => new Date().toISOString()))();

  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    generatedAt,
    ordering: CONCEPT_INCREMENTAL_PILOT_PREFLIGHT_ORDERING,
    coverage: {
      ok: coverage.ok,
      code: coverage.ok ? null : coverage.code,
      detail: coverage.ok ? null : coverage.detail,
      sourceHash: coverage.ok ? coverage.coverage.sourceHash : null,
      expectedSourceHash: input.expectedSourceHash,
      extractPromptVersion: coverage.ok
        ? coverage.coverage.extractPromptVersion
        : null,
      extractionVersion: coverage.ok
        ? coverage.coverage.extractionVersion
        : null,
      selectedSessionCount: coverageIds.length,
      selectedSessionIds: coverageIds,
    },
    summary: {
      totalSessions: dbSessionIds.length,
      alreadyCoveredSessions: alreadyCovered.length,
      eligibleSessions: eligible.length,
      blockedSessions: blocked.length,
      eligibleWithUserEvidence: eligibleWithEvidence.length,
      eligibleWithoutUserEvidence: eligibleWithoutEvidence.length,
    },
    registry: {
      concepts: after.concepts,
      conceptAliases: after.conceptAliases,
      conceptOccurrences: after.conceptOccurrences,
    },
    db: { before, after },
    initialCoveredInvariant: {
      ok: invariantOk,
      selectedSessionCount: coverageIds.length,
      presentInDb,
      alreadyCovered: alreadyCoveredSelected,
      missingFromDb,
      notAlreadyCovered,
    },
    coveredZeroOccurrenceSessionIds: alreadyCovered
      .filter((row) => row.occurrenceCount === 0)
      .map((row) => row.sessionId),
    preferredPilotCandidates: eligibleWithEvidence
      .map(toCandidateRow)
      .filter((row): row is IncrementalPilotCandidateRow => row != null),
    eligibleWithoutUserEvidence: eligibleWithoutEvidence
      .map(toCandidateRow)
      .filter((row): row is IncrementalPilotCandidateRow => row != null),
    alreadyCovered,
    blocked,
  };
}

export function parseConceptIncrementalPilotPreflightArgs(
  argv: string[],
): IncrementalPilotPreflightArgs {
  let apply = false;
  let candidatesPath = CONCEPT_APPLY_DEFAULT_CANDIDATES;
  let manifestPath = CONCEPT_APPLY_DEFAULT_MANIFEST;
  let outputPath = CONCEPT_INCREMENTAL_PILOT_PREFLIGHT_DEFAULT_OUTPUT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--candidates") {
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        candidatesPath = value;
        i += 1;
      }
      continue;
    }
    if (arg === "--manifest") {
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        manifestPath = value;
        i += 1;
      }
      continue;
    }
    if (arg === "--output") {
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        outputPath = value;
        i += 1;
      }
    }
  }
  return { apply, candidatesPath, manifestPath, outputPath };
}

export function writeIncrementalPilotPreflightReportFile(
  path: string,
  payload: unknown,
) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function incrementalPilotPreflightReportPayload(
  report: IncrementalPilotPreflightReport,
) {
  return report;
}

export function formatIncrementalPilotPreflightSummary(
  report: IncrementalPilotPreflightReport,
) {
  const lines = [
    `status: ${report.status}`,
    `ordering: ${report.ordering}`,
    `coverage: ok=${report.coverage.ok} selected=${report.coverage.selectedSessionCount} prompt=${report.coverage.extractPromptVersion} extraction=${report.coverage.extractionVersion}`,
    `sourceHash: ${report.coverage.sourceHash ?? "(unresolved)"}`,
    `summary: total=${report.summary.totalSessions} already_covered=${report.summary.alreadyCoveredSessions} eligible=${report.summary.eligibleSessions} blocked=${report.summary.blockedSessions} eligibleWithUserEvidence=${report.summary.eligibleWithUserEvidence} eligibleWithoutUserEvidence=${report.summary.eligibleWithoutUserEvidence}`,
    `initialCoveredInvariant: ok=${report.initialCoveredInvariant.ok} present=${report.initialCoveredInvariant.presentInDb}/${report.initialCoveredInvariant.selectedSessionCount} already_covered=${report.initialCoveredInvariant.alreadyCovered}`,
    `coveredZeroOccurrence: ${report.coveredZeroOccurrenceSessionIds.length}`,
    `registry: concepts=${report.registry.concepts} aliases=${report.registry.conceptAliases} occurrences=${report.registry.conceptOccurrences}`,
    `preferredPilotCandidates: ${report.preferredPilotCandidates.length}`,
  ];
  if (report.blockers.length > 0) {
    lines.push(
      `blockers: ${report.blockers.map((item) => `${item.code}:${item.detail}`).join(" | ")}`,
    );
  }
  for (const candidate of report.preferredPilotCandidates) {
    lines.push(
      `  candidate ${candidate.sessionId} occurredAt=${candidate.occurredAt} userMessages=${candidate.userMessageCount} userEvidenceUnits=${candidate.userEvidenceUnitCount} conversationId=${candidate.conversationId ?? "null"}`,
    );
  }
  lines.push(
    "pilot session is not auto-selected; choose 1 eligible Session in the next STEP.",
  );
  return lines.join("\n");
}

export function runConceptIncrementalPilotPreflight(
  argv: string[],
  deps: IncrementalPilotPreflightDeps,
):
  | { ok: true; report: IncrementalPilotPreflightReport; summary: string }
  | { ok: false; code: string; error: string } {
  const parsed = parseConceptIncrementalPilotPreflightArgs(argv);
  if (parsed.apply) {
    return { ok: false, code: "apply", error: CONCEPT_APPLY_APPLY_ERROR };
  }

  const reader =
    deps.readFile ?? ((path: string) => readFileSync(resolve(path), "utf8"));
  const dbPath = deps.dbPath ?? getDbPath();
  let candidateText: string;
  let manifestText: string;
  try {
    candidateText = reader(parsed.candidatesPath);
    manifestText = reader(parsed.manifestPath);
  } catch (error) {
    return {
      ok: false,
      code: "read",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const expectedHash = sourceCandidateReportHashFromManifestText(manifestText);
  if (!expectedHash.ok) {
    return {
      ok: false,
      code: expectedHash.code,
      error: expectedHash.detail,
    };
  }

  const db = deps.openDb(dbPath);
  const report = buildIncrementalPilotPreflightReport({
    db,
    candidateReportText: candidateText,
    expectedSourceHash: expectedHash.hash,
    now: deps.now,
  });
  const writer = deps.writeReport ?? writeIncrementalPilotPreflightReportFile;
  writer(parsed.outputPath, incrementalPilotPreflightReportPayload(report));
  return {
    ok: true,
    report,
    summary: formatIncrementalPilotPreflightSummary(report),
  };
}

export function defaultOpenReadonlyIncrementalPilotDb(dbPath: string) {
  return openReadonlyApplyDb(dbPath);
}
