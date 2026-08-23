import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import {
  CONCEPT_APPLY_DEFAULT_CANDIDATES,
  CONCEPT_APPLY_DEFAULT_MANIFEST,
} from "@/lib/concepts/admission/apply-manifest";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { getDbPath } from "@/lib/db/client";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  type ConceptQueryDb,
} from "@/lib/db/concept-queries";
import { messages, sessions } from "@/lib/db/schema";
import {
  CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_DEFAULT_PATH,
  intentToExistingMatchPlans,
  loadExistingMatchAppendIntent,
  type ExistingMatchAppendIntent,
} from "./append-intent";
import {
  evaluateIncrementalSessionEligibility,
  loadInitialConceptProcessingCoverage,
} from "./eligibility";
import { sourceCandidateReportHashFromManifestText } from "./pilot-preflight";
import {
  runExistingMatchOccurrencePreflight,
  type ExistingMatchOccurrencePlanDiagnostic,
  type ExistingMatchOccurrencePreflightBlocker,
  type ExistingMatchOccurrencePreflightResult,
} from "./preflight";

export const CONCEPT_INCREMENTAL_EXISTING_PREFLIGHT_DEFAULT_OUTPUT =
  "data/concept-incremental-existing-preflight-result-v1.json";

export const CONCEPT_INCREMENTAL_EXISTING_PREFLIGHT_APPLY_ERROR =
  "existing-match occurrence preflight is read-only; --apply is not accepted";

export const CONCEPT_INCREMENTAL_EXISTING_PREFLIGHT_HELP = `Usage:
  npm run concept:incremental-existing-preflight -- --intent <path> [--candidates <path>] [--manifest <path>] [--output <path>]

Read-only Existing-Match Occurrence preflight from a Frozen Intent.
Does not call Extraction or Planning. Does not append Occurrences.
--apply is not accepted.
`;

export const REAL_EXISTING_MATCH_PREFLIGHT_READY =
  "REAL_EXISTING_MATCH_PREFLIGHT_READY";
export const REAL_EXISTING_MATCH_PREFLIGHT_NO_OP =
  "REAL_EXISTING_MATCH_PREFLIGHT_NO_OP";
export const REAL_EXISTING_MATCH_PREFLIGHT_BLOCKED =
  "REAL_EXISTING_MATCH_PREFLIGHT_BLOCKED";

export type ExistingMatchIntentPreflightClassification =
  | typeof REAL_EXISTING_MATCH_PREFLIGHT_READY
  | typeof REAL_EXISTING_MATCH_PREFLIGHT_NO_OP
  | typeof REAL_EXISTING_MATCH_PREFLIGHT_BLOCKED;

export type ExistingMatchIntentPreflightArgs = {
  apply: boolean;
  malformed: boolean;
  malformedReason: string | null;
  intentPath: string | null;
  candidatesPath: string;
  manifestPath: string;
  outputPath: string;
};

export type ExistingMatchIntentPreflightDbCounts = {
  concepts: number;
  conceptAliases: number;
  conceptOccurrences: number;
  sessions: number;
  messages: number;
};

export type ExistingMatchIntentPreflightPlanRow = {
  candidateRef: string;
  conceptId: string;
  evidenceRef: string;
  matchReason: string;
  classification: ExistingMatchOccurrencePlanDiagnostic["classification"] | null;
  code: string | null;
};

