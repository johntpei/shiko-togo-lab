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
import {
  INCREMENTAL_MATCH_REASONS,
  type ExistingMatchPlan,
  type IncrementalConceptPlan,
  type IncrementalMatchReason,
} from "./plan";

export const CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_VERSION =
  "concept-incremental-existing-append-intent-v1";
export const CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_MODE =
  "existing_match_append";
export const CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_DEFAULT_PATH =
  "data/concept-incremental-existing-append-intent-v1.json";

export type ExistingMatchAppendIntentSource = {
  model: string | null;
  promptVersion: string;
  extractionVersion: string;
  coverageSourceHash: string;
};

export type ExistingMatchAppendIntentMetadata = {
  version: typeof CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_VERSION;
  mode: typeof CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_MODE;
  sessionId: string;
  source: ExistingMatchAppendIntentSource;
  generatedAt: string;
  contentHash: string;
};

export type ExistingMatchAppendIntent = {
  metadata: ExistingMatchAppendIntentMetadata;
  plans: ExistingMatchPlan[];
};

export type BuildExistingMatchAppendIntentInput = {
  sessionId: string;
  plans: IncrementalConceptPlan[];
  source: ExistingMatchAppendIntentSource;
  now?: () => string;
};

export type BuildExistingMatchAppendIntentResult =
  | { ok: true; intent: ExistingMatchAppendIntent }
  | { ok: false; code: "no_existing_matches"; detail: string }
  | { ok: false; code: "invalid_plan"; detail: string };

export type LoadExistingMatchAppendIntentResult =
  | { ok: true; intent: ExistingMatchAppendIntent }
  | { ok: false; code: string; detail: string };

