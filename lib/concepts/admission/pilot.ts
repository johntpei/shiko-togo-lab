import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CONCEPT_ADMISSION_PROMPT_VERSION } from "@/lib/ai/prompts/concept-admission";
import type { AiProvider, StructuredGenerateUsage } from "@/lib/ai/provider";
import { runConceptAdmission } from "@/lib/ai/tasks/concept-admission";
import { CONCEPT_ADMISSION_VERSION } from "./types";
import { buildAdmissionCandidates } from "./candidates";
import {
  reconstructAdmissionUnitTexts,
  sessionIdsFromAdmissionSnapshot,
  withResolvedAdmissionEvidence,
  type AdmissionEvidenceIntegrity,
  type AdmissionEvidenceSession,
} from "./evidence";

export type { AdmissionEvidenceSession };
import { snapshotFromConceptPilotReport } from "./loader";
import {
  admissionIdentityInvariants,
  type AdmissionIdentityInvariants,
} from "./report";
import type { AdmissionDecisionKind, AdmissionReasonCode } from "./types";

export const CONCEPT_ADMISSION_PILOT_DEFAULT_INPUT =
  "data/concept-pilot-2b-v4.json";
export const CONCEPT_ADMISSION_PILOT_DEFAULT_OUTPUT =
  "data/concept-admission-pilot-v1.json";
export const CONCEPT_ADMISSION_PILOT_APPLY_ERROR =
  "apply is not implemented in 3C-1c2";

export const CONCEPT_ADMISSION_PILOT_HELP = `Usage:
  npm run concept:admission-pilot -- [--input <path>] [--output <path>]

Always dry-run. Does not write Concept / Alias / Occurrence to the database.
--apply is not implemented in 3C-1c2.

Options:
  --input <path>   Extract Pilot JSON (default: ${CONCEPT_ADMISSION_PILOT_DEFAULT_INPUT})
  --output <path>  Admission report path (default: ${CONCEPT_ADMISSION_PILOT_DEFAULT_OUTPUT})
`;

export type AdmissionPilotDecisionRow = {
  candidateRef: string;
  canonicalLabel: string;
  decision: AdmissionDecisionKind;
  reasonCode: AdmissionReasonCode;
  occurrenceCount: number;
  distinctSessionCount: number;
  sessionIds: string[];
  evidenceRefs: string[];
  suspiciousFlags: string[];
};

