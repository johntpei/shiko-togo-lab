import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import { atomicWriteJsonFile } from "@/lib/concepts/admission/apply-result";
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
import { concepts, messages, sessions } from "@/lib/db/schema";
import {
  intentToExistingMatchPlans,
  loadExistingMatchAppendIntent,
  type ExistingMatchAppendIntent,
} from "./append-intent";
import { applyExistingMatchOccurrencesThenReconcile } from "./existing-append-lifecycle";
import {
  evaluateIncrementalSessionEligibility,
  loadInitialConceptProcessingCoverage,
} from "./eligibility";
import { sourceCandidateReportHashFromManifestText } from "./pilot-preflight";
import {
  runExistingMatchOccurrencePreflight,
  type ExistingMatchOccurrencePreflightResult,
} from "./preflight";
import type { ExistingMatchPlan } from "./plan";
import { findExistingMatchOccurrenceByIdentity } from "./validate";
import {
  afterConceptOccurrenceSessionsCommitted,
  type ObservationConceptRelationLifecycleResult,
  type ObservationConceptRelationReconcileFn,
} from "@/lib/observations/observation-concept-relation-lifecycle";

export const CONCEPT_INCREMENTAL_EXISTING_APPEND_DEFAULT_RESULT =
  "data/concept-incremental-existing-append-result-v1.json";

export const CONCEPT_INCREMENTAL_EXISTING_APPEND_RESULT_VERSION =
  "concept-incremental-existing-append-result-v1";

export const CONCEPT_INCREMENTAL_EXISTING_APPEND_HELP = `Usage:
  npm run concept:incremental-existing-append -- --intent <path> [--candidates <path>] [--manifest <path>] [--output <path>]
    Preview. Fresh Intent / Coverage / Eligibility / Occurrence preflight. DB write = 0.

  npm run concept:incremental-existing-append -- --intent <path> --apply [--output <path>]
    Explicit Existing-Match Occurrence append. Saved preflight READY is not authorization.
`;

export const REAL_EXISTING_MATCH_APPEND_PREVIEW =
  "REAL_EXISTING_MATCH_APPEND_PREVIEW";
export const REAL_EXISTING_MATCH_APPENDED = "REAL_EXISTING_MATCH_APPENDED";
export const REAL_EXISTING_MATCH_ALREADY_PRESENT =
  "REAL_EXISTING_MATCH_ALREADY_PRESENT";
export const REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK =
  "REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK";
export const REAL_EXISTING_MATCH_APPENDED_VERIFICATION_FAILED =
  "REAL_EXISTING_MATCH_APPENDED_VERIFICATION_FAILED";
export const REAL_EXISTING_MATCH_APPENDED_REPORT_FAILED =
  "REAL_EXISTING_MATCH_APPENDED_REPORT_FAILED";

export type ExistingMatchAppendClassification =
  | typeof REAL_EXISTING_MATCH_APPEND_PREVIEW
  | typeof REAL_EXISTING_MATCH_APPENDED
  | typeof REAL_EXISTING_MATCH_ALREADY_PRESENT
  | typeof REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK
  | typeof REAL_EXISTING_MATCH_APPENDED_VERIFICATION_FAILED
  | typeof REAL_EXISTING_MATCH_APPENDED_REPORT_FAILED;

export type ExistingMatchAppendArgs = {
  apply: boolean;
  malformed: boolean;
  malformedReason: string | null;
  intentPath: string | null;
  candidatesPath: string;
  manifestPath: string;
  outputPath: string;
};

export type ExistingMatchAppendDbCounts = {
  concepts: number;
  conceptAliases: number;
  conceptOccurrences: number;
  sessions: number;
  messages: number;
};

export type ExistingMatchAppendResult = {
  version: typeof CONCEPT_INCREMENTAL_EXISTING_APPEND_RESULT_VERSION;
  mode: "existing_match_append";
  classification: ExistingMatchAppendClassification;
  intentPath: string | null;
  intentVersion: string | null;
  intentMode: string | null;
  intentContentHash: string | null;
  sessionId: string | null;
  appliedAt: string;
  applyRequested: boolean;
  transactionStarted: boolean;
  transactionCommitted: boolean;
  plansChecked: number;
  occurrencesCreated: number;
  alreadyPresent: number;
  conflicts: number;
  postWriteVerified: boolean;
  postWriteErrors: Array<{ code: string; detail: string }>;
  conceptIds: string[];
  evidenceRefs: string[];
  occurredAtValues: string[];
  versions: {
    promptVersion: string | null;
    extractionVersion: string | null;
  };
  preflight: {
    status: ExistingMatchOccurrencePreflightResult["status"] | null;
    predictedCreates: number;
    alreadyPresent: number;
    conflicts: number;
    blockers: Array<{ code: string; detail: string }>;
  };
  db: {
    before: ExistingMatchAppendDbCounts;
    after: ExistingMatchAppendDbCounts;
  };
  generateStructuredCalls: 0;
  sessionPlanning: 0;
  assessment: 0;
  relationReconciliation?: ObservationConceptRelationLifecycleResult;
};

