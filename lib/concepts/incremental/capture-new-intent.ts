import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { asc, eq } from "drizzle-orm";
import { toEvidenceRole } from "@/lib/ai/evidence-units";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import type { AiProvider } from "@/lib/ai/provider";
import { conceptExtractOutputSchema } from "@/lib/ai/concept-extract-schema";
import { toExtractActions } from "@/lib/ai/tasks/concept-extract";
import {
  CONCEPT_APPLY_DEFAULT_CANDIDATES,
  CONCEPT_APPLY_DEFAULT_MANIFEST,
} from "@/lib/concepts/admission/apply-manifest";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { prepareUserEvidenceUnits } from "@/lib/concepts/user-units";
import { getDbPath } from "@/lib/db/client";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  type ConceptQueryDb,
} from "@/lib/db/concept-queries";
import { messages, sessions } from "@/lib/db/schema";
import type { SurfaceNotInUnitDiagnostic } from "@/lib/concepts/grounding-diagnostic";
import { planEligibleIncrementalSession } from "./eligible-session-plan";
import { ALL_ACTIONS_GROUNDING_REJECTED } from "./session-plan";
import { loadInitialConceptProcessingCoverage } from "./eligibility";
import { createProductionIncrementalCandidateExtractor } from "./extract";
import {
  CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_DEFAULT_PATH,
  freezeNewAssessmentIntent,
  freezeNewCandidatePlan,
  intentToNewCandidatePlans,
  loadNewAssessmentIntent,
  newCandidatePlansFromGatedResult,
  type NewAssessmentIntent,
} from "./new-assessment-intent";
import { sourceCandidateReportHashFromManifestText } from "./pilot-preflight";
import type {
  ExistingMatchPlan,
  IncrementalConceptPlan,
  NewCandidatePlan,
} from "./plan";

export const CONCEPT_INCREMENTAL_NEW_CAPTURE_DEFAULT_DIAGNOSTIC =
  "data/concept-incremental-new-intent-capture-result-v1.json";

export const CONCEPT_INCREMENTAL_NEW_CAPTURE_APPLY_ERROR =
  "NEW assessment intent capture is read-only planning; --apply is not accepted";

export const NEW_ASSESSMENT_INTENT_TARGET_EXISTS =
  "NEW_ASSESSMENT_INTENT_TARGET_EXISTS";

export const CONCEPT_INCREMENTAL_NEW_CAPTURE_HELP = `Usage:
  npm run concept:incremental-capture-new-intent -- --session <sessionId> [--intent <path>] [--output <path>]

Read-only Planning + Frozen NEW Assessment Intent capture for exactly one Session.
Does not run Assessment / Policy / Concept create. --apply is not accepted.
Existing intent is not overwritten.
`;

export const REAL_FROZEN_NEW_ASSESSMENT_INTENT_READY =
  "REAL_FROZEN_NEW_ASSESSMENT_INTENT_READY";
export const REAL_FROZEN_NEW_ASSESSMENT_NO_NEW_CANDIDATES =
  "REAL_FROZEN_NEW_ASSESSMENT_NO_NEW_CANDIDATES";
export const REAL_FROZEN_NEW_ASSESSMENT_ALL_GROUNDING_REJECTED =
  "REAL_FROZEN_NEW_ASSESSMENT_ALL_GROUNDING_REJECTED";
export const REAL_FROZEN_NEW_ASSESSMENT_INTENT_BLOCKED =
  "REAL_FROZEN_NEW_ASSESSMENT_INTENT_BLOCKED";

export type FrozenNewAssessmentCaptureClassification =
  | typeof REAL_FROZEN_NEW_ASSESSMENT_INTENT_READY
  | typeof REAL_FROZEN_NEW_ASSESSMENT_NO_NEW_CANDIDATES
  | typeof REAL_FROZEN_NEW_ASSESSMENT_ALL_GROUNDING_REJECTED
  | typeof REAL_FROZEN_NEW_ASSESSMENT_INTENT_BLOCKED;

