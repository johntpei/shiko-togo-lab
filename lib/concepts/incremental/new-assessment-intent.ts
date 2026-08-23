import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { atomicWriteJsonFile } from "@/lib/concepts/admission/apply-result";
import { hashJsonContent } from "@/lib/concepts/admission/canonical-json";
import {
  CONCEPT_EXTRACTION_VERSION,
  CONCEPT_SOURCE_ROLES,
  CONCEPT_SOURCE_TYPES,
} from "@/lib/concepts/types";
import type { EligibilityGatedIncrementalSessionResult } from "./eligible-session-plan";
import type {
  IncrementalConceptPlan,
  NewCandidatePlan,
} from "./plan";

export const CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_VERSION =
  "concept-incremental-new-assessment-intent-v1";
export const CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_MODE =
  "new_candidate_assessment";
export const CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_DEFAULT_PATH =
  "data/concept-incremental-new-assessment-intent-v1.json";

export type NewAssessmentIntentSource = {
  model: string | null;
  promptVersion: string;
  extractionVersion: string;
  coverageSourceHash: string;
};

export type NewAssessmentIntentMetadata = {
  version: typeof CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_VERSION;
  mode: typeof CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_MODE;
  sessionId: string;
  source: NewAssessmentIntentSource;
  generatedAt: string;
  contentHash: string;
};

export type NewAssessmentIntent = {
  metadata: NewAssessmentIntentMetadata;
  candidates: NewCandidatePlan[];
};

export type FrozenNewCandidate = NewCandidatePlan;

export type BuildNewAssessmentIntentInput = {
  sessionId: string;
  plans: IncrementalConceptPlan[];
  source: NewAssessmentIntentSource;
  now?: () => string;
};

export type BuildNewAssessmentIntentResult =
  | { ok: true; intent: NewAssessmentIntent }
  | { ok: false; code: "no_new_candidates"; detail: string }
  | { ok: false; code: "invalid_plan"; detail: string };

export type LoadNewAssessmentIntentResult =
  | { ok: true; intent: NewAssessmentIntent }
  | { ok: false; code: string; detail: string };

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Server Grounding 済み NewCandidatePlan の identity / provenance だけをコピーする。
 * USER 本文・Evidence 本文・frequency・Policy / Assessment 結果は持たない。
 */
export function freezeNewCandidatePlan(plan: NewCandidatePlan): NewCandidatePlan {
  return {
    kind: "new",
    candidateRef: plan.candidateRef,
    canonicalLabel: plan.canonicalLabel,
    normalizedKey: plan.normalizedKey,
    provenance: {
      sessionId: plan.provenance.sessionId,
      messageId: plan.provenance.messageId,
      evidenceRef: plan.provenance.evidenceRef,
      occurredAt: plan.provenance.occurredAt,
      surfaceForm: plan.provenance.surfaceForm,
      sourceRole: plan.provenance.sourceRole,
      sourceType: plan.provenance.sourceType,
      extractionVersion: plan.provenance.extractionVersion,
    },
  };
}

export function newCandidatePlansFromGatedResult(
  result: EligibilityGatedIncrementalSessionResult,
): NewCandidatePlan[] {
  if (result.status !== "planned" || result.planResult.status !== "planned") {
    return [];
  }
  return result.planResult.plans
    .filter((plan): plan is NewCandidatePlan => plan.kind === "new")
    .map(freezeNewCandidatePlan);
}

function validateNewCandidatePlan(
  plan: NewCandidatePlan,
  sessionId: string,
  extractionVersion: string,
): { ok: true } | { ok: false; detail: string } {
  if (plan.kind !== "new") {
    return { ok: false, detail: `kind:${String(plan.kind)}` };
  }
  if (!nonempty(plan.candidateRef)) {
    return { ok: false, detail: "candidateRef" };
  }
  if (!nonempty(plan.canonicalLabel)) {
    return { ok: false, detail: "canonicalLabel" };
  }
  if (!nonempty(plan.normalizedKey)) {
    return { ok: false, detail: "normalizedKey" };
  }
  const provenance = plan.provenance;
  if (provenance.sessionId !== sessionId) {
    return {
      ok: false,
      detail: `sessionId:${provenance.sessionId}!=${sessionId}`,
    };
  }
  if (!nonempty(provenance.messageId)) {
    return { ok: false, detail: "messageId" };
  }
  if (!nonempty(provenance.evidenceRef)) {
    return { ok: false, detail: "evidenceRef" };
  }
  if (!nonempty(provenance.occurredAt)) {
    return { ok: false, detail: "occurredAt" };
  }
  if (!nonempty(provenance.surfaceForm)) {
    return { ok: false, detail: "surfaceForm" };
  }
  if (provenance.sourceRole !== "user") {
    return { ok: false, detail: `sourceRole:${provenance.sourceRole}` };
  }
  if (
    !(CONCEPT_SOURCE_ROLES as readonly string[]).includes(provenance.sourceRole)
  ) {
    return { ok: false, detail: `sourceRole:${provenance.sourceRole}` };
  }
  if (provenance.sourceType !== "evidence_unit") {
    return { ok: false, detail: `sourceType:${provenance.sourceType}` };
  }
  if (
    !(CONCEPT_SOURCE_TYPES as readonly string[]).includes(provenance.sourceType)
  ) {
    return { ok: false, detail: `sourceType:${provenance.sourceType}` };
  }
  if (provenance.extractionVersion !== CONCEPT_EXTRACTION_VERSION) {
    return {
      ok: false,
      detail: `extractionVersion:${provenance.extractionVersion}`,
    };
  }
  if (provenance.extractionVersion !== extractionVersion) {
    return {
      ok: false,
      detail: `source.extractionVersion:${extractionVersion}`,
    };
  }
  return { ok: true };
}

