import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { asc, eq } from "drizzle-orm";
import { toEvidenceRole } from "@/lib/ai/evidence-units";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import type { AiProvider } from "@/lib/ai/provider";
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
import { planEligibleIncrementalSession } from "./eligible-session-plan";
import { loadInitialConceptProcessingCoverage } from "./eligibility";
import { createProductionIncrementalCandidateExtractor } from "./extract";
import { sourceCandidateReportHashFromManifestText } from "./pilot-preflight";
import type {
  ExistingMatchPlan,
  IncrementalConceptPlan,
  NewCandidatePlan,
  ProvisionalNewPlan,
} from "./plan";

export const CONCEPT_INCREMENTAL_LLM_PILOT_DEFAULT_OUTPUT =
  "data/concept-incremental-pilot-result-v1.json";

export const CONCEPT_INCREMENTAL_LLM_PILOT_APPLY_ERROR =
  "incremental LLM pilot is read-only; --apply is not accepted";

export const CONCEPT_INCREMENTAL_LLM_PILOT_HELP = `Usage:
  npm run concept:incremental-pilot -- --session <sessionId> [--candidates <path>] [--manifest <path>] [--output <path>]

Read-only Incremental LLM pilot for exactly one explicit Session.
Does not INSERT / UPDATE / DELETE. Does not append Occurrences.
--apply is not accepted. Session auto-selection is not accepted.
`;

export const INCREMENTAL_LLM_PILOT_CLASSIFICATIONS = [
  "REAL_INCREMENTAL_LLM_PILOT_PLANNED",
  "REAL_INCREMENTAL_LLM_PILOT_NO_OP",
  "REAL_INCREMENTAL_LLM_PILOT_BLOCKED",
] as const;

export type IncrementalLlmPilotClassification =
  (typeof INCREMENTAL_LLM_PILOT_CLASSIFICATIONS)[number];

export type IncrementalLlmPilotArgs = {
  apply: boolean;
  malformed: boolean;
  malformedReason: string | null;
  sessionId: string | null;
  candidatesPath: string;
  manifestPath: string;
  outputPath: string;
};

export type IncrementalLlmPilotDbCounts = {
  concepts: number;
  conceptAliases: number;
  conceptOccurrences: number;
  sessions: number;
  messages: number;
};

export type IncrementalLlmPilotPlanRow = {
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
  provisionalReason: ProvisionalNewPlan["provisionalReason"] | null;
};

export type IncrementalLlmPilotReport = {
  classification: IncrementalLlmPilotClassification;
  status: "planned" | "no_op" | "blocked";
  sessionId: string | null;
  executedAt: string;
  model: string | null;
  promptVersion: string;
  extractionVersion: string;
  eligibility: "eligible" | "already_covered" | "blocked" | "unresolved";
  eligibilityReason: string | null;
  userMessageCount: number | null;
  userEvidenceUnitCount: number | null;
  actionCount: number;
  plansTotal: number;
  existingMatchCount: number;
  exactCanonicalCount: number;
  uniqueObservedAliasCount: number;
  newCount: number;
  provisionalNewCount: number;
  sessionExecutions: number;
  generateStructuredCalls: number;
  coverageRepairCalls: number;
  providerCallCount: number;
  stage: "eligibility" | "planning" | null;
  reason: string | null;
  coverage: {
    ok: boolean;
    sourceHash: string | null;
    expectedSourceHash: string | null;
    extractPromptVersion: string | null;
    extractionVersion: string | null;
  };
  db: {
    before: IncrementalLlmPilotDbCounts;
    after: IncrementalLlmPilotDbCounts;
  };
  plans: IncrementalLlmPilotPlanRow[];
};

export type IncrementalLlmPilotDeps = {
  openDb: (dbPath: string) => ConceptQueryDb;
  generateStructured: AiProvider["generateStructured"];
  dbPath?: string;
  readFile?: (path: string) => string;
  writeReport?: (path: string, payload: unknown) => void;
  now?: () => string;
  model?: string | null;
};