export type ConceptAdmissionPilotReport = {
  metadata: {
    generatedAt: string;
    inputReport: string;
    extractPromptVersion: string | null;
    extractionVersion: string | null;
    admissionPromptVersion: string;
    admissionVersion: string;
    model: string | null;
    outputPath: string;
  };
  evidenceIntegrity: AdmissionEvidenceIntegrity;
  usage: {
    llmCallsActual: number;
    retryCalls: number;
    repairedBatches: number;
    coverageFailedBatches: number;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
  totals: {
    totalCandidates: number;
    admitted: number;
    deferred: number;
    rejected: number;
    reasonCodeCounts: Record<string, number>;
  };
  decisions: AdmissionPilotDecisionRow[];
  invariants: AdmissionIdentityInvariants;
  failed: { code: string; error: string } | null;
};

export type ConceptAdmissionPilotDeps = {
  generateStructured: AiProvider["generateStructured"];
  loadSession: (sessionId: string) => AdmissionEvidenceSession | null;
  readInputFile?: (path: string) => string;
  writeReport?: (path: string, report: ConceptAdmissionPilotReport) => void;
  now?: () => string;
};

export function parseConceptAdmissionPilotArgs(argv: string[]) {
  let apply = false;
  let inputPath = CONCEPT_ADMISSION_PILOT_DEFAULT_INPUT;
  let outputPath = CONCEPT_ADMISSION_PILOT_DEFAULT_OUTPUT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--input") {
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        inputPath = value;
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
  return { apply, inputPath, outputPath };
}

export function writeConceptAdmissionPilotReportFile(
  path: string,
  report: ConceptAdmissionPilotReport,
) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function formatConceptAdmissionPilotSummary(
  report: ConceptAdmissionPilotReport,
) {
  const failed = report.failed
    ? `${report.failed.code}: ${report.failed.error}`
    : "none";
  return [
    "Concept admission dry-run",
    `candidates: ${report.evidenceIntegrity.totalCandidates}`,
    `evidence: ${report.evidenceIntegrity.evidenceResolvedCandidates} resolved / ${report.evidenceIntegrity.evidenceUnresolvedCandidates} unresolved`,
    `ADMIT: ${report.totals.admitted}  DEFER: ${report.totals.deferred}  REJECT: ${report.totals.rejected}`,
    `llmCalls: ${report.usage.llmCallsActual}  retries: ${report.usage.retryCalls}  repaired: ${report.usage.repairedBatches}  coverageFailed: ${report.usage.coverageFailedBatches}`,
    `failed: ${failed}`,
    `report: ${report.metadata.outputPath}`,
  ].join("\n");
}

function emptyUsage(usage: StructuredGenerateUsage | null) {
  return {
    llmCallsActual: 0,
    retryCalls: 0,
    repairedBatches: 0,
    coverageFailedBatches: 0,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
  };
}

export async function runConceptAdmissionPilot(
  argv: string[],
  deps: ConceptAdmissionPilotDeps,
): Promise<
  | { ok: true; report: ConceptAdmissionPilotReport; outputPath: string }
  | { ok: false; error: string; code: string; report?: ConceptAdmissionPilotReport }
> {
  const parsed = parseConceptAdmissionPilotArgs(argv);
  if (parsed.apply) {
    return {
      ok: false,
      code: "apply",
      error: CONCEPT_ADMISSION_PILOT_APPLY_ERROR,
    };
  }

  const now = deps.now ?? (() => new Date().toISOString());
  const reader = deps.readInputFile ?? ((path: string) => readFileSync(path, "utf8"));
  const writer = deps.writeReport ?? writeConceptAdmissionPilotReportFile;

  let raw: unknown;
  try {
    raw = JSON.parse(reader(parsed.inputPath));
  } catch {
    return {
      ok: false,
      code: "input",
      error: `Pilot report を読めません: ${parsed.inputPath}`,
    };
  }

  const loaded = snapshotFromConceptPilotReport(raw);
  if (!loaded.ok) {
    return { ok: false, code: "input", error: loaded.error };
  }

  const sessionIds = sessionIdsFromAdmissionSnapshot(loaded.loaded.snapshot);
  const sessions: AdmissionEvidenceSession[] = [];
  for (const sessionId of sessionIds) {
    const session = deps.loadSession(sessionId);
    if (session) {
      sessions.push(session);
    }
  }
  const reconstructed = reconstructAdmissionUnitTexts(sessions);
  const built = buildAdmissionCandidates({
    snapshot: loaded.loaded.snapshot,
    sessionOccurredAt: reconstructed.sessionOccurredAt,
    unitTexts: reconstructed.unitTexts,
  });
  if (!built.ok) {
    return {
      ok: false,
      code: "candidates",
      error: `Candidate を構築できません (${built.reason}: ${built.detail})`,
    };
  }

  const before = built.candidates.map((item) => ({
    ...item,
    sessionIds: [...item.sessionIds],
    evidenceRefs: [...item.evidenceRefs],
  }));
  const resolved = withResolvedAdmissionEvidence(
    built.candidates,
    reconstructed.unitTexts,
  );

  const baseMetadata = {
    generatedAt: now(),
    inputReport: parsed.inputPath,
    extractPromptVersion: loaded.loaded.extractPromptVersion,
    extractionVersion: loaded.loaded.extractionVersion,
    admissionPromptVersion: CONCEPT_ADMISSION_PROMPT_VERSION,
    admissionVersion: CONCEPT_ADMISSION_VERSION,
    model: null as string | null,
    outputPath: parsed.outputPath,
  };

  const failReport = (
    code: string,
    error: string,
    extra?: {
      usage?: ConceptAdmissionPilotReport["usage"];
      model?: string | null;
    },
  ): ConceptAdmissionPilotReport => ({
    metadata: { ...baseMetadata, model: extra?.model ?? null },
    evidenceIntegrity: resolved.integrity,
    usage: extra?.usage ?? emptyUsage(null),
    totals: {
      totalCandidates: resolved.candidates.length,
      admitted: 0,
      deferred: 0,
      rejected: 0,
      reasonCodeCounts: {},
    },
    decisions: [],
    invariants: admissionIdentityInvariants(before, resolved.candidates),
    failed: { code, error },
  });

  if (resolved.integrity.evidenceUnresolvedCandidates > 0) {
    const report = failReport(
      "evidence",
      `USER Evidence を復元できない Candidate があります: ${resolved.integrity.unresolvedCandidateRefs.join(", ")}`,
    );
    writer(parsed.outputPath, report);
    return {
      ok: false,
      code: "evidence",
      error: report.failed?.error ?? "evidence",
      report,
    };
  }

  const result = await runConceptAdmission(
    { candidates: resolved.candidates },
    { generateStructured: deps.generateStructured },
  );

  if (!result.ok) {
    const report = failReport(result.code, result.error, {
      model: null,
      usage: {
        llmCallsActual: result.apiCalls ?? 0,
        retryCalls: result.retryCalls ?? 0,
        repairedBatches: 0,
        coverageFailedBatches: result.coverageFailed ? 1 : 0,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        totalTokens: result.usage?.totalTokens ?? null,
      },
    });
    writer(parsed.outputPath, report);
    return {
      ok: false,
      code: result.code,
      error: result.error,
      report,
    };
  }

  const decisions: AdmissionPilotDecisionRow[] = result.applied.judged.map(
    (item) => ({
      candidateRef: item.candidateRef,
      canonicalLabel: item.canonicalLabel,
      decision: item.decision,
      reasonCode: item.reasonCode,
      occurrenceCount: item.occurrenceCount,
      distinctSessionCount: item.distinctSessionCount,
      sessionIds: [...item.sessionIds],
      evidenceRefs: [...item.evidenceRefs],
      suspiciousFlags: [...item.suspiciousFlags],
    }),
  );

  const report: ConceptAdmissionPilotReport = {
    metadata: {
      ...baseMetadata,
      model: result.model,
    },
    evidenceIntegrity: resolved.integrity,
    usage: {
      llmCallsActual: result.apiCalls,
      retryCalls: result.retryCalls,
      repairedBatches: result.repaired ? 1 : 0,
      coverageFailedBatches: 0,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      totalTokens: result.usage?.totalTokens ?? null,
    },
    totals: result.applied.report.totals,
    decisions,
    invariants: admissionIdentityInvariants(before, result.applied.judged),
    failed: null,
  };

  writer(parsed.outputPath, report);
  return { ok: true, report, outputPath: parsed.outputPath };
}