export type ExistingMatchIntentPreflightReport = {
  classification: ExistingMatchIntentPreflightClassification;
  status: "ready" | "no_op" | "blocked";
  executedAt: string;
  intentPath: string | null;
  intentVersion: string | null;
  intentMode: string | null;
  intentContentHash: string | null;
  sessionId: string | null;
  frozenPlanCount: number;
  source: {
    model: string | null;
    promptVersion: string | null;
    extractionVersion: string | null;
    coverageSourceHash: string | null;
  };
  coverage: {
    ok: boolean;
    sourceHash: string | null;
    expectedSourceHash: string | null;
    intentCoverageSourceHash: string | null;
  };
  eligibility: "eligible" | "already_covered" | "blocked" | "unresolved";
  eligibilityReason: string | null;
  plansChecked: number;
  predictedCreates: number;
  alreadyPresent: number;
  conflicts: number;
  blockers: ExistingMatchOccurrencePreflightBlocker[];
  plans: ExistingMatchIntentPreflightPlanRow[];
  preflightExecuted: boolean;
  generateStructuredCalls: 0;
  sessionPlanning: 0;
  occurrenceAppend: 0;
  db: {
    before: ExistingMatchIntentPreflightDbCounts;
    after: ExistingMatchIntentPreflightDbCounts;
  };
};

export type ExistingMatchIntentPreflightDeps = {
  openDb: (dbPath: string) => ConceptQueryDb;
  dbPath?: string;
  readFile?: (path: string) => string;
  writeDiagnostic?: (path: string, payload: unknown) => void;
  now?: () => string;
};

function emptyCounts(): ExistingMatchIntentPreflightDbCounts {
  return {
    concepts: 0,
    conceptAliases: 0,
    conceptOccurrences: 0,
    sessions: 0,
    messages: 0,
  };
}

function snapshotDbCounts(
  db: ConceptQueryDb,
): ExistingMatchIntentPreflightDbCounts {
  return {
    concepts: countConcepts(db),
    conceptAliases: countConceptAliases(db),
    conceptOccurrences: countConceptOccurrences(db),
    sessions: db.select().from(sessions).all().length,
    messages: db.select().from(messages).all().length,
  };
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseConceptIncrementalExistingPreflightArgs(
  argv: string[],
): ExistingMatchIntentPreflightArgs {
  let apply = false;
  let malformed = false;
  let malformedReason: string | null = null;
  const intentPaths: string[] = [];
  let candidatesPath = CONCEPT_APPLY_DEFAULT_CANDIDATES;
  let manifestPath = CONCEPT_APPLY_DEFAULT_MANIFEST;
  let outputPath = CONCEPT_INCREMENTAL_EXISTING_PREFLIGHT_DEFAULT_OUTPUT;

  const takeValue = (index: number) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      malformed = true;
      malformedReason = "missing_option_value";
      return null;
    }
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--intent") {
      const value = takeValue(i);
      if (value) {
        intentPaths.push(value);
        i += 1;
      }
      continue;
    }
    if (arg === "--candidates") {
      const value = takeValue(i);
      if (value) {
        candidatesPath = value;
        i += 1;
      }
      continue;
    }
    if (arg === "--manifest") {
      const value = takeValue(i);
      if (value) {
        manifestPath = value;
        i += 1;
      }
      continue;
    }
    if (arg === "--output") {
      const value = takeValue(i);
      if (value) {
        outputPath = value;
        i += 1;
      }
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      continue;
    }
    malformed = true;
    malformedReason = `unexpected_arg:${arg}`;
  }

  if (intentPaths.length > 1) {
    malformed = true;
    malformedReason = "multiple_intents";
  }
  if (!malformed && intentPaths.length === 0 && !apply) {
    malformed = true;
    malformedReason = "missing_intent";
  }

  return {
    apply,
    malformed,
    malformedReason,
    intentPath: intentPaths.length === 1 ? intentPaths[0]! : null,
    candidatesPath,
    manifestPath,
    outputPath,
  };
}

