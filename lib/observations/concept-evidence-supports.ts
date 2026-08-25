import { extractObservationEvidenceAnchors } from "@/lib/thought-map/provenance-join-audit";
import {
  CANONICAL_EVIDENCE_REJECTION_REASONS,
  canonicalEvidenceIdentityKey,
  resolveConceptOccurrenceEvidenceIdentity,
  resolveObservationEvidenceIdentity,
  serializeCanonicalEvidenceLocalRef,
  type CanonicalEvidenceRejectionReason,
  type CanonicalEvidenceResolutionContext,
} from "./canonical-evidence-identity";

export const OBSERVATION_CONCEPT_EVIDENCE_RELATION_KIND =
  "exact_evidence_provenance";

export const OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V1 =
  "observation-concept-exact-evidence-v1";

export const OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V2 =
  "observation-concept-exact-evidence-v2";

export const OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION =
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V2;

export const OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSIONS = [
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V1,
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V2,
] as const;

export type ObservationConceptEvidenceRelationVersion =
  (typeof OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSIONS)[number];

export type ObservationConceptEvidenceSupport = {
  observationId: string;
  conceptId: string;
  sessionId: string;
  messageId: string;
  evidenceRef: string;
  relationKind: typeof OBSERVATION_CONCEPT_EVIDENCE_RELATION_KIND;
  relationVersion: ObservationConceptEvidenceRelationVersion;
};

export type ObservationConceptRelationPair = {
  observationId: string;
  conceptId: string;
  relationVersion: ObservationConceptEvidenceRelationVersion;
  supportCount: number;
};

export type BuildObservationConceptEvidenceSupportsInput = {
  observations: Array<{
    observationId: string;
    kind: string;
    payload: string;
    sourceReviewId?: string;
  }>;
  conceptOccurrences: Array<{
    conceptId: string;
    sessionId: string;
    messageId: string;
    evidenceRef: string;
  }>;
};

export type CanonicalEvidenceDiagnosticCounts = {
  total: number;
  resolved: number;
} & Record<CanonicalEvidenceRejectionReason, number>;

export type BuildObservationConceptEvidenceSupportsV2Result = {
  supports: ObservationConceptEvidenceSupport[];
  observationDiagnostics: CanonicalEvidenceDiagnosticCounts;
  conceptDiagnostics: CanonicalEvidenceDiagnosticCounts;
  canonicalIdentityCount: number;
  canonicalIdentityCollisions: number;
};

function nonEmpty(value: string | null | undefined) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function evidenceKey(input: {
  sessionId: string;
  messageId: string;
  evidenceRef: string;
}) {
  return `${input.sessionId}\0${input.messageId}\0${input.evidenceRef}`;
}

function supportKey(row: ObservationConceptEvidenceSupport) {
  return [
    row.relationVersion,
    row.observationId,
    row.conceptId,
    row.sessionId,
    row.messageId,
    row.evidenceRef,
  ].join("\0");
}

function compareSupport(
  left: ObservationConceptEvidenceSupport,
  right: ObservationConceptEvidenceSupport,
) {
  return supportKey(left).localeCompare(supportKey(right));
}

function emptyCanonicalDiagnostics(): CanonicalEvidenceDiagnosticCounts {
  return Object.assign(
    { total: 0, resolved: 0 },
    Object.fromEntries(
      CANONICAL_EVIDENCE_REJECTION_REASONS.map((reason) => [reason, 0]),
    ) as Record<CanonicalEvidenceRejectionReason, number>,
  );
}

function recordResolution(
  diagnostics: CanonicalEvidenceDiagnosticCounts,
  resolution:
    | { ok: true }
    | { ok: false; reason: CanonicalEvidenceRejectionReason },
) {
  diagnostics.total += 1;
  if (resolution.ok) {
    diagnostics.resolved += 1;
  } else {
    diagnostics[resolution.reason] += 1;
  }
}

/**
 * Exact Evidence Unit identity only.
 * Does not use date, session-only, message-only, text, or semantic matching.
 */
export function buildObservationConceptEvidenceSupports(
  input: BuildObservationConceptEvidenceSupportsInput,
): ObservationConceptEvidenceSupport[] {
  const occurrencesByEvidence = new Map<string, Set<string>>();
  for (const occurrence of input.conceptOccurrences) {
    const sessionId = nonEmpty(occurrence.sessionId);
    const messageId = nonEmpty(occurrence.messageId);
    const evidenceRef = nonEmpty(occurrence.evidenceRef);
    const conceptId = nonEmpty(occurrence.conceptId);
    if (!sessionId || !messageId || !evidenceRef || !conceptId) {
      continue;
    }
    const key = evidenceKey({ sessionId, messageId, evidenceRef });
    const concepts = occurrencesByEvidence.get(key) ?? new Set<string>();
    concepts.add(conceptId);
    occurrencesByEvidence.set(key, concepts);
  }

  const unique = new Map<string, ObservationConceptEvidenceSupport>();
  for (const observation of input.observations) {
    const seenAnchors = new Set<string>();
    for (const anchor of extractObservationEvidenceAnchors({
      observationId: observation.observationId,
      kind: observation.kind,
      payload: observation.payload,
    })) {
      const sessionId = nonEmpty(anchor.sessionId);
      const messageId = nonEmpty(anchor.messageId);
      const evidenceRef = nonEmpty(anchor.evidenceRef);
      if (!sessionId || !messageId || !evidenceRef) {
        continue;
      }
      const anchorKey = evidenceKey({ sessionId, messageId, evidenceRef });
      if (seenAnchors.has(anchorKey)) {
        continue;
      }
      seenAnchors.add(anchorKey);
      const conceptIds = occurrencesByEvidence.get(anchorKey);
      if (!conceptIds) {
        continue;
      }
      for (const conceptId of conceptIds) {
        const row: ObservationConceptEvidenceSupport = {
          observationId: observation.observationId,
          conceptId,
          sessionId,
          messageId,
          evidenceRef,
          relationKind: OBSERVATION_CONCEPT_EVIDENCE_RELATION_KIND,
          relationVersion:
            OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V1,
        };
        unique.set(supportKey(row), row);
      }
    }
  }

  return [...unique.values()].sort(compareSupport);
}

