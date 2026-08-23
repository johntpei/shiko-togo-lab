import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  CONCEPT_APPLY_DEFAULT_ASSESSMENT,
  CONCEPT_APPLY_DEFAULT_CANDIDATES,
  CONCEPT_APPLY_DEFAULT_MANIFEST,
  CONCEPT_APPLY_DEFAULT_RESULT,
  CONCEPT_APPLY_DRY_RUN_REFUSES_APPLY,
  applyManifestPreview,
  buildApplyManifest,
  formatApplyManifestPreview,
  type ApplyManifestRegistryCounts,
  type ConceptAdmissionApplyManifest,
} from "./apply-manifest";
import type { AdmissionEvidenceSession } from "./evidence";

export type { AdmissionEvidenceSession };

export {
  CONCEPT_APPLY_DRY_RUN_REFUSES_APPLY,
  CONCEPT_APPLY_DEFAULT_ASSESSMENT,
  CONCEPT_APPLY_DEFAULT_CANDIDATES,
  CONCEPT_APPLY_DEFAULT_MANIFEST,
  CONCEPT_APPLY_DEFAULT_RESULT,
};

export const CONCEPT_ADMISSION_APPLY_HELP = `Usage:
  npm run concept:admission-apply -- [--candidates <path>] [--assessment <path>] [--manifest <path>]
    Dry-run. Builds an Apply Manifest, validates it, prints a preview, then STOP.
    Does not write Concept / Alias / Occurrence to the database.

  npm run concept:admission-apply -- --manifest <path> --apply [--result <path>]
    Explicit Initial Apply. Requires --apply. Re-validates artifacts/DB, then writes
    in one transaction.

Options:
  --candidates <path>  Extract Pilot JSON (default: ${CONCEPT_APPLY_DEFAULT_CANDIDATES})
  --assessment <path>  Assessment JSON (default: ${CONCEPT_APPLY_DEFAULT_ASSESSMENT})
  --manifest <path>    Manifest path (default: ${CONCEPT_APPLY_DEFAULT_MANIFEST})
  --result <path>      Apply Result JSON (default: ${CONCEPT_APPLY_DEFAULT_RESULT})
  --apply              Write path. Omitted = dry-run, Registry write = 0.
`;

export type ConceptAdmissionApplyArgs = {
  apply: boolean;
  candidatesPath: string;
  assessmentPath: string;
  manifestPath: string;
  resultPath: string;
};

export type ConceptAdmissionApplyDeps = {
  loadSession: (sessionId: string) => AdmissionEvidenceSession | null;
  readFile?: (path: string) => string;
  writeManifest?: (path: string, manifest: ConceptAdmissionApplyManifest) => void;
  loadRegistryCounts?: () => ApplyManifestRegistryCounts;
  now?: () => string;
};

export type ConceptAdmissionApplyResult =
  | {
      ok: true;
      manifest: ConceptAdmissionApplyManifest;
      preview: ReturnType<typeof applyManifestPreview>;
      previewText: string;
    }
  | {
      ok: false;
      code: string;
      error: string;
    };

export function parseConceptAdmissionApplyArgs(
  argv: string[],
): ConceptAdmissionApplyArgs {
  let apply = false;
  let candidatesPath = CONCEPT_APPLY_DEFAULT_CANDIDATES;
  let assessmentPath = CONCEPT_APPLY_DEFAULT_ASSESSMENT;
  let manifestPath = CONCEPT_APPLY_DEFAULT_MANIFEST;
  let resultPath = CONCEPT_APPLY_DEFAULT_RESULT;
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
    if (arg === "--result") {
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        resultPath = value;
        i += 1;
      }
    }
  }
  return { apply, candidatesPath, assessmentPath, manifestPath, resultPath };
}

export function writeApplyManifestFile(
  path: string,
  manifest: ConceptAdmissionApplyManifest,
) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function defaultReadFile(path: string) {
  return readFileSync(resolve(path), "utf8");
}

function sessionIdsFromCandidateReport(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const metadata = (raw as { metadata?: { selectedSessionIds?: unknown } })
    .metadata;
  if (Array.isArray(metadata?.selectedSessionIds)) {
    return metadata.selectedSessionIds.filter(
      (item): item is string => typeof item === "string",
    );
  }
  const actions = (raw as { actions?: Array<{ sessionId?: unknown }> }).actions;
  if (!Array.isArray(actions)) {
    return [];
  }
  return [
    ...new Set(
      actions
        .map((item) => item.sessionId)
        .filter((item): item is string => typeof item === "string"),
    ),
  ];
}

export function runConceptAdmissionApply(
  argv: string[],
  deps: ConceptAdmissionApplyDeps,
): ConceptAdmissionApplyResult {
  const parsed = parseConceptAdmissionApplyArgs(argv);
  if (parsed.apply) {
    return {
      ok: false,
      code: "apply",
      error: CONCEPT_APPLY_DRY_RUN_REFUSES_APPLY,
    };
  }

  const reader = deps.readFile ?? defaultReadFile;
  let candidateText: string;
  let assessmentText: string;
  try {
    candidateText = reader(parsed.candidatesPath);
    assessmentText = reader(parsed.assessmentPath);
  } catch (error) {
    return {
      ok: false,
      code: "read",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let candidateRaw: unknown;
  let assessmentRaw: unknown;
  try {
    candidateRaw = JSON.parse(candidateText);
    assessmentRaw = JSON.parse(assessmentText);
  } catch (error) {
    return {
      ok: false,
      code: "parse",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const sessionIds = sessionIdsFromCandidateReport(candidateRaw);
  const sessions: AdmissionEvidenceSession[] = [];
  for (const sessionId of sessionIds) {
    const session = deps.loadSession(sessionId);
    if (!session) {
      return {
        ok: false,
        code: "missing_session",
        error: sessionId,
      };
    }
    sessions.push(session);
  }

  const built = buildApplyManifest({
    sourceCandidateReportPath: parsed.candidatesPath,
    assessmentReportPath: parsed.assessmentPath,
    candidateReportText: candidateText,
    assessmentReportText: assessmentText,
    candidateReportRaw: candidateRaw,
    assessmentReportRaw: assessmentRaw,
    sessions,
    now: deps.now,
  });
  if (!built.ok) {
    return {
      ok: false,
      code: "manifest",
      error: built.errors
        .map((item) => `${item.code}:${item.detail}`)
        .join("; "),
    };
  }

  const writer = deps.writeManifest ?? writeApplyManifestFile;
  writer(parsed.manifestPath, built.manifest);

  let registryCounts: ApplyManifestRegistryCounts | null = null;
  if (deps.loadRegistryCounts) {
    registryCounts = deps.loadRegistryCounts();
  }

  const preview = applyManifestPreview({
    manifest: built.manifest,
    registryCounts,
  });
  return {
    ok: true,
    manifest: built.manifest,
    preview,
    previewText: formatApplyManifestPreview(preview),
  };
}