function isMatchReason(value: string): value is IncrementalMatchReason {
  return (INCREMENTAL_MATCH_REASONS as readonly string[]).includes(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function freezeExistingMatchPlan(plan: ExistingMatchPlan): ExistingMatchPlan {
  return {
    kind: "existing_match",
    candidateRef: plan.candidateRef,
    conceptId: plan.conceptId,
    matchReason: plan.matchReason,
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

export function existingMatchPlansFromGatedResult(
  result: EligibilityGatedIncrementalSessionResult,
): ExistingMatchPlan[] {
  if (result.status !== "planned" || result.planResult.status !== "planned") {
    return [];
  }
  return result.planResult.plans
    .filter((plan): plan is ExistingMatchPlan => plan.kind === "existing_match")
    .map(freezeExistingMatchPlan);
}

function validateExistingMatchPlan(
  plan: ExistingMatchPlan,
  sessionId: string,
  extractionVersion: string,
): { ok: true } | { ok: false; detail: string } {
  if (plan.kind !== "existing_match") {
    return { ok: false, detail: `kind:${String(plan.kind)}` };
  }
  if (!isMatchReason(plan.matchReason)) {
    return { ok: false, detail: `matchReason:${plan.matchReason}` };
  }
  if (!nonempty(plan.candidateRef)) {
    return { ok: false, detail: "candidateRef" };
  }
  if (!nonempty(plan.conceptId)) {
    return { ok: false, detail: "conceptId" };
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
  if (
    !(CONCEPT_SOURCE_ROLES as readonly string[]).includes(provenance.sourceRole)
  ) {
    return { ok: false, detail: `sourceRole:${provenance.sourceRole}` };
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

function validateSource(source: ExistingMatchAppendIntentSource) {
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

export function existingMatchAppendIntentContentHashPayload(input: {
  sessionId: string;
  source: ExistingMatchAppendIntentSource;
  plans: ExistingMatchPlan[];
}) {
  return {
    metadata: {
      version: CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_VERSION,
      mode: CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_MODE,
      sessionId: input.sessionId,
      source: {
        model: input.source.model,
        promptVersion: input.source.promptVersion,
        extractionVersion: input.source.extractionVersion,
        coverageSourceHash: input.source.coverageSourceHash,
      },
    },
    plans: input.plans,
  };
}

/**
 * in-memory Planner ExistingMatchPlan[] だけを Frozen Intent にする。
 * Identity Resolution は再実行しない。provisional_new / new は捨てる。
 */
export function buildExistingMatchAppendIntent(
  input: BuildExistingMatchAppendIntentInput,
): BuildExistingMatchAppendIntentResult {
  if (!nonempty(input.sessionId)) {
    return { ok: false, code: "invalid_plan", detail: "sessionId" };
  }
  const sourceError = validateSource(input.source);
  if (sourceError) {
    return { ok: false, code: "invalid_plan", detail: sourceError };
  }

  const existing = input.plans.filter(
    (plan): plan is ExistingMatchPlan => plan.kind === "existing_match",
  );
  if (existing.length === 0) {
    return {
      ok: false,
      code: "no_existing_matches",
      detail: "existing_match=0",
    };
  }

  const frozen: ExistingMatchPlan[] = [];
  for (const plan of existing) {
    const copied = freezeExistingMatchPlan(plan);
    const validated = validateExistingMatchPlan(
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
    existingMatchAppendIntentContentHashPayload({
      sessionId: input.sessionId,
      source: input.source,
      plans: frozen,
    }),
  );
  return {
    ok: true,
    intent: {
      metadata: {
        version: CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_VERSION,
        mode: CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_MODE,
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
      plans: frozen,
    },
  };
}

export function intentToExistingMatchPlans(
  intent: ExistingMatchAppendIntent,
): ExistingMatchPlan[] {
  return intent.plans.map(freezeExistingMatchPlan);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parsePlan(value: unknown): ExistingMatchPlan | null {
  const row = asRecord(value);
  if (!row) {
    return null;
  }
  const provenance = asRecord(row.provenance);
  if (!provenance) {
    return null;
  }
  if (row.kind !== "existing_match") {
    return null;
  }
  if (typeof row.candidateRef !== "string") {
    return null;
  }
  if (typeof row.conceptId !== "string") {
    return null;
  }
  if (typeof row.matchReason !== "string") {
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
  return freezeExistingMatchPlan({
    kind: "existing_match",
    candidateRef: row.candidateRef,
    conceptId: row.conceptId,
    matchReason: row.matchReason as IncrementalMatchReason,
    canonicalLabel: row.canonicalLabel,
    normalizedKey: row.normalizedKey,
    provenance: {
      sessionId: provenance.sessionId,
      messageId: provenance.messageId,
      evidenceRef: provenance.evidenceRef,
      occurredAt: provenance.occurredAt,
      surfaceForm: provenance.surfaceForm,
      sourceRole: provenance.sourceRole as ExistingMatchPlan["provenance"]["sourceRole"],
      sourceType: provenance.sourceType as ExistingMatchPlan["provenance"]["sourceType"],
      extractionVersion: provenance.extractionVersion as ExistingMatchPlan["provenance"]["extractionVersion"],
    },
  });
}

/**
 * Frozen Intent の構造 / hash / required fields を検証する。
 * real DB Identity / provenance は見ない（3C-2c preflight の責務）。
 */
export function loadExistingMatchAppendIntent(
  text: string,
): LoadExistingMatchAppendIntentResult {
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
  if (metadata.version !== CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_VERSION) {
    return {
      ok: false,
      code: "intent_version",
      detail: String(metadata.version ?? ""),
    };
  }
  if (metadata.mode !== CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_MODE) {
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
  const source: ExistingMatchAppendIntentSource = {
    model: sourceRow.model == null ? null : String(sourceRow.model),
    promptVersion: String(sourceRow.promptVersion ?? ""),
    extractionVersion: String(sourceRow.extractionVersion ?? ""),
    coverageSourceHash: String(sourceRow.coverageSourceHash ?? ""),
  };
  const sourceError = validateSource(source);
  if (sourceError) {
    return { ok: false, code: "invalid_plan", detail: sourceError };
  }
  if (!Array.isArray(root.plans) || root.plans.length === 0) {
    return { ok: false, code: "no_existing_matches", detail: "plans" };
  }

  const plans: ExistingMatchPlan[] = [];
  for (const [index, item] of root.plans.entries()) {
    const parsed = parsePlan(item);
    if (!parsed) {
      return { ok: false, code: "invalid_plan", detail: `plans[${index}]` };
    }
    const validated = validateExistingMatchPlan(
      parsed,
      sessionId,
      source.extractionVersion,
    );
    if (!validated.ok) {
      return { ok: false, code: "invalid_plan", detail: validated.detail };
    }
    plans.push(parsed);
  }

  const expectedHash = hashJsonContent(
    existingMatchAppendIntentContentHashPayload({
      sessionId,
      source,
      plans,
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
        version: CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_VERSION,
        mode: CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_MODE,
        sessionId,
        source,
        generatedAt: nonempty(metadata.generatedAt)
          ? metadata.generatedAt
          : "",
        contentHash,
      },
      plans,
    },
  };
}

export function writeExistingMatchAppendIntentFile(
  path: string,
  intent: ExistingMatchAppendIntent,
) {
  atomicWriteJsonFile(path, intent);
}

export function freezeExistingMatchAppendIntent(input: {
  sessionId: string;
  plans: IncrementalConceptPlan[];
  source: ExistingMatchAppendIntentSource;
  outputPath: string;
  now?: () => string;
  writeIntent?: (path: string, intent: ExistingMatchAppendIntent) => void;
}):
  | { ok: true; intent: ExistingMatchAppendIntent; outputPath: string }
  | { ok: false; code: string; detail: string } {
  const built = buildExistingMatchAppendIntent({
    sessionId: input.sessionId,
    plans: input.plans,
    source: input.source,
    now: input.now,
  });
  if (!built.ok) {
    return built;
  }
  const writer = input.writeIntent ?? writeExistingMatchAppendIntentFile;
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

export function readExistingMatchAppendIntentFile(path: string) {
  return loadExistingMatchAppendIntent(readFileSync(resolve(path), "utf8"));
}
