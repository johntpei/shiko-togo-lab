import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import {
  CONCEPT_APPLY_DEFAULT_ASSESSMENT,
  CONCEPT_APPLY_DEFAULT_CANDIDATES,
  CONCEPT_APPLY_DEFAULT_MANIFEST,
  CONCEPT_APPLY_DEFAULT_RESULT,
  type ConceptAdmissionApplyManifest,
} from "./apply-manifest";
import { runApplyPreflight, type ApplyPreflightResult } from "./apply-preflight";
import {
  applyInitialAdmissionManifest,
  readRegistryCounts,
  type ApplyDb,
  type InitialApplyResult,
} from "./apply-transaction";
import {
  assertResultPathWritable,
  atomicWriteJsonFile,
  buildApplyResult,
  verifyAppliedRegistry,
  type ConceptAdmissionApplyResult,
} from "./apply-result";

export const CONCEPT_APPLY_WRITE_REQUIRES_FLAG =
  "explicit --apply is required to write the Concept Registry";

export const CONCEPT_ADMISSION_APPLY_WRITE_HELP = `Usage:
  npm run concept:admission-apply -- [--candidates <path>] [--assessment <path>] [--manifest <path>]
    Dry-run. Builds and previews an Apply Manifest. Registry write = 0.

  npm run concept:admission-apply -- --manifest <path> --apply [--result <path>]
    Explicit Initial Apply. Re-runs critical checks against current artifacts/DB,
    then writes in one transaction. Do not omit --apply.
`;

export type ConceptAdmissionApplyWriteArgs = {
  apply: boolean;
  malformed: string | null;
  candidatesPath: string;
  assessmentPath: string;
  manifestPath: string;
  resultPath: string;
};

export type ReadyForApply = {
  readyForApply: true;
  manifestContentHash: string;
  conceptsToCreate: number;
  occurrencesToCreate: number;
  aliasesToCreate: 0;
};

export type ConceptAdmissionApplyWriteDeps = {
  db: ApplyDb;
  dbPath: string;
  readFile?: (path: string) => string;
  writeResult?: (path: string, payload: ConceptAdmissionApplyResult) => void;
  assertResultWritable?: (path: string) => void;
  applyManifest?: typeof applyInitialAdmissionManifest;
  now?: () => string;
};

export type ConceptAdmissionApplyWriteOutcome =
  | {
      ok: true;
      verdict: "APPLIED";
      transactionCommitted: true;
      reportWritten: true;
      reportPath: string;
      report: ConceptAdmissionApplyResult;
      readyForApply: ReadyForApply;
      preflight: ApplyPreflightResult;
      summary: string;
    }
  | {
      ok: false;
      verdict: "APPLIED_REPORT_FAILED";
      transactionCommitted: true;
      reportWritten: false;
      reportPath: string;
      reportError: string;
      report: ConceptAdmissionApplyResult;
      readyForApply: ReadyForApply;
      preflight: ApplyPreflightResult;
      summary: string;
    }
  | {
      ok: false;
      verdict: "APPLY_FAILED_ROLLED_BACK";
      transactionCommitted: false;
      code: string;
      error: string;
      registryCounts: ReturnType<typeof readRegistryCounts>;
      summary: string;
    }
  | {
      ok: false;
      verdict: "PREWRITE_BLOCKED";
      transactionCommitted: false;
      code: string;
      error: string;
      blockers?: ApplyPreflightResult["blockers"];
      registryCounts: ReturnType<typeof readRegistryCounts>;
      summary: string;
    };

const VALUE_FLAGS = new Set([
  "--candidates",
  "--assessment",
  "--manifest",
  "--result",
]);

