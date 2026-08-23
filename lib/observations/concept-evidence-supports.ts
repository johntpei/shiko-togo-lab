import { extractObservationEvidenceAnchors } from "@/lib/thought-map/provenance-join-audit";

export const OBSERVATION_CONCEPT_EVIDENCE_RELATION_KIND =
  "exact_evidence_provenance";

export const OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION =
  "observation-concept-exact-evidence-v1";

export type ObservationConceptEvidenceSupport = {
  observationId: string;
  conceptId: string;
  sessionId: string;
  messageId: string;
  evidenceRef: string;
  relationKind: typeof OBSERVATION_CONCEPT_EVIDENCE_RELATION_KIND;
  relationVersion: typeof OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION;
};

export type ObservationConceptRelationPair = {
  observationId: string;
  conceptId: string;
  relationVersion: typeof OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION;
  supportCount: number;
};

export type BuildObservationConceptEvidenceSupportsInput = {
  observations: Array<{
    observationId: string;
    kind: string;
    payload: string;
  }>;
  conceptOccurrences: Array<{
    conceptId: string;
    sessionId: string;
    messageId: string;
    evidenceRef: string;
  }>;
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
          relationVersion: OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
        };
        unique.set(supportKey(row), row);
      }
    }
  }

  return [...unique.values()].sort(compareSupport);
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