function snapshotDbCounts(db: ConceptQueryDb): IncrementalLlmPilotDbCounts {
  return {
    concepts: countConcepts(db),
    conceptAliases: countConceptAliases(db),
    conceptOccurrences: countConceptOccurrences(db),
    sessions: db.select().from(sessions).all().length,
    messages: db.select().from(messages).all().length,
  };
}

function loadSessionMessages(db: ConceptQueryDb, sessionId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.index))
    .all();
}

function sessionEvidenceMeta(
  db: ConceptQueryDb,
  sessionId: string,
): {
  userMessageCount: number | null;
  userEvidenceUnitCount: number | null;
} {
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

function safePlanRow(plan: IncrementalConceptPlan): IncrementalLlmPilotPlanRow {
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
      provisionalReason: null,
    };
  }
  if (plan.kind === "provisional_new") {
    return {
      ...base,
      conceptId: null,
      matchReason: null,
      provisionalConceptId: plan.provisionalConceptId ?? null,
      provisionalReason: plan.provisionalReason,
    };
  }
  const asNew = plan as NewCandidatePlan;
  return {
    ...base,
    candidateRef: asNew.candidateRef,
    conceptId: null,
    matchReason: null,
    provisionalConceptId: null,
    provisionalReason: null,
  };
}

function isCoverageRepairPrompt(user: string) {
  return user.includes("# Coverage repair");
}

export function parseConceptIncrementalLlmPilotArgs(
  argv: string[],
): IncrementalLlmPilotArgs {
  let apply = false;
  let malformed = false;
  let malformedReason: string | null = null;
  const sessionIds: string[] = [];
  let candidatesPath = CONCEPT_APPLY_DEFAULT_CANDIDATES;
  let manifestPath = CONCEPT_APPLY_DEFAULT_MANIFEST;
  let outputPath = CONCEPT_INCREMENTAL_LLM_PILOT_DEFAULT_OUTPUT;

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
    outputPath,
  };
}

export function writeIncrementalLlmPilotReportFile(
  path: string,
  payload: unknown,
) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function incrementalLlmPilotReportPayload(
  report: IncrementalLlmPilotReport,
) {
  return report;
}

export function formatIncrementalLlmPilotSummary(
  report: IncrementalLlmPilotReport,
) {
  const lines = [
    report.classification,
    `status: ${report.status}`,
    `sessionId: ${report.sessionId ?? "(none)"}`,
    `eligibility: ${report.eligibility}${report.eligibilityReason ? ` (${report.eligibilityReason})` : ""}`,
    `userMessages: ${report.userMessageCount ?? "null"} userEvidenceUnits: ${report.userEvidenceUnitCount ?? "null"}`,
    `model: ${report.model ?? "(none)"} prompt=${report.promptVersion} extraction=${report.extractionVersion}`,
    `coverage: ok=${report.coverage.ok}`,
    `sessionExecutions: ${report.sessionExecutions}`,
    `generateStructuredCalls: ${report.generateStructuredCalls}`,
    `coverageRepairCalls: ${report.coverageRepairCalls}`,
    `actions: ${report.actionCount} plans: ${report.plansTotal}`,
    `existing_match: ${report.existingMatchCount} exact_canonical: ${report.exactCanonicalCount} unique_observed_alias: ${report.uniqueObservedAliasCount}`,
    `new: ${report.newCount} provisional_new: ${report.provisionalNewCount}`,
  ];
  if (report.reason) {
    lines.push(`reason: ${report.reason}`);
  }
  for (const plan of report.plans) {
    lines.push(
      `  plan ${plan.kind} evidenceRef=${plan.evidenceRef} conceptId=${plan.conceptId ?? "null"} matchReason=${plan.matchReason ?? "null"} provisionalConceptId=${plan.provisionalConceptId ?? "null"}`,
    );
  }
  lines.push("Occurrence append / Assessment / Policy / Concept create were not run.");
  return lines.join("\n");
}

