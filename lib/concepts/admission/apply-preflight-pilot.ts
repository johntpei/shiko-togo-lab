import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getDbPath } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import {
  CONCEPT_APPLY_APPLY_ERROR,
  CONCEPT_APPLY_DEFAULT_ASSESSMENT,
  CONCEPT_APPLY_DEFAULT_CANDIDATES,
  CONCEPT_APPLY_DEFAULT_MANIFEST,
  type ConceptAdmissionApplyManifest,
} from "./apply-manifest";
import {
  CONCEPT_APPLY_DEFAULT_PREFLIGHT_REPORT,
  applyPreflightReportPayload,
  formatApplyPreflightSummary,
  runApplyPreflight,
  type ApplyPreflightDb,
  type ApplyPreflightResult,
} from "./apply-preflight";

export {
  CONCEPT_APPLY_APPLY_ERROR,
  CONCEPT_APPLY_DEFAULT_ASSESSMENT,
  CONCEPT_APPLY_DEFAULT_CANDIDATES,
  CONCEPT_APPLY_DEFAULT_MANIFEST,
};

export const CONCEPT_ADMISSION_PREFLIGHT_HELP = `Usage:
  npm run concept:admission-preflight -- [--candidates <path>] [--assessment <path>] [--manifest <path>] [--output <path>]

Read-only preflight against real SQLite. Does not INSERT / UPDATE / DELETE.
--apply is not accepted here. Use concept:admission-apply -- --apply.
`;

export type ConceptAdmissionPreflightArgs = {
  apply: boolean;
  candidatesPath: string;
  assessmentPath: string;
  manifestPath: string;
  outputPath: string;
};

export type ConceptAdmissionPreflightDeps = {
  openDb: (dbPath: string) => ApplyPreflightDb;
  dbPath?: string;
  readFile?: (path: string) => string;
  writeReport?: (path: string, payload: unknown) => void;
  now?: () => string;
};

export function parseConceptAdmissionPreflightArgs(
  argv: string[],
): ConceptAdmissionPreflightArgs {
  let apply = false;
  let candidatesPath = CONCEPT_APPLY_DEFAULT_CANDIDATES;
  let assessmentPath = CONCEPT_APPLY_DEFAULT_ASSESSMENT;
  let manifestPath = CONCEPT_APPLY_DEFAULT_MANIFEST;
  let outputPath = CONCEPT_APPLY_DEFAULT_PREFLIGHT_REPORT;
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
    if (arg === "--assessment") {
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        assessmentPath = value;
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
  return { apply, candidatesPath, assessmentPath, manifestPath, outputPath };
}

export function openReadonlyApplyDb(dbPath: string): ApplyPreflightDb {
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  sqlite.pragma("query_only = ON");
  return drizzle(sqlite, { schema });
}

export function writeApplyPreflightReportFile(path: string, payload: unknown) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function runConceptAdmissionPreflight(
  argv: string[],
  deps: ConceptAdmissionPreflightDeps,
):
  | { ok: true; result: ApplyPreflightResult; summary: string }
  | { ok: false; code: string; error: string } {
  const parsed = parseConceptAdmissionPreflightArgs(argv);
  if (parsed.apply) {
    return { ok: false, code: "apply", error: CONCEPT_APPLY_APPLY_ERROR };
  }

  const reader = deps.readFile ?? ((path: string) => readFileSync(resolve(path), "utf8"));
  const dbPath = deps.dbPath ?? getDbPath();
  let candidateText: string;
  let assessmentText: string;
  let manifestText: string;
  try {
    candidateText = reader(parsed.candidatesPath);
    assessmentText = reader(parsed.assessmentPath);
    manifestText = reader(parsed.manifestPath);
  } catch (error) {
    return {
      ok: false,
      code: "read",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let manifest: ConceptAdmissionApplyManifest;
  try {
    manifest = JSON.parse(manifestText) as ConceptAdmissionApplyManifest;
  } catch (error) {
    return {
      ok: false,
      code: "parse",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const db = deps.openDb(dbPath);
  const result = runApplyPreflight({
    db,
    dbPath,
    manifestPath: parsed.manifestPath,
    candidateReportPath: parsed.candidatesPath,
    assessmentReportPath: parsed.assessmentPath,
    candidateReportText: candidateText,
    assessmentReportText: assessmentText,
    manifest,
    now: deps.now,
  });
  const payload = applyPreflightReportPayload(result);
  const writer = deps.writeReport ?? writeApplyPreflightReportFile;
  writer(parsed.outputPath, payload);
  return {
    ok: true,
    result,
    summary: formatApplyPreflightSummary(result),
  };
}
