import type { ExistingMatchAppendIntent } from "./append-intent";
import { loadExistingMatchAppendIntent } from "./append-intent";
import type { IncrementalConceptCompletionProof } from "./checkpoint";
import { CONCEPT_INCREMENTAL_PROCESSING_VERSION } from "./checkpoint";
import type { IncrementalNewAdmissionManifest } from "./new-admission-manifest";
import { validateIncrementalNewAdmissionManifest } from "./new-admission-manifest";
import type { NewAssessmentIntent } from "./new-assessment-intent";
import { loadNewAssessmentIntent } from "./new-assessment-intent";
import {
  INCREMENTAL_CONCEPT_SESSION_PREPARED_VERSION,
  type PreparedPlanningSummary,
} from "./session-run-types";

export type IncrementalConceptSessionPreparedPayload = {
  version: typeof INCREMENTAL_CONCEPT_SESSION_PREPARED_VERSION;
  sessionId: string;
  processingVersion: typeof CONCEPT_INCREMENTAL_PROCESSING_VERSION;
  planning: PreparedPlanningSummary;
  existingAppendIntent: ExistingMatchAppendIntent | null;
  newAssessmentIntent: NewAssessmentIntent | null;
  newAdmissionManifest: IncrementalNewAdmissionManifest | null;
};

export type BuildPreparedPayloadInput = {
  sessionId: string;
  planning: PreparedPlanningSummary;
  existingAppendIntent: ExistingMatchAppendIntent | null;
  newAssessmentIntent: NewAssessmentIntent | null;
  newAdmissionManifest: IncrementalNewAdmissionManifest | null;
};

export type ParsePreparedPayloadResult =
  | { ok: true; payload: IncrementalConceptSessionPreparedPayload }
  | { ok: false; code: string; detail: string };

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parsePlanning(value: unknown): PreparedPlanningSummary | null {
  const row = asRecord(value);
  if (!row) {
    return null;
  }
  const status = row.status;
  if (status !== "planned" && status !== "no_actions") {
    return null;
  }
  const existingMatchCount = row.existingMatchCount;
  const newCandidateCount = row.newCandidateCount;
  const provisionalNewCount = row.provisionalNewCount;
  const groundingRejectedCount = row.groundingRejectedCount;
  if (
    typeof existingMatchCount !== "number" ||
    typeof newCandidateCount !== "number" ||
    typeof provisionalNewCount !== "number" ||
    typeof groundingRejectedCount !== "number"
  ) {
    return null;
  }
  return {
    status,
    existingMatchCount,
    newCandidateCount,
    provisionalNewCount,
    groundingRejectedCount,
  };
}

export function buildIncrementalConceptSessionPreparedPayload(
  input: BuildPreparedPayloadInput,
): IncrementalConceptSessionPreparedPayload {
  return {
    version: INCREMENTAL_CONCEPT_SESSION_PREPARED_VERSION,
    sessionId: input.sessionId,
    processingVersion: CONCEPT_INCREMENTAL_PROCESSING_VERSION,
    planning: input.planning,
    existingAppendIntent: input.existingAppendIntent,
    newAssessmentIntent: input.newAssessmentIntent,
    newAdmissionManifest: input.newAdmissionManifest,
  };
}

export function serializePreparedPayload(
  payload: IncrementalConceptSessionPreparedPayload,
): string {
  return JSON.stringify(payload);
}

export function parsePreparedPayload(text: string): ParsePreparedPayloadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "malformed_prepared_payload", detail: "json" };
  }
  const root = asRecord(raw);
  if (!root) {
    return { ok: false, code: "malformed_prepared_payload", detail: "object" };
  }
  if (root.version !== INCREMENTAL_CONCEPT_SESSION_PREPARED_VERSION) {
    return {
      ok: false,
      code: "unsupported_prepared_version",
      detail: String(root.version ?? ""),
    };
  }
  const sessionId = root.sessionId;
  if (!nonempty(sessionId)) {
    return { ok: false, code: "invalid_prepared_payload", detail: "sessionId" };
  }
  if (root.processingVersion !== CONCEPT_INCREMENTAL_PROCESSING_VERSION) {
    return {
      ok: false,
      code: "unsupported_processing_version",
      detail: String(root.processingVersion ?? ""),
    };
  }
  const planning = parsePlanning(root.planning);
  if (!planning) {
    return { ok: false, code: "invalid_prepared_payload", detail: "planning" };
  }

  let existingAppendIntent: ExistingMatchAppendIntent | null = null;
  if (root.existingAppendIntent != null) {
    const loaded = loadExistingMatchAppendIntent(
      JSON.stringify(root.existingAppendIntent),
    );
    if (!loaded.ok) {
      return {
        ok: false,
        code: "invalid_prepared_payload",
        detail: `existing:${loaded.code}`,
      };
    }
    if (loaded.intent.metadata.sessionId !== sessionId) {
      return {
        ok: false,
        code: "invalid_prepared_payload",
        detail: "existing_session_mismatch",
      };
    }
    existingAppendIntent = loaded.intent;
  }

  let newAssessmentIntent: NewAssessmentIntent | null = null;
  if (root.newAssessmentIntent != null) {
    const loaded = loadNewAssessmentIntent(
      JSON.stringify(root.newAssessmentIntent),
    );
    if (!loaded.ok) {
      return {
        ok: false,
        code: "invalid_prepared_payload",
        detail: `new_intent:${loaded.code}`,
      };
    }
    if (loaded.intent.metadata.sessionId !== sessionId) {
      return {
        ok: false,
        code: "invalid_prepared_payload",
        detail: "new_intent_session_mismatch",
      };
    }
    newAssessmentIntent = loaded.intent;
  }

  let newAdmissionManifest: IncrementalNewAdmissionManifest | null = null;
  if (root.newAdmissionManifest != null) {
    const manifest = root.newAdmissionManifest as IncrementalNewAdmissionManifest;
    const issues = validateIncrementalNewAdmissionManifest(manifest);
    if (issues.length > 0) {
      return {
        ok: false,
        code: "invalid_prepared_payload",
        detail: `manifest:${issues[0]?.code ?? "invalid"}`,
      };
    }
    if (manifest.metadata.sessionId !== sessionId) {
      return {
        ok: false,
        code: "invalid_prepared_payload",
        detail: "manifest_session_mismatch",
      };
    }
    newAdmissionManifest = manifest;
  }

  if (planning.existingMatchCount > 0 && !existingAppendIntent) {
    return {
      ok: false,
      code: "invalid_prepared_payload",
      detail: "missing_existing_intent",
    };
  }
  if (planning.newCandidateCount > 0 && !newAdmissionManifest) {
    return {
      ok: false,
      code: "invalid_prepared_payload",
      detail: "missing_new_manifest",
    };
  }

  return {
    ok: true,
    payload: {
      version: INCREMENTAL_CONCEPT_SESSION_PREPARED_VERSION,
      sessionId,
      processingVersion: CONCEPT_INCREMENTAL_PROCESSING_VERSION,
      planning,
      existingAppendIntent,
      newAssessmentIntent,
      newAdmissionManifest,
    },
  };
}

export function completionProofFromPreparedPayload(
  payload: IncrementalConceptSessionPreparedPayload,
): IncrementalConceptCompletionProof {
  return {
    sessionId: payload.sessionId,
    processingVersion: payload.processingVersion,
    planning: payload.planning,
    existing: { completedCount: payload.planning.existingMatchCount },
    newCandidates: { completedCount: payload.planning.newCandidateCount },
  };
}
