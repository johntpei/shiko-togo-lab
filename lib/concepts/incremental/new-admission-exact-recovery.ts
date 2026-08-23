import { and, eq } from "drizzle-orm";
import {
  findConceptByNormalizedKey,
  type ConceptQueryDb,
} from "@/lib/db/concept-queries";
import { conceptOccurrences } from "@/lib/db/schema";
import type { IncrementalNewAdmissionManifest } from "./new-admission-manifest";
import type { IncrementalNewManifestAdmittedCandidate } from "./new-admission-manifest";

export type PreparedNewExactRecoveryResult =
  | { ok: true; alreadyAppliedExact: true }
  | { ok: true; alreadyAppliedExact: false }
  | { ok: false; code: string; detail: string };

function findOccurrenceByIdentity(
  db: ConceptQueryDb,
  input: {
    extractionVersion: string;
    sourceType: string;
    messageId: string;
    evidenceRef: string;
    conceptId: string;
  },
) {
  return (
    db
      .select()
      .from(conceptOccurrences)
      .where(
        and(
          eq(conceptOccurrences.extractionVersion, input.extractionVersion),
          eq(conceptOccurrences.sourceType, input.sourceType),
          eq(conceptOccurrences.messageId, input.messageId),
          eq(conceptOccurrences.evidenceRef, input.evidenceRef),
          eq(conceptOccurrences.conceptId, input.conceptId),
        ),
      )
      .get() ?? null
  );
}

function candidateExactMatch(
  db: ConceptQueryDb,
  candidate: IncrementalNewManifestAdmittedCandidate,
): boolean {
  const concept = findConceptByNormalizedKey(candidate.normalizedKey, db);
  if (!concept) {
    return false;
  }
  if (concept.canonicalLabel !== candidate.canonicalLabel) {
    return false;
  }
  const provenance = candidate.provenance;
  const occurrence = findOccurrenceByIdentity(db, {
    extractionVersion: provenance.extractionVersion,
    sourceType: provenance.sourceType,
    messageId: provenance.messageId,
    evidenceRef: provenance.evidenceRef,
    conceptId: concept.id,
  });
  if (!occurrence) {
    return false;
  }
  if (occurrence.sessionId !== provenance.sessionId) {
    return false;
  }
  return true;
}

/**
 * Resume-only read-only verifier. Fresh path must not treat normalizedKey
 * existence alone as already applied.
 */
export function verifyPreparedIncrementalNewAdmissionAlreadyApplied(
  manifest: IncrementalNewAdmissionManifest,
  db: ConceptQueryDb,
): PreparedNewExactRecoveryResult {
  const admitted = manifest.admittedCandidates;
  if (admitted.length === 0) {
    return { ok: true, alreadyAppliedExact: true };
  }

  let exactMatches = 0;
  for (const candidate of admitted) {
    if (candidateExactMatch(db, candidate)) {
      exactMatches += 1;
    }
  }

  if (exactMatches === admitted.length) {
    return { ok: true, alreadyAppliedExact: true };
  }
  if (exactMatches === 0) {
    return { ok: true, alreadyAppliedExact: false };
  }
  return {
    ok: false,
    code: "partial_new_recovery_mismatch",
    detail: `${exactMatches}/${admitted.length}`,
  };
}
