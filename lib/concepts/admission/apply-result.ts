import {
  accessSync,
  closeSync,
  constants,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { CONCEPT_MATCHING_VERSION } from "@/lib/concepts/types";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  listConcepts,
  type ConceptQueryDb,
} from "@/lib/db/concept-queries";
import { conceptOccurrences } from "@/lib/db/schema";
import {
  CONCEPT_ADMISSION_APPLY_MODE,
  CONCEPT_APPLY_DEFAULT_RESULT,
  type ConceptAdmissionApplyManifest,
} from "./apply-manifest";
import type { ApplyCandidateMapping } from "./apply-transaction";

export { CONCEPT_APPLY_DEFAULT_RESULT };

export const CONCEPT_ADMISSION_APPLY_RESULT_VERSION =
  "concept-admission-apply-result-v1";

export type ApplyResultVersions = {
  extractPromptVersion: string;
  extractionVersion: string;
  matchingVersion: string;
  assessmentPromptVersion: string;
  assessmentVersion: string;
  assessmentModel: string;
  admissionPolicyId: string;
  admissionPolicyVersion: string;
};

export type ConceptAdmissionApplyResult = {
  resultVersion: typeof CONCEPT_ADMISSION_APPLY_RESULT_VERSION;
  mode: typeof CONCEPT_ADMISSION_APPLY_MODE;
  manifestContentHash: string;
  appliedAt: string;
  transactionCommitted: boolean;
  conceptsCreated: number;
  occurrencesCreated: number;
  aliasesCreated: 0;
  skipped: number;
  conflicts: number;
  candidateConceptMap: Record<string, string>;
  versions: ApplyResultVersions;
  postWriteVerification: {
    ok: boolean;
    errors: Array<{ code: string; detail: string }>;
  };
  registryCounts: {
    concepts: number;
    aliases: number;
    occurrences: number;
  };
};

export type PostWriteVerification = ConceptAdmissionApplyResult["postWriteVerification"];

export function mappingToCandidateConceptMap(
  mapping: ApplyCandidateMapping[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of mapping) {
    out[item.candidateRef] = item.conceptId;
  }
  return out;
}

export function versionsFromManifest(
  manifest: ConceptAdmissionApplyManifest,
): ApplyResultVersions {
  return {
    extractPromptVersion: manifest.metadata.extractPromptVersion,
    extractionVersion: manifest.metadata.extractionVersion,
    matchingVersion: manifest.metadata.matchingVersion,
    assessmentPromptVersion: manifest.metadata.assessmentPromptVersion,
    assessmentVersion: manifest.metadata.assessmentVersion,
    assessmentModel: manifest.metadata.assessmentModel,
    admissionPolicyId: manifest.metadata.admissionPolicyId,
    admissionPolicyVersion: manifest.metadata.admissionPolicyVersion,
  };
}

export function buildApplyResult(input: {
  manifest: ConceptAdmissionApplyManifest;
  appliedAt: string;
  transactionCommitted: boolean;
  conceptsCreated: number;
  occurrencesCreated: number;
  skipped: number;
  conflicts: number;
  mapping: ApplyCandidateMapping[];
  verification: PostWriteVerification;
  registryCounts: ConceptAdmissionApplyResult["registryCounts"];
}): ConceptAdmissionApplyResult {
  return {
    resultVersion: CONCEPT_ADMISSION_APPLY_RESULT_VERSION,
    mode: CONCEPT_ADMISSION_APPLY_MODE,
    manifestContentHash: input.manifest.metadata.contentHash,
    appliedAt: input.appliedAt,
    transactionCommitted: input.transactionCommitted,
    conceptsCreated: input.conceptsCreated,
    occurrencesCreated: input.occurrencesCreated,
    aliasesCreated: 0,
    skipped: input.skipped,
    conflicts: input.conflicts,
    candidateConceptMap: mappingToCandidateConceptMap(input.mapping),
    versions: versionsFromManifest(input.manifest),
    postWriteVerification: input.verification,
    registryCounts: input.registryCounts,
  };
}

