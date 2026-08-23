import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { asc, eq } from "drizzle-orm";
import { toEvidenceRole } from "@/lib/ai/evidence-units";
import { hashSourceArtifactText } from "@/lib/concepts/admission/apply-manifest";
import { conceptThoughtOccurredAt } from "@/lib/concepts/occurred-at";
import {
  CONCEPT_EXTRACTION_VERSION,
  CONCEPT_SOURCE_ROLES,
  CONCEPT_SOURCE_TYPES,
  type ConceptSourceRole,
  type ConceptSourceType,
} from "@/lib/concepts/types";
import { prepareUserEvidenceUnits } from "@/lib/concepts/user-units";
import { getDbPath } from "@/lib/db/client";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  type ConceptQueryDb,
} from "@/lib/db/concept-queries";
import { concepts, messages, sessions } from "@/lib/db/schema";
import { CONCEPT_INCREMENTAL_LLM_PILOT_DEFAULT_OUTPUT } from "./llm-pilot";
import {
  INCREMENTAL_MATCH_REASONS,
  type ExistingMatchPlan,
  type IncrementalMatchReason,
} from "./plan";

export const CONCEPT_INCREMENTAL_REPLAY_AUDIT_DEFAULT_INPUT =
  CONCEPT_INCREMENTAL_LLM_PILOT_DEFAULT_OUTPUT;
export const CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_DEFAULT_OUTPUT =
  "data/concept-incremental-existing-append-intent-v1.json";

export const CONCEPT_INCREMENTAL_REPLAY_APPLY_ERROR =
  "existing-match replay audit is read-only; --apply is not accepted";

export const CONCEPT_INCREMENTAL_REPLAY_HELP = `Usage:
  npm run concept:incremental-replay-audit -- [--input <path>] [--output <path>]

Read-only audit: can the Incremental LLM pilot result reconstruct ExistingMatchPlan
without LLM rerun or guessing surfaceForm?
--apply is not accepted. Occurrence preflight / append are not executed.
`;

export const EXISTING_MATCH_REPLAYABLE = "EXISTING_MATCH_REPLAYABLE";
export const EXISTING_MATCH_REPLAYABILITY_GAP =
  "EXISTING_MATCH_REPLAYABILITY_GAP";

export type ExistingMatchReplayabilityStatus =
  | typeof EXISTING_MATCH_REPLAYABLE
  | typeof EXISTING_MATCH_REPLAYABILITY_GAP;

export type ExistingMatchPlanFieldSource =
  | "pilot_result_artifact"
  | "server_db"
  | "concept_registry"
  | "coverage_artifact"
  | "unavailable";

export type ExistingMatchPlanFieldKind =
  | "server_owned"
  | "llm_derived_but_grounded"
  | "derived_deterministically";

export type ExistingMatchPlanFieldAudit = {
  field: string;
  source: ExistingMatchPlanFieldSource;
  kind: ExistingMatchPlanFieldKind;
  available: boolean;
  note: string;
};

export type ExistingMatchReplayGap = {
  code: string;
  detail: string;
  field?: string;
};

export type ExistingMatchReplayCandidateAudit = {
  candidateRef: string | null;
  kind: string;
  includedInIntent: boolean;
  gaps: ExistingMatchReplayGap[];
  provenanceResolved: boolean;
  conceptPresent: boolean;
  surfaceFormPresent: boolean;
};

export type ExistingMatchAppendIntent = {
  metadata: {
    intentVersion: "concept-incremental-existing-append-intent-v1";
    sourcePilotResult: string;
    sourcePilotResultHash: string;
    promptVersion: string | null;
    extractionVersion: string | null;
    model: string | null;
    sessionId: string;
    generatedAt: string;
  };
  plans: ExistingMatchPlan[];
};

export type ExistingMatchReplayabilityAudit = {
  status: ExistingMatchReplayabilityStatus;
  sourcePilotResult: string;
  sourcePilotResultHash: string;
  sessionId: string | null;
  existingMatchCount: number;
  provisionalNewExcluded: number;
  newExcluded: number;
  gaps: ExistingMatchReplayGap[];
  fields: ExistingMatchPlanFieldAudit[];
  candidates: ExistingMatchReplayCandidateAudit[];
  intent: ExistingMatchAppendIntent | null;
  db: {
    before: {
      concepts: number;
      conceptAliases: number;
      conceptOccurrences: number;
      sessions: number;
      messages: number;
    };
    after: {
      concepts: number;
      conceptAliases: number;
      conceptOccurrences: number;
      sessions: number;
      messages: number;
    };
  };
};

