import { randomUUID } from "node:crypto";
import { validateConceptCandidate } from "@/lib/concepts/candidate";
import { normalizeConceptKey } from "@/lib/concepts/normalize";
import { CONCEPT_MATCHING_VERSION } from "@/lib/concepts/types";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  insertConcept,
  insertConceptOccurrence,
  type ConceptQueryDb,
} from "@/lib/db/concept-queries";
import { messages, sessions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import {
  CONCEPT_ADMISSION_APPLY_EXPECTED_ASSESSMENT_MODEL,
  CONCEPT_ADMISSION_APPLY_MODE,
  type ConceptAdmissionApplyManifest,
} from "./apply-manifest";
import { POLICY_NAMED_OR_HIGH, applyAdmissionPolicy } from "./policy";

export type ApplyDb = ConceptQueryDb;

export type ApplyRegistryCounts = {
  concepts: number;
  conceptAliases: number;
  conceptOccurrences: number;
};

export type ApplyCandidateMapping = {
  candidateRef: string;
  conceptId: string;
};

export type InitialApplySuccess = {
  ok: true;
  transactionCommitted: true;
  appliedAt: string;
  manifestContentHash: string;
  conceptsCreated: number;
  occurrencesCreated: number;
  aliasesCreated: 0;
  conceptsExisting: 0;
  occurrencesExisting: 0;
  mapping: ApplyCandidateMapping[];
  registryCounts: ApplyRegistryCounts;
};

export type InitialApplyFailure = {
  ok: false;
  transactionCommitted: false;
  code: string;
  detail: string;
  registryCounts: ApplyRegistryCounts;
};

export type InitialApplyResult = InitialApplySuccess | InitialApplyFailure;

export type ApplyInitialManifestDeps = {
  db: ApplyDb;
  now?: () => string;
  createConceptId?: () => string;
  createOccurrenceId?: () => string;
};

export class ApplyTransactionError extends Error {
  readonly code: string;
  readonly detail: string;

  constructor(code: string, detail: string) {
    super(`${code}:${detail}`);
    this.name = "ApplyTransactionError";
    this.code = code;
    this.detail = detail;
  }
}

export function readRegistryCounts(db: ApplyDb): ApplyRegistryCounts {
  return {
    concepts: countConcepts(db),
    conceptAliases: countConceptAliases(db),
    conceptOccurrences: countConceptOccurrences(db),
  };
}

export function evaluateInitialRegistryGate(
  db: ApplyDb,
): { ok: true; counts: ApplyRegistryCounts } | { ok: false; counts: ApplyRegistryCounts } {
  const counts = readRegistryCounts(db);
  if (
    counts.concepts === 0 &&
    counts.conceptAliases === 0 &&
    counts.conceptOccurrences === 0
  ) {
    return { ok: true, counts };
  }
  return { ok: false, counts };
}

function fail(
  code: string,
  detail: string,
  db: ApplyDb,
): InitialApplyFailure {
  return {
    ok: false,
    transactionCommitted: false,
    code,
    detail,
    registryCounts: readRegistryCounts(db),
  };
}

function findSession(db: ApplyDb, sessionId: string) {
  return (
    db.select().from(sessions).where(eq(sessions.id, sessionId)).get() ?? null
  );
}

function findMessage(db: ApplyDb, messageId: string, sessionId: string) {
  return (
    db
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.sessionId, sessionId)))
      .get() ?? null
  );
}

function assertWriteReady(manifest: ConceptAdmissionApplyManifest) {
  if (manifest.metadata.mode !== CONCEPT_ADMISSION_APPLY_MODE) {
    throw new ApplyTransactionError("unsupported_mode", manifest.metadata.mode);
  }
  if (manifest.aliasesToCreate !== 0) {
    throw new ApplyTransactionError(
      "aliases_to_create",
      String(manifest.aliasesToCreate),
    );
  }
  if (
    manifest.metadata.assessmentModel !==
    CONCEPT_ADMISSION_APPLY_EXPECTED_ASSESSMENT_MODEL
  ) {
    throw new ApplyTransactionError(
      "assessment_model",
      manifest.metadata.assessmentModel,
    );
  }

  for (const candidate of manifest.admittedCandidates) {
    const policy = applyAdmissionPolicy(
      {
        candidateRef: candidate.candidateRef,
        ...candidate.assessment,
      },
      candidate.serverSignals,
      POLICY_NAMED_OR_HIGH,
    );
    if (policy.decision !== "admit") {
      throw new ApplyTransactionError("non_admit_in_manifest", candidate.candidateRef);
    }
    if (policy.policyRuleId !== candidate.policyRuleId) {
      throw new ApplyTransactionError("policy_rule_mismatch", candidate.candidateRef);
    }
    if (policy.reasonCode !== candidate.policyReasonCode) {
      throw new ApplyTransactionError(
        "policy_reason_mismatch",
        candidate.candidateRef,
      );
    }

    const validated = validateConceptCandidate(candidate.canonicalLabel);
    if (!validated.ok) {
      throw new ApplyTransactionError(
        "candidate_denied",
        `${candidate.candidateRef}:${validated.reason}`,
      );
    }
    if (validated.normalizedKey !== candidate.normalizedKey) {
      throw new ApplyTransactionError("normalized_key_mismatch", candidate.candidateRef);
    }
    if (normalizeConceptKey(candidate.canonicalLabel) !== candidate.normalizedKey) {
      throw new ApplyTransactionError(
        "normalized_key_renormalize",
        candidate.candidateRef,
      );
    }

    const dup = new Set<string>();
    for (const occurrence of candidate.occurrences) {
      const identity = `${occurrence.extractionVersion}:${occurrence.messageId}:${occurrence.evidenceRef}`;
      if (dup.has(identity)) {
        throw new ApplyTransactionError(
          "duplicate_occurrence",
          `${candidate.candidateRef}:${identity}`,
        );
      }
      dup.add(identity);
    }
  }
}