function blockedReport(input: {
  sessionId: string | null;
  executedAt: string;
  model: string | null;
  eligibility: IncrementalLlmPilotReport["eligibility"];
  eligibilityReason: string | null;
  userMessageCount: number | null;
  userEvidenceUnitCount: number | null;
  sessionExecutions: number;
  generateStructuredCalls: number;
  coverageRepairCalls: number;
  stage: IncrementalLlmPilotReport["stage"];
  reason: string | null;
  coverage: IncrementalLlmPilotReport["coverage"];
  db: IncrementalLlmPilotReport["db"];
}): IncrementalLlmPilotReport {
  return {
    classification: "REAL_INCREMENTAL_LLM_PILOT_BLOCKED",
    status: "blocked",
    sessionId: input.sessionId,
    executedAt: input.executedAt,
    model: input.model,
    promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
    extractionVersion: CONCEPT_EXTRACTION_VERSION,
    eligibility: input.eligibility,
    eligibilityReason: input.eligibilityReason,
    userMessageCount: input.userMessageCount,
    userEvidenceUnitCount: input.userEvidenceUnitCount,
    actionCount: 0,
    plansTotal: 0,
    existingMatchCount: 0,
    exactCanonicalCount: 0,
    uniqueObservedAliasCount: 0,
    newCount: 0,
    provisionalNewCount: 0,
    sessionExecutions: input.sessionExecutions,
    generateStructuredCalls: input.generateStructuredCalls,
    coverageRepairCalls: input.coverageRepairCalls,
    providerCallCount: input.generateStructuredCalls,
    stage: input.stage,
    reason: input.reason,
    coverage: input.coverage,
    db: input.db,
    plans: [],
  };
}

export async function runConceptIncrementalLlmPilot(
  argv: string[],
  deps: IncrementalLlmPilotDeps,
): Promise<
  | { ok: true; report: IncrementalLlmPilotReport; summary: string }
  | { ok: false; code: string; error: string }