function validateSource(source: NewAssessmentIntentSource) {
  if (!nonempty(source.promptVersion)) {
    return "promptVersion";
  }
  if (!nonempty(source.extractionVersion)) {
    return "extractionVersion";
  }
  if (!nonempty(source.coverageSourceHash)) {
    return "coverageSourceHash";
  }
  if (source.model != null && typeof source.model !== "string") {
    return "model";
  }
  return null;
}

export function newAssessmentIntentContentHashPayload(input: {
  sessionId: string;
  source: NewAssessmentIntentSource;
  candidates: NewCandidatePlan[];
}) {
  return {
    metadata: {
      version: CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_VERSION,
      mode: CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_MODE,
      sessionId: input.sessionId,
      source: {
        model: input.source.model,
        promptVersion: input.source.promptVersion,
        extractionVersion: input.source.extractionVersion,
        coverageSourceHash: input.source.coverageSourceHash,
      },
    },
    candidates: input.candidates,
  };
}

/**
 * in-memory Planner IncrementalConceptPlan[] から kind=new だけを Frozen Intent にする.
 * Identity / Assessment / Policy は再実行しない.
 * existing_match / provisional_new は捨てる（昇格しない）.
 */
export function buildNewAssessmentIntent(
  input: BuildNewAssessmentIntentInput,
): BuildNewAssessmentIntentResult {
  if (!nonempty(input.sessionId)) {
    return { ok: false, code: "invalid_plan", detail: "sessionId" };
  }
  const sourceError = validateSource(input.source);
  if (sourceError) {
    return { ok: false, code: "invalid_plan", detail: sourceError };
  }

  const news = input.plans.filter(
    (plan): plan is NewCandidatePlan => plan.kind === "new",
  );
  if (news.length === 0) {
    return {
      ok: false,
      code: "no_new_candidates",
      detail: "new=0",
    };
  }

  const frozen: NewCandidatePlan[] = [];
  for (const plan of news) {
    const copied = freezeNewCandidatePlan(plan);
    const validated = validateNewCandidatePlan(
      copied,
      input.sessionId,
      input.source.extractionVersion,
    );
    if (!validated.ok) {
      return { ok: false, code: "invalid_plan", detail: validated.detail };
    }
    frozen.push(copied);
  }

  const generatedAt = (input.now ?? (() => new Date().toISOString()))();
  const contentHash = hashJsonContent(
    newAssessmentIntentContentHashPayload({
      sessionId: input.sessionId,
      source: input.source,
      candidates: frozen,
    }),
  );
  return {
    ok: true,
    intent: {
      metadata: {
        version: CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_VERSION,
        mode: CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_MODE,
        sessionId: input.sessionId,
        source: {
          model: input.source.model,
          promptVersion: input.source.promptVersion,
          extractionVersion: input.source.extractionVersion,
          coverageSourceHash: input.source.coverageSourceHash,
        },
        generatedAt,
        contentHash,
      },
      candidates: frozen,
    },
  };
}