export type FrozenNewAssessmentCaptureArgs = {
  apply: boolean;
  malformed: boolean;
  malformedReason: string | null;
  sessionId: string | null;
  candidatesPath: string;
  manifestPath: string;
  intentPath: string;
  diagnosticPath: string;
};

export type FrozenNewAssessmentCaptureDbCounts = {
  concepts: number;
  conceptAliases: number;
  conceptOccurrences: number;
  sessions: number;
  messages: number;
};

export type FrozenNewAssessmentCaptureDiagnosticPlan = {
  kind: IncrementalConceptPlan["kind"];
  candidateRef: string;
  evidenceRef: string;
  messageId: string;
  occurredAt: string;
  sourceRole: string;
  sourceType: string;
  extractionVersion: string;
  conceptId: string | null;
  matchReason: ExistingMatchPlan["matchReason"] | null;
  provisionalConceptId: string | null;
};

export type FrozenNewAssessmentCaptureReport = {
  classification: FrozenNewAssessmentCaptureClassification;
  sessionId: string | null;
  executedAt: string;
  eligibility: "eligible" | "already_covered" | "blocked" | "unresolved";
  eligibilityReason: string | null;
  userMessageCount: number | null;
  userEvidenceUnitCount: number | null;
  model: string | null;
  promptVersion: string;
  extractionVersion: string;
  sessionExecutions: number;
  generateStructuredCalls: number;
  coverageRepairCalls: number;
  adapterRetry: 0;
  sessionRerun: 0;
  otherSessionExecution: 0;
  actionCount: number;
  plansTotal: number;
  existingMatchCount: number;
  exactCanonicalCount: number;
  uniqueObservedAliasCount: number;
  newCount: number;
  provisionalNewCount: number;
  providerStructuredActions: number;
  adapterActions: number;
  actionsEnteringGrounding: number;
  groundedActions: number;
  groundedCandidates: number;
  groundingRejectedCount: number;
  groundingRejections: SurfaceNotInUnitDiagnostic[];
  groundingFailure: SurfaceNotInUnitDiagnostic | null;
  stage: "eligibility" | "planning" | "intent" | null;
  reason: string | null;
  intentPath: string;
  intentWritten: boolean;
  intentVerified: boolean;
  frozenCandidateCount: number;
  coverage: {
    ok: boolean;
    sourceHash: string | null;
    expectedSourceHash: string | null;
    extractPromptVersion: string | null;
    extractionVersion: string | null;
  };
  db: {
    before: FrozenNewAssessmentCaptureDbCounts;
    after: FrozenNewAssessmentCaptureDbCounts;
  };
  plans: FrozenNewAssessmentCaptureDiagnosticPlan[];
};

export type FrozenNewAssessmentCaptureDeps = {
  openDb: (dbPath: string) => ConceptQueryDb;
  generateStructured: AiProvider["generateStructured"];
  dbPath?: string;
  readFile?: (path: string) => string;
  writeDiagnostic?: (path: string, payload: unknown) => void;
  intentTargetExists?: (path: string) => boolean;
  writeIntent?: (path: string, intent: NewAssessmentIntent) => void;
  readIntentFile?: (path: string) => string;
  now?: () => string;
  model?: string | null;
};

function emptyCounts(): FrozenNewAssessmentCaptureDbCounts {
  return {
    concepts: 0,
    conceptAliases: 0,
    conceptOccurrences: 0,
    sessions: 0,
    messages: 0,
  };
}

function snapshotDbCounts(db: ConceptQueryDb): FrozenNewAssessmentCaptureDbCounts {
  return {
    concepts: countConcepts(db),
    conceptAliases: countConceptAliases(db),
    conceptOccurrences: countConceptOccurrences(db),
    sessions: db.select().from(sessions).all().length,
    messages: db.select().from(messages).all().length,
  };
}

function isCoverageRepairPrompt(user: string) {
  return user.includes("# Coverage repair");
}