export function writeExistingMatchIntentPreflightDiagnostic(
  path: string,
  payload: unknown,
) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function formatExistingMatchIntentPreflightSummary(
  report: ExistingMatchIntentPreflightReport,
) {
  const lines = [
    report.classification,
    `status: ${report.status}`,
    `intentPath: ${report.intentPath ?? "(none)"}`,
    `intentVersion: ${report.intentVersion ?? "(none)"} mode: ${report.intentMode ?? "(none)"}`,
    `intentContentHash: ${report.intentContentHash ?? "(none)"}`,
    `sessionId: ${report.sessionId ?? "(none)"}`,
    `frozenPlanCount: ${report.frozenPlanCount}`,
    `source: model=${report.source.model ?? "(none)"} prompt=${report.source.promptVersion ?? "(none)"} extraction=${report.source.extractionVersion ?? "(none)"}`,
    `coverage: ok=${report.coverage.ok} current=${report.coverage.sourceHash ?? "null"} intent=${report.coverage.intentCoverageSourceHash ?? "null"}`,
    `eligibility: ${report.eligibility}${report.eligibilityReason ? ` (${report.eligibilityReason})` : ""}`,
    `preflightExecuted: ${report.preflightExecuted}`,
    `plansChecked: ${report.plansChecked} predictedCreates: ${report.predictedCreates} alreadyPresent: ${report.alreadyPresent} conflicts: ${report.conflicts}`,
    `generateStructuredCalls: ${report.generateStructuredCalls} sessionPlanning: ${report.sessionPlanning} occurrenceAppend: ${report.occurrenceAppend}`,
  ];
  if (report.blockers.length > 0) {
    for (const blocker of report.blockers) {
      lines.push(
        `blocker: ${blocker.code}${blocker.candidateRef ? ` candidateRef=${blocker.candidateRef}` : ""}`,
      );
    }
  }
  for (const plan of report.plans) {
    lines.push(
      `  plan candidateRef=${plan.candidateRef} conceptId=${plan.conceptId} evidenceRef=${plan.evidenceRef} matchReason=${plan.matchReason} classification=${plan.classification ?? "null"}`,
    );
  }
  lines.push("Occurrence append / Assessment / Policy / LLM were not run.");
  return lines.join("\n");
}

function emptySource() {
  return {
    model: null as string | null,
    promptVersion: null as string | null,
    extractionVersion: null as string | null,
    coverageSourceHash: null as string | null,
  };
}

function sourceFromIntent(intent: ExistingMatchAppendIntent) {
  return {
    model: intent.metadata.source.model,
    promptVersion: intent.metadata.source.promptVersion,
    extractionVersion: intent.metadata.source.extractionVersion,
    coverageSourceHash: intent.metadata.source.coverageSourceHash,
  };
}

function sessionInvariantError(
  intent: ExistingMatchAppendIntent,
  plans: ReturnType<typeof intentToExistingMatchPlans>,
) {
  for (const plan of plans) {
    if (plan.provenance.sessionId !== intent.metadata.sessionId) {
      return `session_invariant:${plan.provenance.sessionId}!=${intent.metadata.sessionId}`;
    }
  }
  return null;
}

function sourceContractError(intent: ExistingMatchAppendIntent) {
  const source = intent.metadata.source;
  if (!nonempty(source.model)) {
    return "source_model";
  }
  if (source.promptVersion !== CONCEPT_EXTRACT_PROMPT_VERSION) {
    return `promptVersion:${source.promptVersion}`;
  }
  if (source.extractionVersion !== CONCEPT_EXTRACTION_VERSION) {
    return `extractionVersion:${source.extractionVersion}`;
  }
  return null;
}

export async function runConceptIncrementalExistingPreflight(
  argv: string[],
  deps: ExistingMatchIntentPreflightDeps,
): Promise<
  | { ok: true; report: ExistingMatchIntentPreflightReport; summary: string }
  | { ok: false; code: string; error: string }
