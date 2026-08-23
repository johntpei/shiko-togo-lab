import { randomUUID } from "node:crypto";
import { validateConceptCandidate } from "@/lib/concepts/candidate";
import { normalizeConceptKey } from "@/lib/concepts/normalize";
import { CONCEPT_MATCHING_VERSION } from "@/lib/concepts/types";
import {
  CONCEPT_ADMISSION_POLICY_VERSION,
  type AdmissionServerSignals,
} from "@/lib/concepts/admission/assessment-types";
import {
  POLICY_NAMED_OR_HIGH,
  applyAdmissionPolicy,
} from "@/lib/concepts/admission/policy";
import {
  ApplyTransactionError,
  readRegistryCounts,
  type ApplyDb,
  type ApplyRegistryCounts,
} from "@/lib/concepts/admission/apply-transaction";
import {
  insertConcept,
  insertConceptOccurrence,
  type ConceptQueryDb,
} from "@/lib/db/concept-queries";
import {
  hashIncrementalNewAdmissionManifest,
  validateIncrementalNewAdmissionManifest,
  type IncrementalNewAdmissionManifest,
  type IncrementalNewManifestAdmittedCandidate,
} from "./new-admission-manifest";
import {
  findNormalizedKeyConflict,
  validateIncrementalNewCandidateAgainstDb,
} from "./new-admission-validate";

export type IncrementalNewAdmissionStatus = "ready" | "no_op" | "blocked";

export type IncrementalNewAdmissionConflict = {
  candidateRef: string;
  code: string;
  detail: string;
};

export type IncrementalNewAdmissionMapping = {
  candidateRef: string;
  conceptId: string;
};

export type IncrementalNewAdmissionClassifyResult =
  | {
      status: "ready";
      admittedCount: number;
      notAdmittedCount: number;
      registryCounts: ApplyRegistryCounts;
    }
  | {
      status: "no_op";
      code: "no_admitted_candidates";
      admittedCount: 0;
      notAdmittedCount: number;
      registryCounts: ApplyRegistryCounts;
    }
  | {
      status: "blocked";
      code: string;
      detail: string;
      admittedCount: number;
      notAdmittedCount: number;
      conflicts: IncrementalNewAdmissionConflict[];
      registryCounts: ApplyRegistryCounts;
    };

export type IncrementalNewAdmissionApplyResult =
  | {
      ok: true;
      status: "applied";
      transactionCommitted: true;
      appliedAt: string;
      manifestContentHash: string;
      conceptsCreated: number;
      occurrencesCreated: number;
      aliasesCreated: 0;
      alreadyPresent: 0;
      conflicts: [];
      mapping: IncrementalNewAdmissionMapping[];
      registryCounts: ApplyRegistryCounts;
    }
  | {
      ok: true;
      status: "no_op";
      transactionCommitted: false;
      code: "no_admitted_candidates";
      conceptsCreated: 0;
      occurrencesCreated: 0;
      aliasesCreated: 0;
      alreadyPresent: 0;
      conflicts: [];
      mapping: [];
      registryCounts: ApplyRegistryCounts;
    }
  | {
      ok: false;
      status: "blocked";
      transactionCommitted: false;
      code: string;
      detail: string;
      conceptsCreated: 0;
      occurrencesCreated: 0;
      aliasesCreated: 0;
      alreadyPresent: 0;
      conflicts: IncrementalNewAdmissionConflict[];
      mapping: [];
      registryCounts: ApplyRegistryCounts;
    };

export type IncrementalNewAdmissionApplyDeps = {
  db: ConceptQueryDb;
  now?: () => string;
  createConceptId?: () => string;
  createOccurrenceId?: () => string;
};

const SINGLETON_SERVER_SIGNALS: AdmissionServerSignals = {
  occurrenceCount: 1,
  distinctSessionCount: 1,
  hasExactRecurrence: false,
  hasObservedAliasRecurrence: false,
  suspiciousFlags: [],
};

function blockedClassify(
  db: ApplyDb,
  code: string,
  detail: string,
  manifest: IncrementalNewAdmissionManifest,
  conflicts: IncrementalNewAdmissionConflict[] = [],
): IncrementalNewAdmissionClassifyResult {
  return {
    status: "blocked",
    code,
    detail,
    admittedCount: manifest.admittedCandidates.length,
    notAdmittedCount: manifest.notAdmitted.length,
    conflicts,
    registryCounts: readRegistryCounts(db),
  };
}

