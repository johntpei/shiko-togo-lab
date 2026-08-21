import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-admission-assessment";
import type { AiProvider } from "@/lib/ai/provider";
import { runConceptAssessment } from "@/lib/ai/tasks/concept-admission-assessment";
import type { ConceptAssessmentUsage } from "@/lib/ai/tasks/concept-admission-assessment";
import {
  CONCEPT_ADMISSION_ASSESSMENT_VERSION,
  type ConceptForm,
  type EvidenceRole,
  type LongitudinalPotential,
} from "./assessment-types";
import {
  ASSESSMENT_BATCH_STRATEGY,
  type AssessmentBatchStrategy,
} from "./assessment-batches";
import { buildAdmissionCandidates } from "./candidates";
import {
  reconstructAdmissionUnitTexts,
  sessionIdsFromAdmissionSnapshot,
  withResolvedAdmissionEvidence,
  type AdmissionEvidenceIntegrity,
  type AdmissionEvidenceSession,
} from "./evidence";
import { snapshotFromConceptPilotReport } from "./loader";
import { serverSignalsFromCandidate } from "./policy";
import {
  admissionIdentityInvariants,
  type AdmissionIdentityInvariants,
} from "./report";
import type { AdmissionServerSignals } from "./assessment-types";

export type { AdmissionEvidenceSession };

export const CONCEPT_ASSESSMENT_PILOT_DEFAULT_INPUT =
  "data/concept-pilot-2b-v4.json";
export const CONCEPT_ASSESSMENT_PILOT_DEFAULT_OUTPUT =
  "data/concept-admission-assessment-v2.json";
export const CONCEPT_ASSESSMENT_PILOT_APPLY_ERROR =
  "apply is not implemented in 3C-1c4b";

export const CONCEPT_ASSESSMENT_PILOT_HELP = `Usage:
  npm run concept:admission-assessment-pilot -- [--input <path>] [--output <path>]

Always dry-run. Writes raw Semantic Assessments only.
Does not apply Admission Policy or write Concept / Alias / Occurrence.
--apply is not implemented in 3C-1c4b.

Options:
  --input <path>   Extract Pilot JSON (default: ${CONCEPT_ASSESSMENT_PILOT_DEFAULT_INPUT})
  --output <path>  Assessment report path (default: ${CONCEPT_ASSESSMENT_PILOT_DEFAULT_OUTPUT})
`;

export type AssessmentPilotRow = {
  candidateRef: string;
  canonicalLabel: string;
  conceptForm: ConceptForm;
  evidenceRole: EvidenceRole;
  longitudinalPotential: LongitudinalPotential;
  evidenceRefs: string[];
  serverSignals: AdmissionServerSignals;
};

export type ConceptAssessmentPilotReport = {
  metadata: {
    generatedAt: string;
    sourcePilotReport: string;
    extractPromptVersion: string | null;
    extractionVersion: string | null;
    assessmentPromptVersion: string;
    assessmentVersion: string;
    model: string | null;
    batchStrategy: AssessmentBatchStrategy;
    outputPath: string;
  };
  evidenceIntegrity: AdmissionEvidenceIntegrity;
  usage: ConceptAssessmentUsage;
  assessments: AssessmentPilotRow[];
  invariants: AdmissionIdentityInvariants;
  failed: { code: string; error: string } | null;
};

export type ConceptAssessmentPilotDeps = {
  generateStructured: AiProvider["generateStructured"];
  loadSession: (sessionId: string) => AdmissionEvidenceSession | null;
  readInputFile?: (path: string) => string;
  writeReport?: (path: string, report: ConceptAssessmentPilotReport) => void;
  now?: () => string;
};

