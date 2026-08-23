import { prepareUserEvidenceUnits } from "@/lib/concepts/user-units";
import type { ConceptExtractMessage } from "@/lib/concepts/user-units";
import {
  shortenAdmissionText,
  unitTextKey,
  type AdmissionPilotSnapshot,
} from "./candidates";
import type { AdmissionCandidate } from "./types";
import { cloneAdmissionCandidate } from "./report";

export type AdmissionEvidenceSession = {
  sessionId: string;
  occurredAt: string;
  messages: ConceptExtractMessage[];
};

export type AdmissionEvidenceIntegrity = {
  totalCandidates: number;
  evidenceResolvedCandidates: number;
  evidenceUnresolvedCandidates: number;
  unresolvedCandidateRefs: string[];
};

export function sessionIdsFromAdmissionSnapshot(
  snapshot: AdmissionPilotSnapshot,
) {
  const ids = new Set<string>();
  for (const action of snapshot.actions) {
    if (action.sessionId) {
      ids.add(action.sessionId);
    }
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}

export type AdmissionProvenanceUnit = {
  sessionId: string;
  evidenceRef: string;
  messageId: string;
  text: string;
};

export function reconstructAdmissionProvenance(
  sessions: AdmissionEvidenceSession[],
) {
  const units: Record<string, AdmissionProvenanceUnit> = {};
  const unitTexts: Record<string, string> = {};
  const sessionOccurredAt: Record<string, string> = {};
  for (const session of sessions) {
    sessionOccurredAt[session.sessionId] = session.occurredAt;
    for (const unit of prepareUserEvidenceUnits(session)) {
      const key = unitTextKey(unit.sessionId, unit.evidenceRef);
      units[key] = {
        sessionId: unit.sessionId,
        evidenceRef: unit.evidenceRef,
        messageId: unit.messageId,
        text: unit.text,
      };
      unitTexts[key] = unit.text;
    }
  }
  return { units, unitTexts, sessionOccurredAt };
}

export function reconstructAdmissionUnitTexts(
  sessions: AdmissionEvidenceSession[],
) {
  const reconstructed = reconstructAdmissionProvenance(sessions);
  return {
    unitTexts: reconstructed.unitTexts,
    sessionOccurredAt: reconstructed.sessionOccurredAt,
  };
}

export function isResolvedAdmissionEvidence(
  candidate: AdmissionCandidate,
  unitTexts: Record<string, string>,
) {
  return candidate.representativeEvidence.some((item) =>
    Boolean(unitTexts[unitTextKey(item.sessionId, item.evidenceRef)]?.trim()),
  );
}

export function withResolvedAdmissionEvidence(
  candidates: AdmissionCandidate[],
  unitTexts: Record<string, string>,
) {
  const resolved = candidates.map((candidate) => {
    const clone = cloneAdmissionCandidate(candidate);
    clone.representativeEvidence = candidate.representativeEvidence.flatMap(
      (item) => {
        const text = unitTexts[unitTextKey(item.sessionId, item.evidenceRef)];
        if (!text?.trim()) {
          return [];
        }
        return [
          {
            ...item,
            shortText: shortenAdmissionText(text),
          },
        ];
      },
    );
    return clone;
  });
  const unresolvedCandidateRefs = resolved
    .filter((item) => item.representativeEvidence.length === 0)
    .map((item) => item.candidateRef);
  const integrity: AdmissionEvidenceIntegrity = {
    totalCandidates: resolved.length,
    evidenceResolvedCandidates:
      resolved.length - unresolvedCandidateRefs.length,
    evidenceUnresolvedCandidates: unresolvedCandidateRefs.length,
    unresolvedCandidateRefs,
  };
  return { candidates: resolved, integrity };
}

export function checkAdmissionEvidenceIntegrity(
  candidates: AdmissionCandidate[],
  unitTexts: Record<string, string>,
): AdmissionEvidenceIntegrity {
  return withResolvedAdmissionEvidence(candidates, unitTexts).integrity;
}