function assertCandidateWriteReady(
  candidate: IncrementalNewManifestAdmittedCandidate,
) {
  const policy = applyAdmissionPolicy(
    {
      candidateRef: candidate.candidateRef,
      ...candidate.assessment,
    },
    SINGLETON_SERVER_SIGNALS,
    POLICY_NAMED_OR_HIGH,
  );
  if (policy.decision !== "admit") {
    throw new ApplyTransactionError(
      "non_admit_in_manifest",
      candidate.candidateRef,
    );
  }
  if (policy.policyRuleId !== candidate.policy.policyRuleId) {
    throw new ApplyTransactionError("policy_rule_mismatch", candidate.candidateRef);
  }
  if (policy.reasonCode !== candidate.policy.reasonCode) {
    throw new ApplyTransactionError(
      "policy_reason_mismatch",
      candidate.candidateRef,
    );
  }
  if (candidate.policy.policyVersion !== CONCEPT_ADMISSION_POLICY_VERSION) {
    throw new ApplyTransactionError(
      "policy_version",
      candidate.policy.policyVersion,
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
}

function assertManifestWriteReady(
  manifest: IncrementalNewAdmissionManifest,
  db: ApplyDb,
) {
  const errors = validateIncrementalNewAdmissionManifest(manifest);
  if (errors.length > 0) {
    throw new ApplyTransactionError(errors[0]!.code, errors[0]!.detail);
  }
  if (
    hashIncrementalNewAdmissionManifest(manifest) !==
    manifest.metadata.contentHash
  ) {
    throw new ApplyTransactionError("content_hash", manifest.metadata.contentHash);
  }

  const sessionId = manifest.metadata.sessionId;
  for (const candidate of manifest.admittedCandidates) {
    assertCandidateWriteReady(candidate);
    const grounded = validateIncrementalNewCandidateAgainstDb(
      {
        kind: "new",
        candidateRef: candidate.candidateRef,
        canonicalLabel: candidate.canonicalLabel,
        normalizedKey: candidate.normalizedKey,
        provenance: candidate.provenance,
      },
      sessionId,
      db,
    );
    if (!grounded.ok) {
      throw new ApplyTransactionError(grounded.code, grounded.detail);
    }
    const existing = findNormalizedKeyConflict(db, candidate.normalizedKey);
    if (existing) {
      throw new ApplyTransactionError(
        "normalized_key_conflict",
        `${candidate.candidateRef}:${existing.id}`,
      );
    }
  }
}

/**
 * apply と同じ classifier。preflight は read-only。
 * Initial Registry empty gate は使わない。
 */
export function classifyIncrementalNewAdmission(
  manifest: IncrementalNewAdmissionManifest,
  db: ApplyDb,
): IncrementalNewAdmissionClassifyResult {
  const errors = validateIncrementalNewAdmissionManifest(manifest);
  if (errors.length > 0) {
    return blockedClassify(db, errors[0]!.code, errors[0]!.detail, manifest);
  }
  if (manifest.admittedCandidates.length === 0) {
    return {
      status: "no_op",
      code: "no_admitted_candidates",
      admittedCount: 0,
      notAdmittedCount: manifest.notAdmitted.length,
      registryCounts: readRegistryCounts(db),
    };
  }
  try {
    assertManifestWriteReady(manifest, db);
  } catch (error) {
    if (error instanceof ApplyTransactionError) {
      const conflicts =
        error.code === "normalized_key_conflict"
          ? [
              {
                candidateRef: error.detail.split(":")[0] ?? error.detail,
                code: error.code,
                detail: error.detail,
              },
            ]
          : [];
      return blockedClassify(db, error.code, error.detail, manifest, conflicts);
    }
    throw error;
  }
  return {
    status: "ready",
    admittedCount: manifest.admittedCandidates.length,
    notAdmittedCount: manifest.notAdmitted.length,
    registryCounts: readRegistryCounts(db),
  };
}

export function runIncrementalNewAdmissionPreflight(
  manifest: IncrementalNewAdmissionManifest,
  input: { db: ConceptQueryDb },
) {
  return classifyIncrementalNewAdmission(manifest, input.db);
}

function insertAdmitted(
  manifest: IncrementalNewAdmissionManifest,
  tx: ApplyDb,
  appliedAt: string,
  createConceptId: () => string,
  createOccurrenceId: () => string,
) {
  const mapping: IncrementalNewAdmissionMapping[] = [];
  let occurrencesCreated = 0;
  for (const candidate of manifest.admittedCandidates) {
    const existing = findNormalizedKeyConflict(tx, candidate.normalizedKey);
    if (existing) {
      throw new ApplyTransactionError(
        "normalized_key_conflict",
        `${candidate.candidateRef}:${existing.id}`,
      );
    }
    const grounded = validateIncrementalNewCandidateAgainstDb(
      {
        kind: "new",
        candidateRef: candidate.candidateRef,
        canonicalLabel: candidate.canonicalLabel,
        normalizedKey: candidate.normalizedKey,
        provenance: candidate.provenance,
      },
      manifest.metadata.sessionId,
      tx,
    );
    if (!grounded.ok) {
      throw new ApplyTransactionError(grounded.code, grounded.detail);
    }

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
    const occurrence = insertConceptOccurrence(
      {
        id: createOccurrenceId(),
        conceptId,
        sessionId: candidate.provenance.sessionId,
        messageId: candidate.provenance.messageId,
        evidenceRef: candidate.provenance.evidenceRef,
        occurredAt: candidate.provenance.occurredAt,
        sourceRole: candidate.provenance.sourceRole,
        sourceType: candidate.provenance.sourceType,
        extractionVersion: candidate.provenance.extractionVersion,
      },
      tx,
    );
    if (occurrence.status !== "inserted") {
      throw new ApplyTransactionError(
        occurrence.reason === "duplicate_identity"
          ? "occurrence_identity_conflict"
          : "occurrence_insert_skipped",
        `${candidate.candidateRef}:${occurrence.reason}:${occurrence.detail ?? ""}`,
      );
    }
    if (occurrence.record.occurredAt !== candidate.provenance.occurredAt) {
      throw new ApplyTransactionError("occurred_at_mismatch", candidate.candidateRef);
    }
    occurrencesCreated += 1;
    mapping.push({ candidateRef: candidate.candidateRef, conceptId });
  }
  return { mapping, occurrencesCreated };
}

export function applyIncrementalNewAdmissionManifest(
  manifest: IncrementalNewAdmissionManifest,
  deps: IncrementalNewAdmissionApplyDeps,
): IncrementalNewAdmissionApplyResult {
  const db = deps.db;
  const classified = classifyIncrementalNewAdmission(manifest, db);
  if (classified.status === "no_op") {
    return {
      ok: true,
      status: "no_op",
      transactionCommitted: false,
      code: "no_admitted_candidates",
      conceptsCreated: 0,
      occurrencesCreated: 0,
      aliasesCreated: 0,
      alreadyPresent: 0,
      conflicts: [],
      mapping: [],
      registryCounts: classified.registryCounts,
    };
  }
  if (classified.status === "blocked") {
    return {
      ok: false,
      status: "blocked",
      transactionCommitted: false,
      code: classified.code,
      detail: classified.detail,
      conceptsCreated: 0,
      occurrencesCreated: 0,
      aliasesCreated: 0,
      alreadyPresent: 0,
      conflicts: classified.conflicts,
      mapping: [],
      registryCounts: classified.registryCounts,
    };
  }

  const createConceptId = deps.createConceptId ?? (() => randomUUID());
  const createOccurrenceId = deps.createOccurrenceId ?? (() => randomUUID());
  const appliedAt = (deps.now ?? (() => new Date().toISOString()))();

  try {
    let mapping: IncrementalNewAdmissionMapping[] = [];
    let occurrencesCreated = 0;
    const sqlite = db.$client;
    const run = sqlite.transaction(() => {
      assertManifestWriteReady(manifest, db);
      const inserted = insertAdmitted(
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
      status: "applied",
      transactionCommitted: true,
      appliedAt,
      manifestContentHash: manifest.metadata.contentHash,
      conceptsCreated: mapping.length,
      occurrencesCreated,
      aliasesCreated: 0,
      alreadyPresent: 0,
      conflicts: [],
      mapping,
      registryCounts: readRegistryCounts(db),
    };
  } catch (error) {
    const counts = readRegistryCounts(db);
    if (error instanceof ApplyTransactionError) {
      const conflicts =
        error.code === "normalized_key_conflict" ||
        error.code === "occurrence_identity_conflict"
          ? [
              {
                candidateRef: error.detail.split(":")[0] ?? error.detail,
                code: error.code,
                detail: error.detail,
              },
            ]
          : [];
      return {
        ok: false,
        status: "blocked",
        transactionCommitted: false,
        code: error.code,
        detail: error.detail,
        conceptsCreated: 0,
        occurrencesCreated: 0,
        aliasesCreated: 0,
        alreadyPresent: 0,
        conflicts,
        mapping: [],
        registryCounts: counts,
      };
    }
    return {
      ok: false,
      status: "blocked",
      transactionCommitted: false,
      code: "transaction_failed",
      detail: error instanceof Error ? error.message : String(error),
      conceptsCreated: 0,
      occurrencesCreated: 0,
      aliasesCreated: 0,
      alreadyPresent: 0,
      conflicts: [],
      mapping: [],
      registryCounts: counts,
    };
  }
}