/**
 * Relation v2 resolves producer-specific coordinates to the exact canonical
 * source unit: persistent Session + persistent Message + validated unit
 * ordinal. It never compares text or repairs noncanonical producer refs.
 */
export function buildObservationConceptEvidenceSupportsV2(
  input: BuildObservationConceptEvidenceSupportsInput & {
    context: CanonicalEvidenceResolutionContext;
  },
): BuildObservationConceptEvidenceSupportsV2Result {
  const observationDiagnostics = emptyCanonicalDiagnostics();
  const conceptDiagnostics = emptyCanonicalDiagnostics();
  const canonicalIdentities = new Map<
    string,
    { sessionId: string; messageId: string; evidenceOrdinal: number }
  >();
  let canonicalIdentityCollisions = 0;

  const rememberIdentity = (identity: {
    sessionId: string;
    messageId: string;
    evidenceOrdinal: number;
  }) => {
    const key = canonicalEvidenceIdentityKey(identity);
    const existing = canonicalIdentities.get(key);
    if (
      existing &&
      (existing.sessionId !== identity.sessionId ||
        existing.messageId !== identity.messageId ||
        existing.evidenceOrdinal !== identity.evidenceOrdinal)
    ) {
      canonicalIdentityCollisions += 1;
      return key;
    }
    canonicalIdentities.set(key, identity);
    return key;
  };

  const occurrencesByEvidence = new Map<string, Set<string>>();
  for (const occurrence of input.conceptOccurrences) {
    const resolution = resolveConceptOccurrenceEvidenceIdentity({
      sessionId: occurrence.sessionId,
      messageId: occurrence.messageId,
      evidenceRef: occurrence.evidenceRef,
      session: input.context.conceptSessionsById.get(occurrence.sessionId),
    });
    recordResolution(conceptDiagnostics, resolution);
    if (!resolution.ok || !nonEmpty(occurrence.conceptId)) {
      continue;
    }
    const key = rememberIdentity(resolution.identity);
    const concepts = occurrencesByEvidence.get(key) ?? new Set<string>();
    concepts.add(occurrence.conceptId);
    occurrencesByEvidence.set(key, concepts);
  }

  const unique = new Map<string, ObservationConceptEvidenceSupport>();
  for (const observation of input.observations) {
    const seenAnchors = new Set<string>();
    for (const anchor of extractObservationEvidenceAnchors({
      observationId: observation.observationId,
      kind: observation.kind,
      payload: observation.payload,
    })) {
      const sourceReviewId = observation.sourceReviewId ?? "";
      const resolution = resolveObservationEvidenceIdentity({
        sourceReviewId,
        sessionId: anchor.sessionId,
        messageId: anchor.messageId,
        evidenceRef: anchor.evidenceRef,
        reviewSources: input.context.reviewSourcesByReviewId.get(sourceReviewId),
      });
      recordResolution(observationDiagnostics, resolution);
      if (!resolution.ok) {
        continue;
      }
      const anchorKey = rememberIdentity(resolution.identity);
      if (seenAnchors.has(anchorKey)) {
        continue;
      }
      seenAnchors.add(anchorKey);
      const conceptIds = occurrencesByEvidence.get(anchorKey);
      if (!conceptIds) {
        continue;
      }
      for (const conceptId of conceptIds) {
        const row: ObservationConceptEvidenceSupport = {
          observationId: observation.observationId,
          conceptId,
          sessionId: resolution.identity.sessionId,
          messageId: resolution.identity.messageId,
          evidenceRef: serializeCanonicalEvidenceLocalRef(
            resolution.identity.evidenceOrdinal,
          ),
          relationKind: OBSERVATION_CONCEPT_EVIDENCE_RELATION_KIND,
          relationVersion:
            OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V2,
        };
        unique.set(supportKey(row), row);
      }
    }
  }

  return {
    supports: [...unique.values()].sort(compareSupport),
    observationDiagnostics,
    conceptDiagnostics,
    canonicalIdentityCount: canonicalIdentities.size,
    canonicalIdentityCollisions,
  };
}

export function toObservationConceptRelationPairs(
  supports: ObservationConceptEvidenceSupport[],
): ObservationConceptRelationPair[] {
  const counts = new Map<string, ObservationConceptRelationPair>();
  for (const row of supports) {
    const key = `${row.relationVersion}\0${row.observationId}\0${row.conceptId}`;
    const current = counts.get(key);
    if (current) {
      current.supportCount += 1;
      continue;
    }
    counts.set(key, {
      observationId: row.observationId,
      conceptId: row.conceptId,
      relationVersion: row.relationVersion,
      supportCount: 1,
    });
  }
  return [...counts.values()].sort((left, right) => {
    const byObservation = left.observationId.localeCompare(right.observationId);
    if (byObservation !== 0) {
      return byObservation;
    }
    return left.conceptId.localeCompare(right.conceptId);
  });
}