function assertProvenance(manifest: ConceptAdmissionApplyManifest, db: ApplyDb) {
  for (const candidate of manifest.admittedCandidates) {
    for (const occurrence of candidate.occurrences) {
      if (!findSession(db, occurrence.sessionId)) {
        throw new ApplyTransactionError("missing_session", occurrence.sessionId);
      }
      if (!findMessage(db, occurrence.messageId, occurrence.sessionId)) {
        throw new ApplyTransactionError(
          "missing_message",
          `${occurrence.sessionId}:${occurrence.messageId}`,
        );
      }
    }
  }
}

function insertManifestRows(
  manifest: ConceptAdmissionApplyManifest,
  tx: ApplyDb,
  appliedAt: string,
  createConceptId: () => string,
  createOccurrenceId: () => string,
) {
  const mapping: ApplyCandidateMapping[] = [];
  let occurrencesCreated = 0;

  for (const candidate of manifest.admittedCandidates) {
    const conceptId = createConceptId();
    const inserted = insertConcept(
      {
        id: conceptId,
        canonicalLabel: candidate.canonicalLabel,
        matchingVersion: CONCEPT_MATCHING_VERSION,
        createdAt: appliedAt,
      },
      tx,
    );
    if (inserted.status !== "inserted") {
      throw new ApplyTransactionError(
        inserted.reason === "duplicate_normalized_key"
          ? "normalized_key_conflict"
          : "concept_insert_skipped",
        `${candidate.candidateRef}:${inserted.reason}`,
      );
    }
    if (inserted.record.canonicalLabel !== candidate.canonicalLabel) {
      throw new ApplyTransactionError("canonical_label_mismatch", candidate.candidateRef);
    }
    if (inserted.record.normalizedKey !== candidate.normalizedKey) {
      throw new ApplyTransactionError("normalized_key_mismatch", candidate.candidateRef);
    }

    for (const occurrence of candidate.occurrences) {
      const row = insertConceptOccurrence(
        {
          id: createOccurrenceId(),
          conceptId,
          sessionId: occurrence.sessionId,
          messageId: occurrence.messageId,
          evidenceRef: occurrence.evidenceRef,
          occurredAt: occurrence.occurredAt,
          sourceRole: occurrence.sourceRole,
          sourceType: occurrence.sourceType,
          extractionVersion: occurrence.extractionVersion,
        },
        tx,
      );
      if (row.status !== "inserted") {
        throw new ApplyTransactionError(
          "occurrence_insert_skipped",
          `${candidate.candidateRef}:${row.reason}:${row.detail ?? ""}`,
        );
      }
      if (row.record.occurredAt !== occurrence.occurredAt) {
        throw new ApplyTransactionError("occurred_at_mismatch", candidate.candidateRef);
      }
      occurrencesCreated += 1;
    }
    mapping.push({ candidateRef: candidate.candidateRef, conceptId });
  }

  return { mapping, occurrencesCreated };
}

export function applyInitialAdmissionManifest(
  manifest: ConceptAdmissionApplyManifest,
  deps: ApplyInitialManifestDeps,
): InitialApplyResult {
  const db = deps.db;
  const createConceptId = deps.createConceptId ?? (() => randomUUID());
  const createOccurrenceId = deps.createOccurrenceId ?? (() => randomUUID());
  const appliedAt = (deps.now ?? (() => new Date().toISOString()))();

  try {
    assertWriteReady(manifest);
  } catch (error) {
    if (error instanceof ApplyTransactionError) {
      return fail(error.code, error.detail, db);
    }
    throw error;
  }

  const gate = evaluateInitialRegistryGate(db);
  if (!gate.ok) {
    return fail("initial_registry_not_empty", JSON.stringify(gate.counts), db);
  }

  try {
    let mapping: ApplyCandidateMapping[] = [];
    let occurrencesCreated = 0;
    const sqlite = db.$client;
    const run = sqlite.transaction(() => {
      const innerGate = evaluateInitialRegistryGate(db);
      if (!innerGate.ok) {
        throw new ApplyTransactionError(
          "initial_registry_not_empty",
          JSON.stringify(innerGate.counts),
        );
      }
      assertProvenance(manifest, db);
      const inserted = insertManifestRows(
        manifest,
        db,
        appliedAt,
        createConceptId,
        createOccurrenceId,
      );
      mapping = inserted.mapping;
      occurrencesCreated = inserted.occurrencesCreated;
    });
    run();

    return {
      ok: true,
      transactionCommitted: true,
      appliedAt,
      manifestContentHash: manifest.metadata.contentHash,
      conceptsCreated: mapping.length,
      occurrencesCreated,
      aliasesCreated: 0,
      conceptsExisting: 0,
      occurrencesExisting: 0,
      mapping,
      registryCounts: readRegistryCounts(db),
    };
  } catch (error) {
    if (error instanceof ApplyTransactionError) {
      return fail(error.code, error.detail, db);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return fail("transaction_failed", detail, db);
  }
}