export function parseConceptAdmissionApplyWriteArgs(
  argv: string[],
): ConceptAdmissionApplyWriteArgs {
  let apply = false;
  let malformed: string | null = null;
  let candidatesPath = CONCEPT_APPLY_DEFAULT_CANDIDATES;
  let assessmentPath = CONCEPT_APPLY_DEFAULT_ASSESSMENT;
  let manifestPath = CONCEPT_APPLY_DEFAULT_MANIFEST;
  let resultPath = CONCEPT_APPLY_DEFAULT_RESULT;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        malformed = `missing_value:${arg}`;
        continue;
      }
      i += 1;
      if (arg === "--candidates") {
        candidatesPath = value;
      } else if (arg === "--assessment") {
        assessmentPath = value;
      } else if (arg === "--manifest") {
        manifestPath = value;
      } else {
        resultPath = value;
      }
      continue;
    }
    if (!malformed) {
      malformed = arg.startsWith("--")
        ? `unknown_option:${arg}`
        : `unexpected_arg:${arg}`;
    }
  }

  return {
    apply,
    malformed,
    candidatesPath,
    assessmentPath,
    manifestPath,
    resultPath,
  };
}

export function openWritableApplyDb(dbPath: string): ApplyDb {
  const sqlite = new Database(dbPath, { fileMustExist: true });
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function defaultReadFile(path: string) {
  return readFileSync(resolve(path), "utf8");
}

function formatWriteSummary(input: {
  verdict: ConceptAdmissionApplyWriteOutcome["verdict"];
  transactionCommitted: boolean;
  reportWritten?: boolean;
  reportPath?: string;
  report?: ConceptAdmissionApplyResult;
  readyForApply?: ReadyForApply;
  error?: string;
}): string {
  const lines = [
    "Concept admission apply (initial)",
    `verdict: ${input.verdict}`,
    `transactionCommitted: ${input.transactionCommitted}`,
  ];
  if (input.readyForApply) {
    lines.push(
      `readyForApply: true`,
      `manifestContentHash: ${input.readyForApply.manifestContentHash}`,
      `predicted: concepts ${input.readyForApply.conceptsToCreate} / occurrences ${input.readyForApply.occurrencesToCreate} / aliases ${input.readyForApply.aliasesToCreate}`,
    );
  }
  if (input.report) {
    lines.push(
      `conceptsCreated: ${input.report.conceptsCreated}`,
      `occurrencesCreated: ${input.report.occurrencesCreated}`,
      `aliasesCreated: ${input.report.aliasesCreated}`,
      `skipped: ${input.report.skipped}`,
      `conflicts: ${input.report.conflicts}`,
      `mapping: ${Object.keys(input.report.candidateConceptMap).length}`,
      `postWriteVerification: ${input.report.postWriteVerification.ok}`,
      `registry: concepts ${input.report.registryCounts.concepts} / aliases ${input.report.registryCounts.aliases} / occurrences ${input.report.registryCounts.occurrences}`,
    );
  }
  if (input.reportPath) {
    lines.push(`result report: ${input.reportPath}`);
  }
  if (input.reportWritten === false) {
    lines.push("DB commit済み / report write failed. Do not --apply again.");
  }
  if (input.error) {
    lines.push(`error: ${input.error}`);
  }
  return lines.join("\n");
}

function blocked(
  code: string,
  error: string,
  db: ApplyDb,
  blockers?: ApplyPreflightResult["blockers"],
): ConceptAdmissionApplyWriteOutcome {
  const registryCounts = readRegistryCounts(db);
  return {
    ok: false,
    verdict: "PREWRITE_BLOCKED",
    transactionCommitted: false,
    code,
    error,
    blockers,
    registryCounts,
    summary: formatWriteSummary({
      verdict: "PREWRITE_BLOCKED",
      transactionCommitted: false,
      error,
    }),
  };
}

function rolledBack(
  applied: InitialApplyResult & { ok: false },
): ConceptAdmissionApplyWriteOutcome {
  const error = `${applied.code}:${applied.detail}`;
  return {
    ok: false,
    verdict: "APPLY_FAILED_ROLLED_BACK",
    transactionCommitted: false,
    code: applied.code,
    error,
    registryCounts: applied.registryCounts,
    summary: formatWriteSummary({
      verdict: "APPLY_FAILED_ROLLED_BACK",
      transactionCommitted: false,
      error,
    }),
  };
}

export function runConceptAdmissionApplyWrite(
  argv: string[],
  deps: ConceptAdmissionApplyWriteDeps,
): ConceptAdmissionApplyWriteOutcome {
  const parsed = parseConceptAdmissionApplyWriteArgs(argv);
  if (parsed.malformed) {
    return blocked("malformed", parsed.malformed, deps.db);
  }
  if (!parsed.apply) {
    return blocked("missing_apply", CONCEPT_APPLY_WRITE_REQUIRES_FLAG, deps.db);
  }

  const reader = deps.readFile ?? defaultReadFile;
  let candidateText: string;
  let assessmentText: string;
  let manifestText: string;
  try {
    candidateText = reader(parsed.candidatesPath);
    assessmentText = reader(parsed.assessmentPath);
    manifestText = reader(parsed.manifestPath);
  } catch (error) {
    return blocked(
      "read",
      error instanceof Error ? error.message : String(error),
      deps.db,
    );
  }

  let manifest: ConceptAdmissionApplyManifest;
  try {
    manifest = JSON.parse(manifestText) as ConceptAdmissionApplyManifest;
  } catch (error) {
    return blocked(
      "parse",
      error instanceof Error ? error.message : String(error),
      deps.db,
    );
  }

  const checkWritable = deps.assertResultWritable ?? assertResultPathWritable;
  try {
    checkWritable(parsed.resultPath);
  } catch (error) {
    return blocked(
      "result_path_not_writable",
      error instanceof Error ? error.message : String(error),
      deps.db,
    );
  }

  const preflight = runApplyPreflight({
    db: deps.db,
    dbPath: deps.dbPath,
    manifestPath: parsed.manifestPath,
    candidateReportPath: parsed.candidatesPath,
    assessmentReportPath: parsed.assessmentPath,
    candidateReportText: candidateText,
    assessmentReportText: assessmentText,
    manifest,
    now: deps.now,
  });

  if (preflight.status !== "ready") {
    const detail = preflight.blockers
      .map((item) => `${item.code}:${item.detail}`)
      .join("; ");
    return blocked(
      "preflight_blocked",
      detail || "status=blocked",
      deps.db,
      preflight.blockers,
    );
  }

  const readyForApply: ReadyForApply = {
    readyForApply: true,
    manifestContentHash: preflight.manifestContentHash,
    conceptsToCreate: preflight.predictedWrites.concepts,
    occurrencesToCreate: preflight.predictedWrites.occurrences,
    aliasesToCreate: 0,
  };

  const apply = deps.applyManifest ?? applyInitialAdmissionManifest;
  const applied = apply(manifest, { db: deps.db, now: deps.now });
  if (!applied.ok) {
    return rolledBack(applied);
  }

  const verification = verifyAppliedRegistry(manifest, applied.mapping, deps.db);
  const report = buildApplyResult({
    manifest,
    appliedAt: applied.appliedAt,
    transactionCommitted: true,
    conceptsCreated: applied.conceptsCreated,
    occurrencesCreated: applied.occurrencesCreated,
    skipped: 0,
    conflicts: 0,
    mapping: applied.mapping,
    verification,
    registryCounts: {
      concepts: applied.registryCounts.concepts,
      aliases: applied.registryCounts.conceptAliases,
      occurrences: applied.registryCounts.conceptOccurrences,
    },
  });

  const writer = deps.writeResult ?? atomicWriteJsonFile;
  try {
    writer(parsed.resultPath, report);
  } catch (error) {
    const reportError = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      verdict: "APPLIED_REPORT_FAILED",
      transactionCommitted: true,
      reportWritten: false,
      reportPath: parsed.resultPath,
      reportError,
      report,
      readyForApply,
      preflight,
      summary: formatWriteSummary({
        verdict: "APPLIED_REPORT_FAILED",
        transactionCommitted: true,
        reportWritten: false,
        reportPath: parsed.resultPath,
        report,
        readyForApply,
        error: reportError,
      }),
    };
  }

  return {
    ok: true,
    verdict: "APPLIED",
    transactionCommitted: true,
    reportWritten: true,
    reportPath: parsed.resultPath,
    report,
    readyForApply,
    preflight,
    summary: formatWriteSummary({
      verdict: "APPLIED",
      transactionCommitted: true,
      reportWritten: true,
      reportPath: parsed.resultPath,
      report,
      readyForApply,
    }),
  };
}