export type ExistingMatchReplayAuditArgs = {
  apply: boolean;
  malformed: boolean;
  malformedReason: string | null;
  inputPath: string;
  outputPath: string | null;
};

export type ExistingMatchReplayAuditDeps = {
  openDb: (dbPath: string) => ConceptQueryDb;
  dbPath?: string;
  readFile?: (path: string) => string;
  writeReport?: (path: string, payload: unknown) => void;
  now?: () => string;
};

function snapshotDb(db: ConceptQueryDb) {
  return {
    concepts: countConcepts(db),
    conceptAliases: countConceptAliases(db),
    conceptOccurrences: countConceptOccurrences(db),
    sessions: db.select().from(sessions).all().length,
    messages: db.select().from(messages).all().length,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isMatchReason(value: string): value is IncrementalMatchReason {
  return (INCREMENTAL_MATCH_REASONS as readonly string[]).includes(value);
}

function isSourceRole(value: string): value is ConceptSourceRole {
  return (CONCEPT_SOURCE_ROLES as readonly string[]).includes(value);
}

function isSourceType(value: string): value is ConceptSourceType {
  return (CONCEPT_SOURCE_TYPES as readonly string[]).includes(value);
}

function field(
  name: string,
  source: ExistingMatchPlanFieldSource,
  kind: ExistingMatchPlanFieldKind,
  available: boolean,
  note: string,
): ExistingMatchPlanFieldAudit {
  return { field: name, source, kind, available, note };
}

function requiredFieldsTemplate(): ExistingMatchPlanFieldAudit[] {
  return [
    field("kind", "pilot_result_artifact", "server_owned", true, "must be existing_match"),
    field("candidateRef", "pilot_result_artifact", "derived_deterministically", false, "diagnostic / error identity; not Occurrence identity"),
    field("conceptId", "pilot_result_artifact", "server_owned", false, "Registry UUID from confirmed identity"),
    field("matchReason", "pilot_result_artifact", "derived_deterministically", false, "exact_canonical | unique_observed_alias"),
    field("canonicalLabel", "concept_registry", "server_owned", false, "current Registry by conceptId; apply re-checks current"),
    field("normalizedKey", "concept_registry", "server_owned", false, "current Registry by conceptId; apply re-checks current"),
    field("provenance.sessionId", "pilot_result_artifact", "server_owned", false, "report.sessionId + message.sessionId"),
    field("provenance.messageId", "pilot_result_artifact", "server_owned", false, "Server Message row"),
    field("provenance.evidenceRef", "pilot_result_artifact", "derived_deterministically", false, "prepareUserEvidenceUnits ordinal"),
    field("provenance.occurredAt", "pilot_result_artifact", "derived_deterministically", false, "conceptThoughtOccurredAt from Server Evidence"),
    field("provenance.surfaceForm", "unavailable", "llm_derived_but_grounded", false, "grounded contiguous substring; not in diagnostic report"),
    field("provenance.sourceRole", "pilot_result_artifact", "server_owned", false, "must be user"),
    field("provenance.sourceType", "pilot_result_artifact", "server_owned", false, "must be evidence_unit"),
    field("provenance.extractionVersion", "pilot_result_artifact", "server_owned", false, "must be concept-extraction-v1"),
  ];
}

function mark(
  fields: ExistingMatchPlanFieldAudit[],
  name: string,
  patch: Partial<ExistingMatchPlanFieldAudit>,
) {
  const row = fields.find((item) => item.field === name);
  if (!row) {
    return;
  }
  Object.assign(row, patch);
}

function findConcept(db: ConceptQueryDb, conceptId: string) {
  return db.select().from(concepts).where(eq(concepts.id, conceptId)).get() ?? null;
}

function findSession(db: ConceptQueryDb, sessionId: string) {
  return db.select().from(sessions).where(eq(sessions.id, sessionId)).get() ?? null;
}

function findMessage(db: ConceptQueryDb, messageId: string) {
  return db.select().from(messages).where(eq(messages.id, messageId)).get() ?? null;
}

function listMessages(db: ConceptQueryDb, sessionId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.index))
    .all();
}