export function parseConceptAssessmentPilotArgs(argv: string[]) {
  let apply = false;
  let inputPath = CONCEPT_ASSESSMENT_PILOT_DEFAULT_INPUT;
  let outputPath = CONCEPT_ASSESSMENT_PILOT_DEFAULT_OUTPUT;
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

export function writeConceptAssessmentPilotReportFile(
  path: string,
  report: ConceptAssessmentPilotReport,
) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function formatConceptAssessmentPilotSummary(
  report: ConceptAssessmentPilotReport,
) {
  const failed = report.failed
    ? `${report.failed.code}: ${report.failed.error}`
    : "none";
  return [
    "Concept assessment dry-run",
    `candidates: ${report.evidenceIntegrity.totalCandidates}`,
    `evidence: ${report.evidenceIntegrity.evidenceResolvedCandidates} resolved / ${report.evidenceIntegrity.evidenceUnresolvedCandidates} unresolved`,
    `assessments: ${report.assessments.length}`,
    `batches: ${report.usage.successfulBatches}/${report.usage.totalBatches}  llmCalls: ${report.usage.llmCallsActual}  retries: ${report.usage.retryCalls}  repaired: ${report.usage.repairedBatches}`,
    `failed: ${failed}`,
    `report: ${report.metadata.outputPath}`,
  ].join("\n");
}

function emptyUsage(): ConceptAssessmentUsage {
  return {
    totalBatches: 0,
    successfulBatches: 0,
    failedBatches: 0,
    llmCallsActual: 0,
    retryCalls: 0,
    repairedBatches: 0,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  };
}

export async function runConceptAssessmentPilot(
  argv: string[],
  deps: ConceptAssessmentPilotDeps,
): Promise<
  | { ok: true; report: ConceptAssessmentPilotReport; outputPath: string }
  | {
      ok: false;
      error: string;
      code: string;
      report?: ConceptAssessmentPilotReport;
    }
> {
  const parsed = parseConceptAssessmentPilotArgs(argv);
  if (parsed.apply) {
    return {
      ok: false,
      code: "apply",
      error: CONCEPT_ASSESSMENT_PILOT_APPLY_ERROR,
    };
  }

  const now = deps.now ?? (() => new Date().toISOString());
  const reader =
    deps.readInputFile ?? ((path: string) => readFileSync(path, "utf8"));
  const writer = deps.writeReport ?? writeConceptAssessmentPilotReportFile;

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
    sourcePilotReport: parsed.inputPath,
    extractPromptVersion: loaded.loaded.extractPromptVersion,
    extractionVersion: loaded.loaded.extractionVersion,
    assessmentPromptVersion: CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION,
    assessmentVersion: CONCEPT_ADMISSION_ASSESSMENT_VERSION,
    model: null as string | null,
    batchStrategy: ASSESSMENT_BATCH_STRATEGY,
    outputPath: parsed.outputPath,
  };

  const failReport = (
    code: string,
    error: string,
    extra?: {
      usage?: ConceptAssessmentUsage;
      model?: string | null;
    },
  ): ConceptAssessmentPilotReport => ({
    metadata: { ...baseMetadata, model: extra?.model ?? null },
    evidenceIntegrity: resolved.integrity,
    usage: extra?.usage ?? emptyUsage(),
    assessments: [],
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

  const result = await runConceptAssessment(
    {
      candidates: resolved.candidates,
      unitTexts: reconstructed.unitTexts,
    },
    { generateStructured: deps.generateStructured },
  );

  if (!result.ok) {
    const report = failReport(result.code, result.error, {
      model: result.model ?? null,
      usage: result.usage ?? emptyUsage(),
    });
    writer(parsed.outputPath, report);
    return {
      ok: false,
      code: result.code,
      error: result.error,
      report,
    };
  }

  const byRef = new Map(
    result.assessments.map((item) => [item.candidateRef, item] as const),
  );
  const assessments: AssessmentPilotRow[] = resolved.candidates.map(
    (candidate) => {
      const assessment = byRef.get(candidate.candidateRef)!;
      return {
        candidateRef: candidate.candidateRef,
        canonicalLabel: candidate.canonicalLabel,
        conceptForm: assessment.conceptForm,
        evidenceRole: assessment.evidenceRole,
        longitudinalPotential: assessment.longitudinalPotential,
        evidenceRefs: [...candidate.evidenceRefs],
        serverSignals: serverSignalsFromCandidate(candidate),
      };
    },
  );

  const report: ConceptAssessmentPilotReport = {
    metadata: {
      ...baseMetadata,
      model: result.model,
    },
    evidenceIntegrity: resolved.integrity,
    usage: result.usage,
    assessments,
    invariants: admissionIdentityInvariants(before, resolved.candidates),
    failed: null,
  };

  writer(parsed.outputPath, report);
  return { ok: true, report, outputPath: parsed.outputPath };
}