export type ExistingMatchAppendDeps = {
  openDb: (dbPath: string) => ConceptQueryDb;
  dbPath?: string;
  readFile?: (path: string) => string;
  writeResult?: (path: string, payload: ExistingMatchAppendResult) => void;
  afterPreflight?: (db: ConceptQueryDb) => void;
  now?: () => string;
  reconcileRelations?: ObservationConceptRelationReconcileFn;
};

function emptyCounts(): ExistingMatchAppendDbCounts {
  return {
    concepts: 0,
    conceptAliases: 0,
    conceptOccurrences: 0,
    sessions: 0,
    messages: 0,
  };
}

function snapshotDbCounts(db: ConceptQueryDb): ExistingMatchAppendDbCounts {
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

export function parseConceptIncrementalExistingAppendArgs(
  argv: string[],
): ExistingMatchAppendArgs {
  let apply = false;
  let malformed = false;
  let malformedReason: string | null = null;
  const intentPaths: string[] = [];
  let candidatesPath = CONCEPT_APPLY_DEFAULT_CANDIDATES;
  let manifestPath = CONCEPT_APPLY_DEFAULT_MANIFEST;
  let outputPath = CONCEPT_INCREMENTAL_EXISTING_APPEND_DEFAULT_RESULT;

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
  if (!malformed && intentPaths.length === 0) {
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

export function writeExistingMatchAppendResultFile(
  path: string,
  payload: ExistingMatchAppendResult,
) {
  atomicWriteJsonFile(path, payload);
}

export function formatExistingMatchAppendSummary(result: ExistingMatchAppendResult) {
  const lines = [
    result.classification,
    `applyRequested: ${result.applyRequested}`,
    `intentPath: ${result.intentPath ?? "(none)"}`,
    `intentContentHash: ${result.intentContentHash ?? "(none)"}`,
    `sessionId: ${result.sessionId ?? "(none)"}`,
    `transactionStarted: ${result.transactionStarted} transactionCommitted: ${result.transactionCommitted}`,
    `plansChecked: ${result.plansChecked} occurrencesCreated: ${result.occurrencesCreated} alreadyPresent: ${result.alreadyPresent} conflicts: ${result.conflicts}`,
    `preflight: ${result.preflight.status ?? "null"} predictedCreates=${result.preflight.predictedCreates}`,
    `postWriteVerified: ${result.postWriteVerified}`,
    `concepts: ${result.db.before.concepts} → ${result.db.after.concepts}`,
    `aliases: ${result.db.before.conceptAliases} → ${result.db.after.conceptAliases}`,
    `occurrences: ${result.db.before.conceptOccurrences} → ${result.db.after.conceptOccurrences}`,
  ];
  if (result.preflight.blockers.length > 0) {
    for (const blocker of result.preflight.blockers) {
      lines.push(`blocker: ${blocker.code}`);
    }
  }
  lines.push("LLM / Planning / Assessment / Policy were not run.");
  return lines.join("\n");
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

function sessionInvariantError(
  intent: ExistingMatchAppendIntent,
  plans: ExistingMatchPlan[],
) {
  for (const plan of plans) {
    if (plan.provenance.sessionId !== intent.metadata.sessionId) {
      return `session_invariant:${plan.provenance.sessionId}!=${intent.metadata.sessionId}`;
    }
  }
  return null;
}

export function verifyAppliedExistingMatchPlans(
  plans: ExistingMatchPlan[],
  db: ConceptQueryDb,
): { ok: true } | { ok: false; errors: Array<{ code: string; detail: string }> } {
  const errors: Array<{ code: string; detail: string }> = [];
  for (const plan of plans) {
    const concept = db
      .select()
      .from(concepts)
      .where(eq(concepts.id, plan.conceptId))
      .get();
    if (!concept) {
      errors.push({ code: "missing_concept", detail: plan.conceptId });
      continue;
    }
    if (concept.canonicalLabel !== plan.canonicalLabel) {
      errors.push({
        code: "canonical_label_changed",
        detail: plan.conceptId,
      });
    }
    if (concept.normalizedKey !== plan.normalizedKey) {
      errors.push({
        code: "normalized_key_changed",
        detail: plan.conceptId,
      });
    }
    const row = findExistingMatchOccurrenceByIdentity(db, plan);
    if (!row) {
      errors.push({
        code: "occurrence_missing",
        detail: plan.candidateRef,
      });
      continue;
    }
    const provenance = plan.provenance;
    if (row.sessionId !== provenance.sessionId) {
      errors.push({ code: "session_mismatch", detail: plan.candidateRef });
    }
    if (row.messageId !== provenance.messageId) {
      errors.push({ code: "message_mismatch", detail: plan.candidateRef });
    }
    if (row.evidenceRef !== provenance.evidenceRef) {
      errors.push({ code: "evidence_ref_mismatch", detail: plan.candidateRef });
    }
    if (row.occurredAt !== provenance.occurredAt) {
      errors.push({ code: "occurred_at_mismatch", detail: plan.candidateRef });
    }
    if (row.sourceRole !== "user") {
      errors.push({ code: "source_role_mismatch", detail: plan.candidateRef });
    }
    if (row.sourceType !== "evidence_unit") {
      errors.push({ code: "source_type_mismatch", detail: plan.candidateRef });
    }
    if (row.extractionVersion !== provenance.extractionVersion) {
      errors.push({
        code: "extraction_version_mismatch",
        detail: plan.candidateRef,
      });
    }
    if (row.conceptId !== plan.conceptId) {
      errors.push({ code: "concept_id_mismatch", detail: plan.candidateRef });
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export async function runConceptIncrementalExistingAppend(
  argv: string[],
  deps: ExistingMatchAppendDeps,
): Promise<
  | { ok: true; result: ExistingMatchAppendResult; summary: string }
  | { ok: false; code: string; error: string }
> {
  const parsed = parseConceptIncrementalExistingAppendArgs(argv);
  if (parsed.malformed || !parsed.intentPath) {
    return {
      ok: false,
      code: parsed.malformedReason ?? "malformed",
      error: CONCEPT_INCREMENTAL_EXISTING_APPEND_HELP,
    };
  }

  const appliedAt = (deps.now ?? (() => new Date().toISOString()))();
  const reader =
    deps.readFile ?? ((path: string) => readFileSync(resolve(path), "utf8"));
  const writeResult =
    deps.writeResult ?? writeExistingMatchAppendResultFile;

  const finish = (result: ExistingMatchAppendResult) => {
    writeResult(parsed.outputPath, result);
    return {
      ok: true as const,
      result,
      summary: formatExistingMatchAppendSummary(result),
    };
  };

  const base = (input: Partial<ExistingMatchAppendResult> & {
    classification: ExistingMatchAppendClassification;
  }): ExistingMatchAppendResult => ({
    version: CONCEPT_INCREMENTAL_EXISTING_APPEND_RESULT_VERSION,
    mode: "existing_match_append",
    classification: input.classification,
    intentPath: parsed.intentPath,
    intentVersion: input.intentVersion ?? null,
    intentMode: input.intentMode ?? null,
    intentContentHash: input.intentContentHash ?? null,
    sessionId: input.sessionId ?? null,
    appliedAt,
    applyRequested: parsed.apply,
    transactionStarted: input.transactionStarted ?? false,
    transactionCommitted: input.transactionCommitted ?? false,
    plansChecked: input.plansChecked ?? 0,
    occurrencesCreated: input.occurrencesCreated ?? 0,
    alreadyPresent: input.alreadyPresent ?? 0,
    conflicts: input.conflicts ?? 0,
    postWriteVerified: input.postWriteVerified ?? false,
    postWriteErrors: input.postWriteErrors ?? [],
    conceptIds: input.conceptIds ?? [],
    evidenceRefs: input.evidenceRefs ?? [],
    occurredAtValues: input.occurredAtValues ?? [],
    versions: input.versions ?? { promptVersion: null, extractionVersion: null },
    preflight: input.preflight ?? {
      status: null,
      predictedCreates: 0,
      alreadyPresent: 0,
      conflicts: 0,
      blockers: [],
    },
    db: input.db ?? { before: emptyCounts(), after: emptyCounts() },
    generateStructuredCalls: 0,
    sessionPlanning: 0,
    assessment: 0,
    relationReconciliation: input.relationReconciliation,
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
    return finish(
      base({
        classification: parsed.apply
          ? REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK
          : REAL_EXISTING_MATCH_APPEND_PREVIEW,
        preflight: {
          status: null,
          predictedCreates: 0,
          alreadyPresent: 0,
          conflicts: 0,
          blockers: [{ code: loaded.code, detail: loaded.detail }],
        },
      }),
    );
  }

  const intent = loaded.intent;
  const plans = intentToExistingMatchPlans(intent);
  const planMeta = {
    intentVersion: intent.metadata.version,
    intentMode: intent.metadata.mode,
    intentContentHash: intent.metadata.contentHash,
    sessionId: intent.metadata.sessionId,
    conceptIds: plans.map((plan) => plan.conceptId),
    evidenceRefs: plans.map((plan) => plan.provenance.evidenceRef),
    occurredAtValues: plans.map((plan) => plan.provenance.occurredAt),
    versions: {
      promptVersion: intent.metadata.source.promptVersion,
      extractionVersion: intent.metadata.source.extractionVersion,
    },
    plansChecked: plans.length,
  };

  const invariant = sessionInvariantError(intent, plans);
  if (invariant) {
    return finish(
      base({
        ...planMeta,
        classification: parsed.apply
          ? REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK
          : REAL_EXISTING_MATCH_APPEND_PREVIEW,
        preflight: {
          status: null,
          predictedCreates: 0,
          alreadyPresent: 0,
          conflicts: 0,
          blockers: [{ code: "session_invariant", detail: invariant }],
        },
      }),
    );
  }
  const sourceError = sourceContractError(intent);
  if (sourceError) {
    return finish(
      base({
        ...planMeta,
        classification: parsed.apply
          ? REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK
          : REAL_EXISTING_MATCH_APPEND_PREVIEW,
        preflight: {
          status: null,
          predictedCreates: 0,
          alreadyPresent: 0,
          conflicts: 0,
          blockers: [{ code: "source_integrity", detail: sourceError }],
        },
      }),
    );
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
    return finish(
      base({
        ...planMeta,
        classification: parsed.apply
          ? REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK
          : REAL_EXISTING_MATCH_APPEND_PREVIEW,
        preflight: {
          status: null,
          predictedCreates: 0,
          alreadyPresent: 0,
          conflicts: 0,
          blockers: [{ code: expectedHash.code, detail: expectedHash.detail }],
        },
      }),
    );
  }

  const coverage = loadInitialConceptProcessingCoverage({
    candidateReportText: candidateText,
    expectedSourceHash: expectedHash.hash,
  });
  if (!coverage.ok) {
    return finish(
      base({
        ...planMeta,
        classification: parsed.apply
          ? REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK
          : REAL_EXISTING_MATCH_APPEND_PREVIEW,
        preflight: {
          status: null,
          predictedCreates: 0,
          alreadyPresent: 0,
          conflicts: 0,
          blockers: [{ code: coverage.code, detail: coverage.detail }],
        },
      }),
    );
  }
  if (coverage.coverage.sourceHash !== intent.metadata.source.coverageSourceHash) {
    return finish(
      base({
        ...planMeta,
        classification: parsed.apply
          ? REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK
          : REAL_EXISTING_MATCH_APPEND_PREVIEW,
        preflight: {
          status: null,
          predictedCreates: 0,
          alreadyPresent: 0,
          conflicts: 0,
          blockers: [
            {
              code: "coverage_source_mismatch",
              detail: `${coverage.coverage.sourceHash}!=${intent.metadata.source.coverageSourceHash}`,
            },
          ],
        },
      }),
    );
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
    return finish(
      base({
        ...planMeta,
        classification: parsed.apply
          ? REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK
          : REAL_EXISTING_MATCH_APPEND_PREVIEW,
        db: { before, after },
        preflight: {
          status: null,
          predictedCreates: 0,
          alreadyPresent: 0,
          conflicts: 0,
          blockers: [{ code: eligibility.reason, detail: eligibility.reason }],
        },
      }),
    );
  }

  const preflight = runExistingMatchOccurrencePreflight(plans, { db });
  const preflightBlockers = preflight.blockers.map((item) => ({
    code: item.code,
    detail: item.detail,
  }));

  if (!parsed.apply) {
    const after = snapshotDbCounts(db);
    return finish(
      base({
        ...planMeta,
        classification: REAL_EXISTING_MATCH_APPEND_PREVIEW,
        db: { before, after },
        preflight: {
          status: preflight.status,
          predictedCreates: preflight.predictedCreates,
          alreadyPresent: preflight.alreadyPresent,
          conflicts: preflight.conflicts,
          blockers: preflightBlockers,
        },
      }),
    );
  }

  if (preflight.status === "blocked") {
    const after = snapshotDbCounts(db);
    return finish(
      base({
        ...planMeta,
        classification: REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK,
        db: { before, after },
        preflight: {
          status: preflight.status,
          predictedCreates: preflight.predictedCreates,
          alreadyPresent: preflight.alreadyPresent,
          conflicts: preflight.conflicts,
          blockers: preflightBlockers,
        },
      }),
    );
  }

  if (preflight.status === "no_op") {
    const after = snapshotDbCounts(db);
    return finish(
      base({
        ...planMeta,
        classification: REAL_EXISTING_MATCH_ALREADY_PRESENT,
        alreadyPresent: preflight.alreadyPresent,
        postWriteVerified: true,
        relationReconciliation: afterConceptOccurrenceSessionsCommitted(
          { sessionIds: plans.map((plan) => plan.provenance.sessionId) },
          { db, reconcile: deps.reconcileRelations },
        ),
        db: { before, after },
        preflight: {
          status: preflight.status,
          predictedCreates: preflight.predictedCreates,
          alreadyPresent: preflight.alreadyPresent,
          conflicts: preflight.conflicts,
          blockers: [],
        },
      }),
    );
  }

  deps.afterPreflight?.(db);
  const lifecycle = applyExistingMatchOccurrencesThenReconcile(plans, {
    db,
    reconcile: deps.reconcileRelations,
  });
  const applied = lifecycle.primary;
  const afterApply = snapshotDbCounts(db);

  if (!applied.ok) {
    return finish(
      base({
        ...planMeta,
        classification: REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK,
        transactionStarted: true,
        transactionCommitted: false,
        conflicts: applied.conflicts,
        db: { before, after: afterApply },
        preflight: {
          status: preflight.status,
          predictedCreates: preflight.predictedCreates,
          alreadyPresent: preflight.alreadyPresent,
          conflicts: preflight.conflicts,
          blockers: [{ code: applied.code, detail: applied.detail }],
        },
      }),
    );
  }

  const verified = verifyAppliedExistingMatchPlans(plans, db);
  const after = snapshotDbCounts(db);
  const extraVerify = [...(verified.ok ? [] : verified.errors)];
  if (before.concepts !== after.concepts) {
    extraVerify.push({ code: "concept_count_changed", detail: "concepts" });
  }
  if (before.conceptAliases !== after.conceptAliases) {
    extraVerify.push({ code: "alias_count_changed", detail: "aliases" });
  }
  const postWriteVerified = extraVerify.length === 0;

  const classification = !postWriteVerified
    ? REAL_EXISTING_MATCH_APPENDED_VERIFICATION_FAILED
    : applied.occurrencesCreated >= 1
      ? REAL_EXISTING_MATCH_APPENDED
      : REAL_EXISTING_MATCH_ALREADY_PRESENT;

  const result = base({
    ...planMeta,
    classification,
    transactionStarted: true,
    transactionCommitted: true,
    occurrencesCreated: applied.occurrencesCreated,
    alreadyPresent: applied.alreadyPresent,
    conflicts: 0,
    postWriteVerified,
    postWriteErrors: extraVerify,
    relationReconciliation: lifecycle.relationReconciliation,
    db: { before, after },
    preflight: {
      status: preflight.status,
      predictedCreates: preflight.predictedCreates,
      alreadyPresent: preflight.alreadyPresent,
      conflicts: preflight.conflicts,
      blockers: [],
    },
  });

  try {
    writeResult(parsed.outputPath, result);
  } catch (error) {
    const failed: ExistingMatchAppendResult = {
      ...result,
      classification: REAL_EXISTING_MATCH_APPENDED_REPORT_FAILED,
    };
    return {
      ok: true,
      result: failed,
      summary: `${formatExistingMatchAppendSummary(failed)}\nresultWriteError: ${
        error instanceof Error ? error.message : String(error)
      }\nDB commit済み. Do not --apply again.`,
    };
  }

  return {
    ok: true,
    result,
    summary: formatExistingMatchAppendSummary(result),
  };
}