/**
 * surfaceForm は diagnostic report に無い。
 * canonicalLabel / Evidence substring / normalizedKey からの復元は行わない。
 */
export function auditExistingMatchReplayability(input: {
  db: ConceptQueryDb;
  pilotResultText: string;
  sourcePilotResult?: string;
  now?: () => string;
}): ExistingMatchReplayabilityAudit {
  const before = snapshotDb(input.db);
  const fields = requiredFieldsTemplate();
  const gaps: ExistingMatchReplayGap[] = [];
  const candidates: ExistingMatchReplayCandidateAudit[] = [];
  const reconstructed: ExistingMatchPlan[] = [];
  const sourcePilotResult =
    input.sourcePilotResult ?? CONCEPT_INCREMENTAL_REPLAY_AUDIT_DEFAULT_INPUT;
  const sourcePilotResultHash = hashSourceArtifactText(input.pilotResultText);

  let raw: unknown;
  try {
    raw = JSON.parse(input.pilotResultText);
  } catch {
    const after = snapshotDb(input.db);
    return {
      status: EXISTING_MATCH_REPLAYABILITY_GAP,
      sourcePilotResult,
      sourcePilotResultHash,
      sessionId: null,
      existingMatchCount: 0,
      provisionalNewExcluded: 0,
      newExcluded: 0,
      gaps: [{ code: "malformed_pilot_result", detail: "pilot_result_json" }],
      fields,
      candidates,
      intent: null,
      db: { before, after },
    };
  }
  const report = asRecord(raw);
  const sessionId = asString(report?.sessionId);
  const promptVersion = asString(report?.promptVersion);
  const extractionVersion = asString(report?.extractionVersion);
  const model = asString(report?.model);
  const planRows = Array.isArray(report?.plans) ? report.plans : [];

  let provisionalNewExcluded = 0;
  let newExcluded = 0;
  let existingMatchCount = 0;

  if (!sessionId) {
    gaps.push({
      code: "missing_session_id",
      detail: "pilot_result.sessionId",
      field: "provenance.sessionId",
    });
  } else {
    mark(fields, "provenance.sessionId", {
      available: true,
      source: "pilot_result_artifact",
    });
  }

  for (const rowUnknown of planRows) {
    const row = asRecord(rowUnknown);
    const kind = asString(row?.kind) ?? "unknown";
    if (kind === "provisional_new") {
      provisionalNewExcluded += 1;
      candidates.push({
        candidateRef: asString(row?.candidateRef),
        kind,
        includedInIntent: false,
        gaps: [],
        provenanceResolved: false,
        conceptPresent: false,
        surfaceFormPresent: false,
      });
      continue;
    }
    if (kind === "new") {
      newExcluded += 1;
      candidates.push({
        candidateRef: asString(row?.candidateRef),
        kind,
        includedInIntent: false,
        gaps: [],
        provenanceResolved: false,
        conceptPresent: false,
        surfaceFormPresent: false,
      });
      continue;
    }
    if (kind !== "existing_match") {
      gaps.push({
        code: "unsupported_plan_kind",
        detail: kind,
      });
      continue;
    }

    existingMatchCount += 1;
    const localGaps: ExistingMatchReplayGap[] = [];
    const candidateRef = asString(row?.candidateRef);
    const conceptId = asString(row?.conceptId);
    const matchReasonRaw = asString(row?.matchReason);
    const messageId = asString(row?.messageId);
    const evidenceRef = asString(row?.evidenceRef);
    const occurredAt = asString(row?.occurredAt);
    const sourceRoleRaw = asString(row?.sourceRole);
    const sourceTypeRaw = asString(row?.sourceType);
    const extractionVersionRow = asString(row?.extractionVersion);
    const surfaceForm = asString(row?.surfaceForm);

    if (candidateRef) {
      mark(fields, "candidateRef", {
        available: true,
        source: "pilot_result_artifact",
      });
    } else {
      localGaps.push({
        code: "missing_candidate_ref",
        detail: "candidateRef",
        field: "candidateRef",
      });
    }
    if (conceptId) {
      mark(fields, "conceptId", {
        available: true,
        source: "pilot_result_artifact",
      });
    } else {
      localGaps.push({
        code: "missing_concept_id",
        detail: "conceptId",
        field: "conceptId",
      });
    }
    if (matchReasonRaw && isMatchReason(matchReasonRaw)) {
      mark(fields, "matchReason", {
        available: true,
        source: "pilot_result_artifact",
      });
    } else {
      localGaps.push({
        code: "missing_or_invalid_match_reason",
        detail: matchReasonRaw ?? "",
        field: "matchReason",
      });
    }
    if (messageId) {
      mark(fields, "provenance.messageId", {
        available: true,
        source: "pilot_result_artifact",
      });
    } else {
      localGaps.push({
        code: "missing_message_id",
        detail: "messageId",
        field: "provenance.messageId",
      });
    }
    if (evidenceRef) {
      mark(fields, "provenance.evidenceRef", {
        available: true,
        source: "pilot_result_artifact",
      });
    } else {
      localGaps.push({
        code: "missing_evidence_ref",
        detail: "evidenceRef",
        field: "provenance.evidenceRef",
      });
    }
    if (occurredAt) {
      mark(fields, "provenance.occurredAt", {
        available: true,
        source: "pilot_result_artifact",
      });
    } else {
      localGaps.push({
        code: "missing_occurred_at",
        detail: "occurredAt",
        field: "provenance.occurredAt",
      });
    }
    if (sourceRoleRaw && isSourceRole(sourceRoleRaw)) {
      mark(fields, "provenance.sourceRole", {
        available: true,
        source: "pilot_result_artifact",
      });
    } else {
      localGaps.push({
        code: "missing_or_invalid_source_role",
        detail: sourceRoleRaw ?? "",
        field: "provenance.sourceRole",
      });
    }
    if (sourceTypeRaw && isSourceType(sourceTypeRaw)) {
      mark(fields, "provenance.sourceType", {
        available: true,
        source: "pilot_result_artifact",
      });
    } else {
      localGaps.push({
        code: "missing_or_invalid_source_type",
        detail: sourceTypeRaw ?? "",
        field: "provenance.sourceType",
      });
    }
    if (extractionVersionRow === CONCEPT_EXTRACTION_VERSION) {
      mark(fields, "provenance.extractionVersion", {
        available: true,
        source: "pilot_result_artifact",
      });
    } else {
      localGaps.push({
        code: "missing_or_invalid_extraction_version",
        detail: extractionVersionRow ?? "",
        field: "provenance.extractionVersion",
      });
    }

    if (!surfaceForm) {
      localGaps.push({
        code: "missing_surface_form",
        detail:
          "diagnostic pilot report omits surfaceForm; canonicalLabel / unit substring / normalizedKey must not substitute",
        field: "provenance.surfaceForm",
      });
      mark(fields, "provenance.surfaceForm", {
        available: false,
        source: "unavailable",
        kind: "llm_derived_but_grounded",
      });
    } else {
      mark(fields, "provenance.surfaceForm", {
        available: true,
        source: "pilot_result_artifact",
        kind: "llm_derived_but_grounded",
        note: "grounded contiguous substring; not full USER message",
      });
    }

    const concept = conceptId ? findConcept(input.db, conceptId) : null;
    if (!concept) {
      localGaps.push({
        code: "missing_concept",
        detail: conceptId ?? "",
        field: "conceptId",
      });
    } else {
      mark(fields, "canonicalLabel", {
        available: true,
        source: "concept_registry",
        note: "current Registry by conceptId; not a frozen pilot-time snapshot",
      });
      mark(fields, "normalizedKey", {
        available: true,
        source: "concept_registry",
        note: "current Registry by conceptId; not a frozen pilot-time snapshot",
      });
    }

    let provenanceResolved = false;
    if (sessionId && messageId && evidenceRef) {
      const session = findSession(input.db, sessionId);
      const message = findMessage(input.db, messageId);
      if (!session) {
        localGaps.push({
          code: "missing_session",
          detail: sessionId,
          field: "provenance.sessionId",
        });
      } else if (!message) {
        localGaps.push({
          code: "missing_message",
          detail: messageId,
          field: "provenance.messageId",
        });
      } else if (message.sessionId !== sessionId) {
        localGaps.push({
          code: "message_session_mismatch",
          detail: `${sessionId}:${messageId}`,
          field: "provenance.messageId",
        });
      } else if (toEvidenceRole(message.role) !== "user") {
        localGaps.push({
          code: "message_not_user",
          detail: messageId,
          field: "provenance.sourceRole",
        });
      } else {
        const units = prepareUserEvidenceUnits({
          sessionId: session.id,
          occurredAt: session.occurredAt,
          messages: listMessages(input.db, session.id).map((item) => ({
            id: item.id,
            role: item.role,
            content: item.content,
            sourceCreatedAt: item.sourceCreatedAt,
          })),
        });
        const unit = units.find((item) => item.evidenceRef === evidenceRef);
        if (!unit) {
          localGaps.push({
            code: "evidence_ref_unresolved",
            detail: evidenceRef,
            field: "provenance.evidenceRef",
          });
        } else if (unit.messageId !== messageId) {
          localGaps.push({
            code: "evidence_message_mismatch",
            detail: evidenceRef,
            field: "provenance.messageId",
          });
        } else {
          const serverOccurredAt = conceptThoughtOccurredAt({
            sourceCreatedAt: unit.sourceCreatedAt,
            sessionOccurredAt: unit.sessionOccurredAt,
          });
          if (occurredAt && occurredAt !== serverOccurredAt) {
            localGaps.push({
              code: "occurred_at_mismatch",
              detail: `${occurredAt}!=${serverOccurredAt}`,
              field: "provenance.occurredAt",
            });
          } else {
            provenanceResolved = true;
            mark(fields, "provenance.occurredAt", {
              available: true,
              source: "server_db",
              kind: "derived_deterministically",
              note: "matches conceptThoughtOccurredAt(Server Evidence)",
            });
            mark(fields, "provenance.evidenceRef", {
              available: true,
              source: "server_db",
              kind: "derived_deterministically",
              note: "unique prepareUserEvidenceUnits lookup in session",
            });
          }
        }
      }
    }

    const canBuild =
      localGaps.length === 0 &&
      Boolean(sessionId) &&
      Boolean(candidateRef) &&
      Boolean(conceptId) &&
      Boolean(matchReasonRaw && isMatchReason(matchReasonRaw)) &&
      Boolean(messageId) &&
      Boolean(evidenceRef) &&
      Boolean(occurredAt) &&
      Boolean(sourceRoleRaw && isSourceRole(sourceRoleRaw)) &&
      Boolean(sourceTypeRaw && isSourceType(sourceTypeRaw)) &&
      extractionVersionRow === CONCEPT_EXTRACTION_VERSION &&
      Boolean(surfaceForm) &&
      Boolean(concept);

    if (canBuild && concept && matchReasonRaw && isMatchReason(matchReasonRaw)) {
      reconstructed.push({
        kind: "existing_match",
        candidateRef: candidateRef!,
        conceptId: conceptId!,
        matchReason: matchReasonRaw,
        canonicalLabel: concept.canonicalLabel,
        normalizedKey: concept.normalizedKey,
        provenance: {
          sessionId: sessionId!,
          messageId: messageId!,
          evidenceRef: evidenceRef!,
          occurredAt: occurredAt!,
          surfaceForm: surfaceForm!,
          sourceRole: sourceRoleRaw as ConceptSourceRole,
          sourceType: sourceTypeRaw as ConceptSourceType,
          extractionVersion: CONCEPT_EXTRACTION_VERSION,
        },
      });
    }

    candidates.push({
      candidateRef,
      kind,
      includedInIntent: canBuild,
      gaps: localGaps,
      provenanceResolved,
      conceptPresent: Boolean(concept),
      surfaceFormPresent: Boolean(surfaceForm),
    });
    gaps.push(...localGaps);
  }

  const status =
    reconstructed.length > 0 &&
    gaps.length === 0 &&
    existingMatchCount === reconstructed.length
      ? EXISTING_MATCH_REPLAYABLE
      : EXISTING_MATCH_REPLAYABILITY_GAP;

  const generatedAt = (input.now ?? (() => new Date().toISOString()))();
  const intent: ExistingMatchAppendIntent | null =
    status === EXISTING_MATCH_REPLAYABLE && sessionId
      ? {
          metadata: {
            intentVersion: "concept-incremental-existing-append-intent-v1",
            sourcePilotResult,
            sourcePilotResultHash,
            promptVersion,
            extractionVersion,
            model,
            sessionId,
            generatedAt,
          },
          plans: reconstructed,
        }
      : null;

  const after = snapshotDb(input.db);
  return {
    status,
    sourcePilotResult,
    sourcePilotResultHash,
    sessionId,
    existingMatchCount,
    provisionalNewExcluded,
    newExcluded,
    gaps,
    fields,
    candidates,
    intent,
    db: { before, after },
  };
}