export function intentToNewCandidatePlans(
  intent: NewAssessmentIntent,
): FrozenNewCandidate[] {
  return intent.candidates.map(freezeNewCandidatePlan);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseCandidate(value: unknown): NewCandidatePlan | null {
  const row = asRecord(value);
  if (!row) {
    return null;
  }
  const provenance = asRecord(row.provenance);
  if (!provenance) {
    return null;
  }
  if (row.kind !== "new") {
    return null;
  }
  if (typeof row.candidateRef !== "string") {
    return null;
  }
  if (typeof row.canonicalLabel !== "string") {
    return null;
  }
  if (typeof row.normalizedKey !== "string") {
    return null;
  }
  if (typeof provenance.sessionId !== "string") {
    return null;
  }
  if (typeof provenance.messageId !== "string") {
    return null;
  }
  if (typeof provenance.evidenceRef !== "string") {
    return null;
  }
  if (typeof provenance.occurredAt !== "string") {
    return null;
  }
  if (typeof provenance.surfaceForm !== "string") {
    return null;
  }
  if (typeof provenance.sourceRole !== "string") {
    return null;
  }
  if (typeof provenance.sourceType !== "string") {
    return null;
  }
  if (typeof provenance.extractionVersion !== "string") {
    return null;
  }
  return freezeNewCandidatePlan({
    kind: "new",
    candidateRef: row.candidateRef,
    canonicalLabel: row.canonicalLabel,
    normalizedKey: row.normalizedKey,
    provenance: {
      sessionId: provenance.sessionId,
      messageId: provenance.messageId,
      evidenceRef: provenance.evidenceRef,
      occurredAt: provenance.occurredAt,
      surfaceForm: provenance.surfaceForm,
      sourceRole: provenance.sourceRole as NewCandidatePlan["provenance"]["sourceRole"],
      sourceType: provenance.sourceType as NewCandidatePlan["provenance"]["sourceType"],
      extractionVersion:
        provenance.extractionVersion as NewCandidatePlan["provenance"]["extractionVersion"],
    },
  });
}

/**
 * Frozen NEW Assessment Intent の構造 / hash / required fields を検証する。
 * Assessment / Policy / real DB Evidence 解決は次 STEP の責務。
 */
export function loadNewAssessmentIntent(
  text: string,
): LoadNewAssessmentIntentResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "malformed_intent", detail: "json" };
  }
  const root = asRecord(raw);
  const metadata = asRecord(root?.metadata);
  if (!root || !metadata) {
    return { ok: false, code: "malformed_intent", detail: "object" };
  }
  if (metadata.version !== CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_VERSION) {
    return {
      ok: false,
      code: "intent_version",
      detail: String(metadata.version ?? ""),
    };
  }
  if (metadata.mode !== CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_MODE) {
    return {
      ok: false,
      code: "intent_mode",
      detail: String(metadata.mode ?? ""),
    };
  }
  const sessionId = metadata.sessionId;
  if (!nonempty(sessionId)) {
    return { ok: false, code: "invalid_plan", detail: "sessionId" };
  }
  const sourceRow = asRecord(metadata.source);
  if (!sourceRow) {
    return { ok: false, code: "malformed_intent", detail: "source" };
  }
  const source: NewAssessmentIntentSource = {
    model: sourceRow.model == null ? null : String(sourceRow.model),
    promptVersion: String(sourceRow.promptVersion ?? ""),
    extractionVersion: String(sourceRow.extractionVersion ?? ""),
    coverageSourceHash: String(sourceRow.coverageSourceHash ?? ""),
  };
  const sourceError = validateSource(source);
  if (sourceError) {
    return { ok: false, code: "invalid_plan", detail: sourceError };
  }
  if (!Array.isArray(root.candidates) || root.candidates.length === 0) {
    return { ok: false, code: "no_new_candidates", detail: "candidates" };
  }

  const candidates: NewCandidatePlan[] = [];
  for (const [index, item] of root.candidates.entries()) {
    const parsed = parseCandidate(item);
    if (!parsed) {
      return { ok: false, code: "invalid_plan", detail: `candidates[${index}]` };
    }
    const validated = validateNewCandidatePlan(
      parsed,
      sessionId,
      source.extractionVersion,
    );
    if (!validated.ok) {
      return { ok: false, code: "invalid_plan", detail: validated.detail };
    }
    candidates.push(parsed);
  }

  const expectedHash = hashJsonContent(
    newAssessmentIntentContentHashPayload({
      sessionId,
      source,
      candidates,
    }),
  );
  const contentHash = metadata.contentHash;
  if (!nonempty(contentHash) || contentHash !== expectedHash) {
    return { ok: false, code: "content_hash", detail: String(contentHash ?? "") };
  }

  return {
    ok: true,
    intent: {
      metadata: {
        version: CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_VERSION,
        mode: CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_MODE,
        sessionId,
        source,
        generatedAt: nonempty(metadata.generatedAt)
          ? metadata.generatedAt
          : "",
        contentHash,
      },
      candidates,
    },
  };
}

export function writeNewAssessmentIntentFile(
  path: string,
  intent: NewAssessmentIntent,
) {
  atomicWriteJsonFile(path, intent);
}

export function freezeNewAssessmentIntent(input: {
  sessionId: string;
  plans: IncrementalConceptPlan[];
  source: NewAssessmentIntentSource;
  outputPath: string;
  now?: () => string;
  writeIntent?: (path: string, intent: NewAssessmentIntent) => void;
}):
  | { ok: true; intent: NewAssessmentIntent; outputPath: string }
  | { ok: false; code: string; detail: string } {
  const built = buildNewAssessmentIntent({
    sessionId: input.sessionId,
    plans: input.plans,
    source: input.source,
    now: input.now,
  });
  if (!built.ok) {
    return built;
  }
  const writer = input.writeIntent ?? writeNewAssessmentIntentFile;
  try {
    writer(input.outputPath, built.intent);
  } catch (error) {
    return {
      ok: false,
      code: "write_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    ok: true,
    intent: built.intent,
    outputPath: resolve(input.outputPath),
  };
}

export function readNewAssessmentIntentFile(path: string) {
  return loadNewAssessmentIntent(readFileSync(resolve(path), "utf8"));
}