function loadSessionMessages(db: ConceptQueryDb, sessionId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.index))
    .all();
}

function sessionEvidenceMeta(db: ConceptQueryDb, sessionId: string) {
  const session = db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
  if (!session) {
    return { userMessageCount: null, userEvidenceUnitCount: null };
  }
  const sessionMessages = loadSessionMessages(db, sessionId);
  return {
    userMessageCount: sessionMessages.filter(
      (message) => toEvidenceRole(message.role) === "user",
    ).length,
    userEvidenceUnitCount: prepareUserEvidenceUnits({
      sessionId,
      occurredAt: session.occurredAt,
      messages: sessionMessages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        sourceCreatedAt: message.sourceCreatedAt,
      })),
    }).length,
  };
}

function diagnosticPlanRow(
  plan: IncrementalConceptPlan,
): FrozenNewAssessmentCaptureDiagnosticPlan {
  const base = {
    kind: plan.kind,
    candidateRef: plan.candidateRef,
    evidenceRef: plan.provenance.evidenceRef,
    messageId: plan.provenance.messageId,
    occurredAt: plan.provenance.occurredAt,
    sourceRole: plan.provenance.sourceRole,
    sourceType: plan.provenance.sourceType,
    extractionVersion: plan.provenance.extractionVersion,
  };
  if (plan.kind === "existing_match") {
    return {
      ...base,
      conceptId: plan.conceptId,
      matchReason: plan.matchReason,
      provisionalConceptId: null,
    };
  }
  if (plan.kind === "provisional_new") {
    return {
      ...base,
      conceptId: null,
      matchReason: null,
      provisionalConceptId: plan.provisionalConceptId ?? null,
    };
  }
  return {
    ...base,
    conceptId: null,
    matchReason: null,
    provisionalConceptId: null,
  };
}