export function parseConceptIncrementalReplayAuditArgs(
  argv: string[],
): ExistingMatchReplayAuditArgs {
  let apply = false;
  let malformed = false;
  let malformedReason: string | null = null;
  let inputPath = CONCEPT_INCREMENTAL_REPLAY_AUDIT_DEFAULT_INPUT;
  let outputPath: string | null = null;

  const takeValue = (index: number, next: string | undefined) => {
    if (!next || next.startsWith("--")) {
      malformed = true;
      malformedReason = "missing_option_value";
      return null;
    }
    return next;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--input") {
      const value = takeValue(i, argv[i + 1]);
      if (value) {
        inputPath = value;
        i += 1;
      }
      continue;
    }
    if (arg === "--output") {
      const value = takeValue(i, argv[i + 1]);
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

  return { apply, malformed, malformedReason, inputPath, outputPath };
}

export function writeExistingMatchReplayAuditFile(path: string, payload: unknown) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function formatExistingMatchReplayabilitySummary(
  audit: ExistingMatchReplayabilityAudit,
) {
  const lines = [
    audit.status,
    `source: ${audit.sourcePilotResult}`,
    `sourceHash: ${audit.sourcePilotResultHash}`,
    `sessionId: ${audit.sessionId ?? "(none)"}`,
    `existing_match: ${audit.existingMatchCount}`,
    `provisional_new excluded: ${audit.provisionalNewExcluded}`,
    `new excluded: ${audit.newExcluded}`,
    `intentPlans: ${audit.intent?.plans.length ?? 0}`,
  ];
  if (audit.gaps.length > 0) {
    lines.push("gaps:");
    for (const gap of audit.gaps) {
      lines.push(`  ${gap.code}${gap.field ? ` field=${gap.field}` : ""} ${gap.detail}`);
    }
  }
  lines.push("Occurrence preflight / append were not executed.");
  lines.push(
    "surfaceForm was not reconstructed from canonicalLabel, Evidence text, or normalizedKey.",
  );
  return lines.join("\n");
}

export function runConceptIncrementalReplayAudit(
  argv: string[],
  deps: ExistingMatchReplayAuditDeps,
):
  | { ok: true; audit: ExistingMatchReplayabilityAudit; summary: string }
  | { ok: false; code: string; error: string } {
  const parsed = parseConceptIncrementalReplayAuditArgs(argv);
  if (parsed.apply) {
    return {
      ok: false,
      code: "apply",
      error: CONCEPT_INCREMENTAL_REPLAY_APPLY_ERROR,
    };
  }
  if (parsed.malformed) {
    return {
      ok: false,
      code: parsed.malformedReason ?? "malformed",
      error: CONCEPT_INCREMENTAL_REPLAY_HELP,
    };
  }

  const reader =
    deps.readFile ?? ((path: string) => readFileSync(resolve(path), "utf8"));
  let pilotResultText: string;
  try {
    pilotResultText = reader(parsed.inputPath);
  } catch (error) {
    return {
      ok: false,
      code: "read",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const db = deps.openDb(deps.dbPath ?? getDbPath());
  const audit = auditExistingMatchReplayability({
    db,
    pilotResultText,
    sourcePilotResult: parsed.inputPath,
    now: deps.now,
  });

  if (parsed.outputPath) {
    const writer = deps.writeReport ?? writeExistingMatchReplayAuditFile;
    writer(parsed.outputPath, {
      status: audit.status,
      sourcePilotResult: audit.sourcePilotResult,
      sourcePilotResultHash: audit.sourcePilotResultHash,
      sessionId: audit.sessionId,
      existingMatchCount: audit.existingMatchCount,
      provisionalNewExcluded: audit.provisionalNewExcluded,
      newExcluded: audit.newExcluded,
      gaps: audit.gaps,
      fields: audit.fields,
      candidates: audit.candidates.map((item) => ({
        candidateRef: item.candidateRef,
        kind: item.kind,
        includedInIntent: item.includedInIntent,
        gaps: item.gaps,
        provenanceResolved: item.provenanceResolved,
        conceptPresent: item.conceptPresent,
        surfaceFormPresent: item.surfaceFormPresent,
      })),
      intentWritten: false,
      db: audit.db,
    });
  }

  return {
    ok: true,
    audit,
    summary: formatExistingMatchReplayabilitySummary(audit),
  };
}