> {
  const parsed = parseConceptIncrementalLlmPilotArgs(argv);
  if (parsed.apply) {
    return {
      ok: false,
      code: "apply",
      error: CONCEPT_INCREMENTAL_LLM_PILOT_APPLY_ERROR,
    };
  }
  if (parsed.malformed || !parsed.sessionId) {
    return {
      ok: false,
      code: parsed.malformedReason ?? "malformed",
      error: CONCEPT_INCREMENTAL_LLM_PILOT_HELP,
    };
  }

  const reader =
    deps.readFile ?? ((path: string) => readFileSync(resolve(path), "utf8"));
  const executedAt = (deps.now ?? (() => new Date().toISOString()))();

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

  const dbPath = deps.dbPath ?? getDbPath();
  const db = deps.openDb(dbPath);
  const before = snapshotDbCounts(db);
  const evidenceMeta = sessionEvidenceMeta(db, parsed.sessionId);

  const coverageMeta = {
    ok: coverage.ok,
    sourceHash: coverage.ok ? coverage.coverage.sourceHash : null,
    expectedSourceHash: expectedHash.hash,
    extractPromptVersion: coverage.ok
      ? coverage.coverage.extractPromptVersion
      : null,
    extractionVersion: coverage.ok ? coverage.coverage.extractionVersion : null,
  };

  let generateStructuredCalls = 0;
  let coverageRepairCalls = 0;
  let usedModel = deps.model ?? null;
  const generateStructured: AiProvider["generateStructured"] = async (
    request,
  ) => {
    generateStructuredCalls += 1;
    if (isCoverageRepairPrompt(request.user)) {
      coverageRepairCalls += 1;
    }
    usedModel = request.model || usedModel;
    return deps.generateStructured(request);
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

  let report: IncrementalLlmPilotReport;
  if (result.status === "already_covered") {
    report = blockedReport({
      sessionId: result.sessionId,
      executedAt,
      model: usedModel,
      eligibility: "already_covered",
      eligibilityReason: result.reason,
      userMessageCount: evidenceMeta.userMessageCount,
      userEvidenceUnitCount: evidenceMeta.userEvidenceUnitCount,
      sessionExecutions: 1,
      generateStructuredCalls,
      coverageRepairCalls,
      stage: "eligibility",
      reason: result.reason,
      coverage: coverageMeta,
      db: { before, after },
    });
  } else if (result.status === "blocked") {
    report = blockedReport({
      sessionId: result.sessionId,
      executedAt,
      model: usedModel,
      eligibility:
        result.stage === "eligibility" ? "blocked" : "eligible",
      eligibilityReason:
        result.stage === "eligibility" ? result.reason : null,
      userMessageCount: evidenceMeta.userMessageCount,
      userEvidenceUnitCount: evidenceMeta.userEvidenceUnitCount,
      sessionExecutions: 1,
      generateStructuredCalls,
      coverageRepairCalls,
      stage: result.stage,
      reason: result.reason,
      coverage: coverageMeta,
      db: { before, after },
    });
  } else if (result.status === "no_op") {
    const actionCount =
      result.planResult.status === "blocked"
        ? 0
        : result.planResult.candidatesExtracted;
    report = {
      classification: "REAL_INCREMENTAL_LLM_PILOT_NO_OP",
      status: "no_op",
      sessionId: result.sessionId,
      executedAt,
      model: usedModel,
      promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
      eligibility: "eligible",
      eligibilityReason: null,
      userMessageCount: evidenceMeta.userMessageCount,
      userEvidenceUnitCount: evidenceMeta.userEvidenceUnitCount,
      actionCount,
      plansTotal: 0,
      existingMatchCount: 0,
      exactCanonicalCount: 0,
      uniqueObservedAliasCount: 0,
      newCount: 0,
      provisionalNewCount: 0,
      sessionExecutions: 1,
      generateStructuredCalls,
      coverageRepairCalls,
      providerCallCount: generateStructuredCalls,
      stage: null,
      reason: null,
      coverage: coverageMeta,
      db: { before, after },
      plans: [],
    };
  } else {
    const planResult = result.planResult;
    const plans =
      planResult.status === "planned" ? planResult.plans.map(safePlanRow) : [];
    const existing = plans.filter((plan) => plan.kind === "existing_match");
    report = {
      classification: "REAL_INCREMENTAL_LLM_PILOT_PLANNED",
      status: "planned",
      sessionId: result.sessionId,
      executedAt,
      model: usedModel,
      promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
      eligibility: "eligible",
      eligibilityReason: null,
      userMessageCount: evidenceMeta.userMessageCount,
      userEvidenceUnitCount: evidenceMeta.userEvidenceUnitCount,
      actionCount:
        planResult.status === "blocked" ? 0 : planResult.candidatesExtracted,
      plansTotal: plans.length,
      existingMatchCount: existing.length,
      exactCanonicalCount: existing.filter(
        (plan) => plan.matchReason === "exact_canonical",
      ).length,
      uniqueObservedAliasCount: existing.filter(
        (plan) => plan.matchReason === "unique_observed_alias",
      ).length,
      newCount: plans.filter((plan) => plan.kind === "new").length,
      provisionalNewCount: plans.filter(
        (plan) => plan.kind === "provisional_new",
      ).length,
      sessionExecutions: 1,
      generateStructuredCalls,
      coverageRepairCalls,
      providerCallCount: generateStructuredCalls,
      stage: null,
      reason: null,
      coverage: coverageMeta,
      db: { before, after },
      plans,
    };
  }

  const writer = deps.writeReport ?? writeIncrementalLlmPilotReportFile;
  writer(parsed.outputPath, incrementalLlmPilotReportPayload(report));
  return {
    ok: true,
    report,
    summary: formatIncrementalLlmPilotSummary(report),
  };
}