export function verifyAppliedRegistry(
  manifest: ConceptAdmissionApplyManifest,
  mapping: ApplyCandidateMapping[],
  db: ConceptQueryDb,
): PostWriteVerification {
  const errors: Array<{ code: string; detail: string }> = [];
  const predictedConcepts = manifest.admittedCandidates.length;
  const predictedOccurrences = manifest.admittedCandidates.reduce(
    (sum, item) => sum + item.occurrences.length,
    0,
  );
  const concepts = countConcepts(db);
  const occurrences = countConceptOccurrences(db);
  const aliases = countConceptAliases(db);

  if (concepts !== predictedConcepts) {
    errors.push({
      code: "concept_count_mismatch",
      detail: `${concepts}!=${predictedConcepts}`,
    });
  }
  if (occurrences !== predictedOccurrences) {
    errors.push({
      code: "occurrence_count_mismatch",
      detail: `${occurrences}!=${predictedOccurrences}`,
    });
  }
  if (aliases !== 0) {
    errors.push({
      code: "alias_count_mismatch",
      detail: String(aliases),
    });
  }

  const byRef = new Map(mapping.map((item) => [item.candidateRef, item.conceptId]));
  const storedConcepts = new Map(listConcepts(db).map((item) => [item.id, item]));
  const storedOccurrences = db.select().from(conceptOccurrences).all();

  for (const candidate of manifest.admittedCandidates) {
    const conceptId = byRef.get(candidate.candidateRef);
    if (!conceptId) {
      errors.push({
        code: "missing_mapping",
        detail: candidate.candidateRef,
      });
      continue;
    }
    const row = storedConcepts.get(conceptId);
    if (!row) {
      errors.push({
        code: "missing_concept_row",
        detail: candidate.candidateRef,
      });
      continue;
    }
    if (row.canonicalLabel !== candidate.canonicalLabel) {
      errors.push({
        code: "canonical_label_mismatch",
        detail: candidate.candidateRef,
      });
    }
    if (row.normalizedKey !== candidate.normalizedKey) {
      errors.push({
        code: "normalized_key_mismatch",
        detail: candidate.candidateRef,
      });
    }
    if (row.matchingVersion !== CONCEPT_MATCHING_VERSION) {
      errors.push({
        code: "matching_version_mismatch",
        detail: candidate.candidateRef,
      });
    }

    const rows = storedOccurrences.filter((item) => item.conceptId === conceptId);
    if (rows.length !== candidate.occurrences.length) {
      errors.push({
        code: "candidate_occurrence_count_mismatch",
        detail: `${candidate.candidateRef}:${rows.length}!=${candidate.occurrences.length}`,
      });
    }
    for (const occurrence of candidate.occurrences) {
      const match = rows.find(
        (item) =>
          item.sessionId === occurrence.sessionId &&
          item.messageId === occurrence.messageId &&
          item.evidenceRef === occurrence.evidenceRef &&
          item.extractionVersion === occurrence.extractionVersion &&
          item.sourceType === occurrence.sourceType,
      );
      if (!match) {
        errors.push({
          code: "missing_occurrence_row",
          detail: `${candidate.candidateRef}:${occurrence.sessionId}:${occurrence.messageId}:${occurrence.evidenceRef}`,
        });
        continue;
      }
      if (match.occurredAt !== occurrence.occurredAt) {
        errors.push({
          code: "occurred_at_mismatch",
          detail: candidate.candidateRef,
        });
      }
      if (match.sourceRole !== occurrence.sourceRole) {
        errors.push({
          code: "source_role_mismatch",
          detail: candidate.candidateRef,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function assertResultPathWritable(path: string) {
  const absolute = resolve(path);
  const dir = dirname(absolute);
  mkdirSync(dir, { recursive: true });
  accessSync(dir, constants.W_OK);
  try {
    accessSync(absolute, constants.F_OK);
    accessSync(absolute, constants.W_OK);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code !== "ENOENT") {
      throw error;
    }
  }
}

export function atomicWriteJsonFile(path: string, payload: unknown) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const tmp = `${absolute}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, `${JSON.stringify(payload, null, 2)}\n`);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch {
      // ignore cleanup
    }
    throw error;
  }
  closeSync(fd);
  try {
    renameSync(tmp, absolute);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore cleanup
    }
    throw error;
  }
}