> {
  const parsed = parseConceptIncrementalExistingPreflightArgs(argv);
  if (parsed.apply) {
    return {
      ok: false,
      code: "apply",
      error: CONCEPT_INCREMENTAL_EXISTING_PREFLIGHT_APPLY_ERROR,
    };
  }
  if (parsed.malformed || !parsed.intentPath) {
    return {
      ok: false,
      code: parsed.malformedReason ?? "malformed",
      error: CONCEPT_INCREMENTAL_EXISTING_PREFLIGHT_HELP,
    };
  }

  const executedAt = (deps.now ?? (() => new Date().toISOString()))();
  const reader =
    deps.readFile ?? ((path: string) => readFileSync(resolve(path), "utf8"));
  const writeDiagnostic =
    deps.writeDiagnostic ?? writeExistingMatchIntentPreflightDiagnostic;

  const finish = (report: ExistingMatchIntentPreflightReport) => {
    writeDiagnostic(parsed.outputPath, report);
    return {
      ok: true as const,
      report,
      summary: formatExistingMatchIntentPreflightSummary(report),
    };
  };

  const blocked = (input: {
    reason: string;
    blockers?: ExistingMatchOccurrencePreflightBlocker[];
    intent?: ExistingMatchAppendIntent | null;
    coverage?: ExistingMatchIntentPreflightReport["coverage"];
    eligibility?: ExistingMatchIntentPreflightReport["eligibility"];
    eligibilityReason?: string | null;
    db?: ExistingMatchIntentPreflightReport["db"];
    plans?: ExistingMatchIntentPreflightPlanRow[];
    frozenPlanCount?: number;
    preflight?: ExistingMatchOccurrencePreflightResult | null;
  }) =>
    finish({
      classification: REAL_EXISTING_MATCH_PREFLIGHT_BLOCKED,
      status: "blocked",
      executedAt,
      intentPath: parsed.intentPath,
      intentVersion: input.intent?.metadata.version ?? null,
      intentMode: input.intent?.metadata.mode ?? null,
      intentContentHash: input.intent?.metadata.contentHash ?? null,
      sessionId: input.intent?.metadata.sessionId ?? null,
      frozenPlanCount: input.frozenPlanCount ?? input.intent?.plans.length ?? 0,
      source: input.intent ? sourceFromIntent(input.intent) : emptySource(),
      coverage: input.coverage ?? {
        ok: false,
        sourceHash: null,
        expectedSourceHash: null,
        intentCoverageSourceHash:
          input.intent?.metadata.source.coverageSourceHash ?? null,
      },
      eligibility: input.eligibility ?? "unresolved",
      eligibilityReason: input.eligibilityReason ?? input.reason,
      plansChecked: input.preflight?.plansChecked ?? 0,
      predictedCreates: input.preflight?.predictedCreates ?? 0,
      alreadyPresent: input.preflight?.alreadyPresent ?? 0,
      conflicts: input.preflight?.conflicts ?? 0,
      blockers: input.blockers ?? [{ code: input.reason, detail: input.reason }],
      plans: input.plans ?? [],
      preflightExecuted: Boolean(input.preflight),
      generateStructuredCalls: 0,
      sessionPlanning: 0,
      occurrenceAppend: 0,
      db: input.db ?? { before: emptyCounts(), after: emptyCounts() },
    });

  let intentText: string;
  try {
    intentText = reader(parsed.intentPath);
  } catch (error) {
    return {
      ok: false,
      code: "read",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const loaded = loadExistingMatchAppendIntent(intentText);
  if (!loaded.ok) {
    return blocked({ reason: loaded.code });
  }
  const intent = loaded.intent;
  const plans = intentToExistingMatchPlans(intent);
  const invariant = sessionInvariantError(intent, plans);
  if (invariant) {
    return blocked({
      intent,
      frozenPlanCount: plans.length,
      reason: "session_invariant",
      blockers: [{ code: "session_invariant", detail: invariant }],
    });
  }
  const sourceError = sourceContractError(intent);
  if (sourceError) {
    return blocked({
      intent,
      frozenPlanCount: plans.length,
      reason: "source_integrity",
      blockers: [{ code: "source_integrity", detail: sourceError }],
    });
  }

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
    return blocked({
      intent,
      frozenPlanCount: plans.length,
      reason: expectedHash.code,
      blockers: [{ code: expectedHash.code, detail: expectedHash.detail }],
    });
  }

  const coverage = loadInitialConceptProcessingCoverage({
    candidateReportText: candidateText,
    expectedSourceHash: expectedHash.hash,
  });
  const coverageMeta = {
    ok: coverage.ok,
    sourceHash: coverage.ok ? coverage.coverage.sourceHash : null,
    expectedSourceHash: expectedHash.hash,
    intentCoverageSourceHash: intent.metadata.source.coverageSourceHash,
  };
  if (!coverage.ok) {
    return blocked({
      intent,
      frozenPlanCount: plans.length,
      coverage: coverageMeta,
      reason: coverage.code,
      blockers: [{ code: coverage.code, detail: coverage.detail }],
    });
  }
  if (coverage.coverage.sourceHash !== intent.metadata.source.coverageSourceHash) {
    return blocked({
      intent,
      frozenPlanCount: plans.length,
      coverage: coverageMeta,
      reason: "coverage_source_mismatch",
      blockers: [
        {
          code: "coverage_source_mismatch",
          detail: `${coverage.coverage.sourceHash}!=${intent.metadata.source.coverageSourceHash}`,
        },
      ],
    });
  }

  const db = deps.openDb(deps.dbPath ?? getDbPath());
  const before = snapshotDbCounts(db);
  const eligibility = evaluateIncrementalSessionEligibility({
    sessionId: intent.metadata.sessionId,
    db,
    coverage,
  });
  if (eligibility.status !== "eligible") {
    const after = snapshotDbCounts(db);
    return blocked({
      intent,
      frozenPlanCount: plans.length,
      coverage: coverageMeta,
      eligibility: eligibility.status,
      eligibilityReason: eligibility.reason,
      reason: eligibility.reason,
      blockers: [{ code: eligibility.reason, detail: eligibility.reason }],
      db: { before, after },
    });
  }

  const preflight = runExistingMatchOccurrencePreflight(plans, { db });
  const after = snapshotDbCounts(db);
  const planRows: ExistingMatchIntentPreflightPlanRow[] = plans.map((plan) => {
    const diagnostic = preflight.diagnostics.find(
      (item) => item.candidateRef === plan.candidateRef,
    );
    return {
      candidateRef: plan.candidateRef,
      conceptId: plan.conceptId,
      evidenceRef: plan.provenance.evidenceRef,
      matchReason: plan.matchReason,
      classification: diagnostic?.classification ?? null,
      code: diagnostic?.code ?? null,
    };
  });

  const classification =
    preflight.status === "ready"
      ? REAL_EXISTING_MATCH_PREFLIGHT_READY
      : preflight.status === "no_op"
        ? REAL_EXISTING_MATCH_PREFLIGHT_NO_OP
        : REAL_EXISTING_MATCH_PREFLIGHT_BLOCKED;

  return finish({
    classification,
    status: preflight.status,
    executedAt,
    intentPath: parsed.intentPath,
    intentVersion: intent.metadata.version,
    intentMode: intent.metadata.mode,
    intentContentHash: intent.metadata.contentHash,
    sessionId: intent.metadata.sessionId,
    frozenPlanCount: plans.length,
    source: sourceFromIntent(intent),
    coverage: coverageMeta,
    eligibility: "eligible",
    eligibilityReason: null,
    plansChecked: preflight.plansChecked,
    predictedCreates: preflight.predictedCreates,
    alreadyPresent: preflight.alreadyPresent,
    conflicts: preflight.conflicts,
    blockers: preflight.blockers,
    plans: planRows,
    preflightExecuted: true,
    generateStructuredCalls: 0,
    sessionPlanning: 0,
    occurrenceAppend: 0,
    db: { before, after },
  });
}

export { CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_DEFAULT_PATH };