function candidatesDeepEqual(
  left: NewCandidatePlan[],
  right: NewCandidatePlan[],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function countProviderStructuredActions(parsed: unknown) {
  const parsedOutput = conceptExtractOutputSchema.safeParse(parsed);
  if (!parsedOutput.success) {
    return 0;
  }
  return toExtractActions(parsedOutput.data).filter(
    (action) => action.action === "new" || action.action === "match",
  ).length;
}

function planningCountsFromGated(result: {
  adapterActions?: number;
  actionsEnteringGrounding?: number;
  groundedActions?: number;
  groundedCandidates?: number;
  groundingRejectedCount?: number;
  groundingRejections?: SurfaceNotInUnitDiagnostic[];
  groundingFailure?: SurfaceNotInUnitDiagnostic | null;
  planResult?: {
    adapterActions: number;
    actionsEnteringGrounding: number;
    groundedActions: number;
    groundedCandidates: number;
    groundingRejectedCount: number;
    groundingRejections: SurfaceNotInUnitDiagnostic[];
  };
}) {
  if (result.planResult) {
    return {
      adapterActions: result.planResult.adapterActions,
      actionsEnteringGrounding: result.planResult.actionsEnteringGrounding,
      groundedActions: result.planResult.groundedActions,
      groundedCandidates: result.planResult.groundedCandidates,
      groundingRejectedCount: result.planResult.groundingRejectedCount,
      groundingRejections: result.planResult.groundingRejections,
      groundingFailure: null as SurfaceNotInUnitDiagnostic | null,
    };
  }
  return {
    adapterActions: result.adapterActions ?? 0,
    actionsEnteringGrounding: result.actionsEnteringGrounding ?? 0,
    groundedActions: result.groundedActions ?? 0,
    groundedCandidates: result.groundedCandidates ?? 0,
    groundingRejectedCount: result.groundingRejectedCount ?? 0,
    groundingRejections: result.groundingRejections ?? [],
    groundingFailure: result.groundingFailure ?? null,
  };
}

function countKinds(plans: FrozenNewAssessmentCaptureDiagnosticPlan[]) {
  const existing = plans.filter((plan) => plan.kind === "existing_match");
  return {
    existingMatchCount: existing.length,
    exactCanonicalCount: existing.filter(
      (plan) => plan.matchReason === "exact_canonical",
    ).length,
    uniqueObservedAliasCount: existing.filter(
      (plan) => plan.matchReason === "unique_observed_alias",
    ).length,
    newCount: plans.filter((plan) => plan.kind === "new").length,
    provisionalNewCount: plans.filter((plan) => plan.kind === "provisional_new")
      .length,
  };
}

export function parseConceptIncrementalCaptureNewIntentArgs(
  argv: string[],
): FrozenNewAssessmentCaptureArgs {
  let apply = false;
  let malformed = false;
  let malformedReason: string | null = null;
  const sessionIds: string[] = [];
  let candidatesPath = CONCEPT_APPLY_DEFAULT_CANDIDATES;
  let manifestPath = CONCEPT_APPLY_DEFAULT_MANIFEST;
  let intentPath = CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_DEFAULT_PATH;
  let diagnosticPath = CONCEPT_INCREMENTAL_NEW_CAPTURE_DEFAULT_DIAGNOSTIC;

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
    if (arg === "--replace") {
      malformed = true;
      malformedReason = "replace_not_supported";
      continue;
    }
    if (arg === "--session") {
      const value = takeValue(i);
      if (value) {
        sessionIds.push(value);
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
    if (arg === "--intent") {
      const value = takeValue(i);
      if (value) {
        intentPath = value;
        i += 1;
      }
      continue;
    }
    if (arg === "--output") {
      const value = takeValue(i);
      if (value) {
        diagnosticPath = value;
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

  if (sessionIds.length > 1) {
    malformed = true;
    malformedReason = "multiple_sessions";
  }
  if (!malformed && sessionIds.length === 0 && !apply) {
    malformed = true;
    malformedReason = "missing_session";
  }

  return {
    apply,
    malformed,
    malformedReason,
    sessionId: sessionIds.length === 1 ? sessionIds[0]! : null,
    candidatesPath,
    manifestPath,
    intentPath,
    diagnosticPath,
  };
}

export function writeFrozenNewAssessmentCaptureDiagnostic(
  path: string,
  payload: unknown,
) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function formatFrozenNewAssessmentCaptureSummary(
  report: FrozenNewAssessmentCaptureReport,
) {
  const lines = [
    report.classification,
    `sessionId: ${report.sessionId ?? "(none)"}`,
    `eligibility: ${report.eligibility}${report.eligibilityReason ? ` (${report.eligibilityReason})` : ""}`,
    `userMessages: ${report.userMessageCount ?? "null"} userEvidenceUnits: ${report.userEvidenceUnitCount ?? "null"}`,
    `model: ${report.model ?? "(none)"} prompt=${report.promptVersion} extraction=${report.extractionVersion}`,
    `coverage: ok=${report.coverage.ok}`,
    `sessionExecutions: ${report.sessionExecutions}`,
    `generateStructuredCalls: ${report.generateStructuredCalls}`,
    `coverageRepairCalls: ${report.coverageRepairCalls}`,
    `providerStructuredActions: ${report.providerStructuredActions} adapterActions: ${report.adapterActions} actionsEnteringGrounding: ${report.actionsEnteringGrounding} groundedActions: ${report.groundedActions} groundedCandidates: ${report.groundedCandidates} groundingRejectedActions: ${report.groundingRejectedCount}`,
    `actions: ${report.actionCount} plans: ${report.plansTotal}`,
    `existing_match: ${report.existingMatchCount} exact_canonical: ${report.exactCanonicalCount} unique_observed_alias: ${report.uniqueObservedAliasCount}`,
    `new: ${report.newCount} provisional_new: ${report.provisionalNewCount}`,
    `intentPath: ${report.intentPath}`,
    `intentWritten: ${report.intentWritten} intentVerified: ${report.intentVerified} frozenCandidateCount: ${report.frozenCandidateCount}`,
  ];
  if (report.reason) {
    lines.push(`reason: ${report.reason}`);
  }
  const rejections =
    report.groundingRejections.length > 0
      ? report.groundingRejections
      : report.groundingFailure
        ? [report.groundingFailure]
        : [];
  if (rejections.length > 0) {
    lines.push(`groundingRejectedCount: ${rejections.length}`);
  }
  for (const failure of rejections) {
    lines.push(
      `groundingRejection: actionIndex=${failure.actionIndex} evidenceRef=${failure.evidenceRef} surfaceFormLength=${failure.surfaceFormLength} evidenceUnitLength=${failure.evidenceUnitLength}`,
    );
    lines.push(`surfaceFormHash: ${failure.surfaceFormHash}`);
    lines.push(
      `diagnosticMatches: trimmed=${failure.diagnosticMatches.trimmed} nfkc=${failure.diagnosticMatches.nfkc} whitespaceNormalized=${failure.diagnosticMatches.whitespaceNormalized} outerQuoteStripped=${failure.diagnosticMatches.outerQuoteStripped}`,
    );
  }
  lines.push(
    "Existing append / Assessment / Policy / Concept create were not run.",
  );
  return lines.join("\n");
}

function baseReport(input: {
  classification: FrozenNewAssessmentCaptureClassification;
  sessionId: string | null;
  executedAt: string;
  eligibility: FrozenNewAssessmentCaptureReport["eligibility"];
  eligibilityReason: string | null;
  userMessageCount: number | null;
  userEvidenceUnitCount: number | null;
  model: string | null;
  sessionExecutions: number;
  generateStructuredCalls: number;
  coverageRepairCalls: number;
  actionCount: number;
  plansTotal: number;
  existingMatchCount: number;
  exactCanonicalCount: number;
  uniqueObservedAliasCount: number;
  newCount: number;
  provisionalNewCount: number;
  stage: FrozenNewAssessmentCaptureReport["stage"];
  reason: string | null;
  intentPath: string;
  intentWritten: boolean;
  intentVerified: boolean;
  frozenCandidateCount: number;
  coverage: FrozenNewAssessmentCaptureReport["coverage"];
  db: FrozenNewAssessmentCaptureReport["db"];
  plans: FrozenNewAssessmentCaptureDiagnosticPlan[];
  providerStructuredActions?: number;
  adapterActions?: number;
  actionsEnteringGrounding?: number;
  groundedActions?: number;
  groundedCandidates?: number;
  groundingRejectedCount?: number;
  groundingRejections?: SurfaceNotInUnitDiagnostic[];
  groundingFailure?: SurfaceNotInUnitDiagnostic | null;
}): FrozenNewAssessmentCaptureReport {
  const groundingRejections = input.groundingRejections ?? [];
  return {
    ...input,
    promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
    extractionVersion: CONCEPT_EXTRACTION_VERSION,
    adapterRetry: 0,
    sessionRerun: 0,
    otherSessionExecution: 0,
    providerStructuredActions: input.providerStructuredActions ?? 0,
    adapterActions: input.adapterActions ?? 0,
    actionsEnteringGrounding: input.actionsEnteringGrounding ?? 0,
    groundedActions: input.groundedActions ?? 0,
    groundedCandidates: input.groundedCandidates ?? 0,
    groundingRejectedCount:
      input.groundingRejectedCount ?? groundingRejections.length,
    groundingRejections,
    groundingFailure: input.groundingFailure ?? null,
  };
}

export async function runConceptIncrementalCaptureNewIntent(
  argv: string[],
  deps: FrozenNewAssessmentCaptureDeps,
): Promise<
  | { ok: true; report: FrozenNewAssessmentCaptureReport; summary: string }
  | { ok: false; code: string; error: string }
> {
  const parsed = parseConceptIncrementalCaptureNewIntentArgs(argv);
  if (parsed.apply) {
    return {
      ok: false,
      code: "apply",
      error: CONCEPT_INCREMENTAL_NEW_CAPTURE_APPLY_ERROR,
    };
  }
  if (parsed.malformed || !parsed.sessionId) {
    return {
      ok: false,
      code: parsed.malformedReason ?? "malformed",
      error: CONCEPT_INCREMENTAL_NEW_CAPTURE_HELP,
    };
  }

  const executedAt = (deps.now ?? (() => new Date().toISOString()))();
  const exists =
    deps.intentTargetExists ??
    ((path: string) => existsSync(resolve(path)));
  const unresolvedCoverage = {
    ok: false,
    sourceHash: null,
    expectedSourceHash: null,
    extractPromptVersion: null,
    extractionVersion: null,
  };
  const writeDiagnostic =
    deps.writeDiagnostic ?? writeFrozenNewAssessmentCaptureDiagnostic;

  const finish = (report: FrozenNewAssessmentCaptureReport) => {
    writeDiagnostic(parsed.diagnosticPath, report);
    return {
      ok: true as const,
      report,
      summary: formatFrozenNewAssessmentCaptureSummary(report),
    };
  };

  if (exists(parsed.intentPath)) {
    return finish(
      baseReport({
        classification: REAL_FROZEN_NEW_ASSESSMENT_INTENT_BLOCKED,
        sessionId: parsed.sessionId,
        executedAt,
        eligibility: "unresolved",
        eligibilityReason: null,
        userMessageCount: null,
        userEvidenceUnitCount: null,
        model: deps.model ?? null,
        sessionExecutions: 0,
        generateStructuredCalls: 0,
        coverageRepairCalls: 0,
        actionCount: 0,
        plansTotal: 0,
        existingMatchCount: 0,
        exactCanonicalCount: 0,
        uniqueObservedAliasCount: 0,
        newCount: 0,
        provisionalNewCount: 0,
        stage: "intent",
        reason: NEW_ASSESSMENT_INTENT_TARGET_EXISTS,
        intentPath: parsed.intentPath,
        intentWritten: false,
        intentVerified: false,
        frozenCandidateCount: 0,
        coverage: unresolvedCoverage,
        db: { before: emptyCounts(), after: emptyCounts() },
        plans: [],
      }),
    );
  }

  const reader =
    deps.readFile ?? ((path: string) => readFileSync(resolve(path), "utf8"));
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

  const coverage = loadInitialConceptProcessingCoverage({
    candidateReportText: candidateText,
    expectedSourceHash: expectedHash.hash,
  });
  const coverageMeta = {
    ok: coverage.ok,
    sourceHash: coverage.ok ? coverage.coverage.sourceHash : null,
    expectedSourceHash: expectedHash.hash,
    extractPromptVersion: coverage.ok
      ? coverage.coverage.extractPromptVersion
      : null,
    extractionVersion: coverage.ok ? coverage.coverage.extractionVersion : null,
  };

  const db = deps.openDb(deps.dbPath ?? getDbPath());
  const before = snapshotDbCounts(db);
  const evidenceMeta = sessionEvidenceMeta(db, parsed.sessionId);

  let generateStructuredCalls = 0;
  let coverageRepairCalls = 0;
  let providerStructuredActions = 0;
  let usedModel = deps.model ?? null;
  const generateStructured: AiProvider["generateStructured"] = async (
    request,
  ) => {
    generateStructuredCalls += 1;
    if (isCoverageRepairPrompt(request.user)) {
      coverageRepairCalls += 1;
    }
    usedModel = request.model || usedModel;
    const generated = await deps.generateStructured(request);
    providerStructuredActions = countProviderStructuredActions(
      generated.parsed,
    );
    return generated;
  };

  const extractCandidates = createProductionIncrementalCandidateExtractor({
    generateStructured,
  });
  const result = await planEligibleIncrementalSession({
    sessionId: parsed.sessionId,
    db,
    coverage,
    extractCandidates,
  });
  const after = snapshotDbCounts(db);

  const blocked = (
    eligibility: FrozenNewAssessmentCaptureReport["eligibility"],
    eligibilityReason: string | null,
    stage: FrozenNewAssessmentCaptureReport["stage"],
    reason: string,
    extras: {
      classification?: FrozenNewAssessmentCaptureClassification;
      adapterActions?: number;
      actionsEnteringGrounding?: number;
      groundedActions?: number;
      groundedCandidates?: number;
      groundingRejectedCount?: number;
      groundingRejections?: SurfaceNotInUnitDiagnostic[];
      groundingFailure?: SurfaceNotInUnitDiagnostic | null;
    } = {},
  ) =>
    finish(
      baseReport({
        classification:
          extras.classification ??
          (reason === ALL_ACTIONS_GROUNDING_REJECTED
            ? REAL_FROZEN_NEW_ASSESSMENT_ALL_GROUNDING_REJECTED
            : REAL_FROZEN_NEW_ASSESSMENT_INTENT_BLOCKED),
        sessionId: parsed.sessionId,
        executedAt,
        eligibility,
        eligibilityReason,
        userMessageCount: evidenceMeta.userMessageCount,
        userEvidenceUnitCount: evidenceMeta.userEvidenceUnitCount,
        model: usedModel,
        sessionExecutions: 1,
        generateStructuredCalls,
        coverageRepairCalls,
        actionCount: 0,
        plansTotal: 0,
        existingMatchCount: 0,
        exactCanonicalCount: 0,
        uniqueObservedAliasCount: 0,
        newCount: 0,
        provisionalNewCount: 0,
        providerStructuredActions,
        adapterActions: extras.adapterActions ?? 0,
        actionsEnteringGrounding: extras.actionsEnteringGrounding ?? 0,
        groundedActions: extras.groundedActions ?? 0,
        groundedCandidates: extras.groundedCandidates ?? 0,
        groundingRejectedCount: extras.groundingRejectedCount ?? 0,
        groundingRejections: extras.groundingRejections ?? [],
        groundingFailure: extras.groundingFailure ?? null,
        stage,
        reason,
        intentPath: parsed.intentPath,
        intentWritten: false,
        intentVerified: false,
        frozenCandidateCount: 0,
        coverage: coverageMeta,
        db: { before, after },
        plans: [],
      }),
    );

  if (result.status === "already_covered") {
    return blocked(
      "already_covered",
      result.reason,
      "eligibility",
      result.reason,
    );
  }
  if (result.status === "blocked") {
    return blocked(
      result.stage === "eligibility" ? "blocked" : "eligible",
      result.stage === "eligibility" ? result.reason : null,
      result.stage,
      result.reason,
      {
        adapterActions: result.adapterActions,
        actionsEnteringGrounding: result.actionsEnteringGrounding,
        groundedActions: result.groundedActions,
        groundedCandidates: result.groundedCandidates,
        groundingRejectedCount: result.groundingRejectedCount,
        groundingRejections: result.groundingRejections,
        groundingFailure: result.groundingFailure,
      },
    );
  }

  const newPlans = newCandidatePlansFromGatedResult(result);
  const diagnosticPlans =
    result.status === "planned" && result.planResult.status === "planned"
      ? result.planResult.plans.map(diagnosticPlanRow)
      : [];
  const kinds = countKinds(diagnosticPlans);
  const actionCount =
    result.planResult.status === "blocked"
      ? 0
      : result.planResult.candidatesExtracted;
  const planningCounts = planningCountsFromGated(result);

  if (newPlans.length === 0) {
    return finish(
      baseReport({
        classification: REAL_FROZEN_NEW_ASSESSMENT_NO_NEW_CANDIDATES,
        sessionId: parsed.sessionId,
        executedAt,
        eligibility: "eligible",
        eligibilityReason: null,
        userMessageCount: evidenceMeta.userMessageCount,
        userEvidenceUnitCount: evidenceMeta.userEvidenceUnitCount,
        model: usedModel,
        sessionExecutions: 1,
        generateStructuredCalls,
        coverageRepairCalls,
        actionCount,
        plansTotal: diagnosticPlans.length,
        ...kinds,
        newCount: 0,
        ...planningCounts,
        providerStructuredActions,
        stage: null,
        reason: "no_new_candidates",
        intentPath: parsed.intentPath,
        intentWritten: false,
        intentVerified: false,
        frozenCandidateCount: 0,
        coverage: coverageMeta,
        db: { before, after },
        plans: diagnosticPlans,
      }),
    );
  }

  if (!coverage.ok) {
    return blocked("blocked", coverage.code, "eligibility", coverage.code);
  }

  const frozen = freezeNewAssessmentIntent({
    sessionId: parsed.sessionId,
    plans: newPlans,
    source: {
      model: usedModel,
      promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
      coverageSourceHash: coverage.coverage.sourceHash,
    },
    outputPath: parsed.intentPath,
    now: () => executedAt,
    writeIntent: deps.writeIntent,
  });

  const intentBlocked = (
    reason: string,
    intentWritten: boolean,
    intentVerified: boolean,
  ) =>
    finish(
      baseReport({
        classification: REAL_FROZEN_NEW_ASSESSMENT_INTENT_BLOCKED,
        sessionId: parsed.sessionId,
        executedAt,
        eligibility: "eligible",
        eligibilityReason: null,
        userMessageCount: evidenceMeta.userMessageCount,
        userEvidenceUnitCount: evidenceMeta.userEvidenceUnitCount,
        model: usedModel,
        sessionExecutions: 1,
        generateStructuredCalls,
        coverageRepairCalls,
        actionCount,
        plansTotal: diagnosticPlans.length,
        ...kinds,
        stage: "intent",
        reason,
        intentPath: parsed.intentPath,
        intentWritten,
        intentVerified,
        frozenCandidateCount: newPlans.length,
        coverage: coverageMeta,
        db: { before, after },
        plans: diagnosticPlans,
        ...planningCounts,
        providerStructuredActions,
      }),
    );

  if (!frozen.ok) {
    return intentBlocked(frozen.code, false, false);
  }

  const intentReader =
    deps.readIntentFile ??
    ((path: string) => readFileSync(resolve(path), "utf8"));
  let loaded: ReturnType<typeof loadNewAssessmentIntent>;
  try {
    loaded = loadNewAssessmentIntent(intentReader(parsed.intentPath));
  } catch {
    return intentBlocked("intent_reload_failed", true, false);
  }

  if (!loaded.ok) {
    return intentBlocked(loaded.code, true, false);
  }

  const replayed = intentToNewCandidatePlans(loaded.intent).map(
    freezeNewCandidatePlan,
  );
  const original = newPlans.map(freezeNewCandidatePlan);
  if (!candidatesDeepEqual(original, replayed)) {
    return intentBlocked("lossless_replay_failed", true, false);
  }

  return finish(
    baseReport({
      classification: REAL_FROZEN_NEW_ASSESSMENT_INTENT_READY,
      sessionId: parsed.sessionId,
      executedAt,
      eligibility: "eligible",
      eligibilityReason: null,
      userMessageCount: evidenceMeta.userMessageCount,
      userEvidenceUnitCount: evidenceMeta.userEvidenceUnitCount,
      model: usedModel,
      sessionExecutions: 1,
      generateStructuredCalls,
      coverageRepairCalls,
      actionCount,
      plansTotal: diagnosticPlans.length,
      ...kinds,
      stage: null,
      reason: null,
      intentPath: parsed.intentPath,
      intentWritten: true,
      intentVerified: true,
      frozenCandidateCount: newPlans.length,
      coverage: coverageMeta,
      db: { before, after },
      plans: diagnosticPlans,
      ...planningCounts,
      providerStructuredActions,
    }),
  );
}
