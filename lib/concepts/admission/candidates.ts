import {
  ADMISSION_SHORT_TEXT_MAX_CHARS,
  MAX_REPRESENTATIVE_EVIDENCE,
  type AdmissionCandidate,
  type AdmissionProvisionalHint,
  type AdmissionRepresentativeEvidence,
} from "./types";

export type AdmissionPilotConceptRow = {
  ref: string;
  canonicalLabel: string;
  normalizedKey: string;
};

export type AdmissionPilotActionRow = {
  sessionId: string;
  evidenceRef: string;
  surfaceForm: string;
  resolvedAs: string | null;
  matchKind: string | null;
  conceptRef: string | null;
};

export type AdmissionPilotSuspiciousRow = {
  kind: string;
  conceptRef?: string;
};

export type AdmissionPilotProvisionalRow = {
  sessionId: string;
  evidenceRef: string;
  surfaceForm: string;
  candidateConceptRef: string;
  existingCanonicalLabel: string;
};

export type AdmissionPilotSnapshot = {
  concepts: AdmissionPilotConceptRow[];
  actions: AdmissionPilotActionRow[];
  suspicious?: AdmissionPilotSuspiciousRow[];
  provisionalMatches?: AdmissionPilotProvisionalRow[];
};

export type BuildAdmissionCandidatesInput = {
  snapshot: AdmissionPilotSnapshot;
  sessionOccurredAt?: Record<string, string>;
  unitTexts?: Record<string, string>;
};

export type BuildAdmissionCandidatesResult =
  | { ok: true; candidates: AdmissionCandidate[] }
  | { ok: false; reason: "duplicate_candidate_ref"; detail: string };

export type CandidateOccurrence = {
  sessionId: string;
  evidenceRef: string;
  occurredAt: string;
  surfaceForm: string;
  matchKind: string | null;
  resolvedAs: string;
};

const ACCEPTED_RESOLVED = new Set(["new", "match"]);

export type AdmissionOccurrenceRow = CandidateOccurrence;

export function collectAdmissionOccurrences(
  snapshot: AdmissionPilotSnapshot,
  sessionOccurredAt?: Record<string, string>,
) {
  const occurrencesByRef = new Map<string, CandidateOccurrence[]>();
  for (const action of snapshot.actions) {
    if (!action.conceptRef || !ACCEPTED_RESOLVED.has(action.resolvedAs ?? "")) {
      continue;
    }
    const list = occurrencesByRef.get(action.conceptRef) ?? [];
    const occurredAt = sessionOccurredAt?.[action.sessionId] ?? "";
    const key = `${action.sessionId}:${action.evidenceRef}`;
    if (list.some((item) => `${item.sessionId}:${item.evidenceRef}` === key)) {
      continue;
    }
    list.push({
      sessionId: action.sessionId,
      evidenceRef: action.evidenceRef,
      occurredAt,
      surfaceForm: action.surfaceForm,
      matchKind: action.matchKind,
      resolvedAs: action.resolvedAs ?? "new",
    });
    occurrencesByRef.set(action.conceptRef, list);
  }
  const sorted = new Map<string, CandidateOccurrence[]>();
  for (const [ref, list] of occurrencesByRef) {
    sorted.set(ref, sortOccurrences(list));
  }
  return sorted;
}

export function intraCandidateDuplicateOccurrenceKeys(
  snapshot: AdmissionPilotSnapshot,
) {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const action of snapshot.actions) {
    if (!action.conceptRef || !ACCEPTED_RESOLVED.has(action.resolvedAs ?? "")) {
      continue;
    }
    const key = `${action.conceptRef}:${action.sessionId}:${action.evidenceRef}`;
    if (seen.has(key)) {
      duplicates.push(key);
    }
    seen.add(key);
  }
  return duplicates;
}

export function unitTextKey(sessionId: string, evidenceRef: string) {
  return `${sessionId}:${evidenceRef}`;
}

export function shortenAdmissionText(text: string) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  const chars = [...normalized];
  if (chars.length <= ADMISSION_SHORT_TEXT_MAX_CHARS) {
    return normalized;
  }
  return chars.slice(0, ADMISSION_SHORT_TEXT_MAX_CHARS).join("");
}

export function buildAdmissionCandidates(
  input: BuildAdmissionCandidatesInput,
): BuildAdmissionCandidatesResult {
  const seenRefs = new Set<string>();
  for (const row of input.snapshot.concepts) {
    if (seenRefs.has(row.ref)) {
      return { ok: false, reason: "duplicate_candidate_ref", detail: row.ref };
    }
    seenRefs.add(row.ref);
  }

  const occurrencesByRef = collectAdmissionOccurrences(
    input.snapshot,
    input.sessionOccurredAt,
  );

  const candidates = input.snapshot.concepts.map((row) => {
    const occurrences = occurrencesByRef.get(row.ref) ?? [];
    const sessionIds = uniqueSorted(occurrences.map((item) => item.sessionId));
    const occurredAts = occurrences
      .map((item) => item.occurredAt)
      .filter(Boolean)
      .sort();
    return {
      candidateRef: row.ref,
      canonicalLabel: row.canonicalLabel,
      normalizedKey: row.normalizedKey,
      occurrenceCount: occurrences.length,
      distinctSessionCount: sessionIds.length,
      firstSeenAt: occurredAts[0] ?? "",
      lastSeenAt: occurredAts[occurredAts.length - 1] ?? "",
      sessionIds,
      evidenceRefs: occurrences.map((item) => item.evidenceRef),
      suspiciousFlags: suspiciousFlagsFor(
        row.ref,
        input.snapshot.suspicious ?? [],
      ),
      matchKindsSeen: matchKindsFor(occurrences),
      representativeEvidence: selectRepresentativeEvidence(
        occurrences,
        input.unitTexts,
      ),
      provisionalHints: provisionalHintsFor(
        row,
        occurrences,
        input.snapshot.provisionalMatches ?? [],
      ),
    } satisfies AdmissionCandidate;
  });

  return { ok: true, candidates };
}

function sortOccurrences(occurrences: CandidateOccurrence[]) {
  return [...occurrences].sort((left, right) => {
    const byTime = left.occurredAt.localeCompare(right.occurredAt);
    if (byTime !== 0) {
      return byTime;
    }
    const byRef = left.evidenceRef.localeCompare(right.evidenceRef);
    if (byRef !== 0) {
      return byRef;
    }
    return left.sessionId.localeCompare(right.sessionId);
  });
}

export function selectRepresentativeEvidence(
  occurrences: CandidateOccurrence[],
  unitTexts?: Record<string, string>,
): AdmissionRepresentativeEvidence[] {
  const sorted = sortOccurrences(occurrences);
  const picked: CandidateOccurrence[] = [];
  const seenSessions = new Set<string>();
  for (const item of sorted) {
    if (picked.length >= MAX_REPRESENTATIVE_EVIDENCE) {
      break;
    }
    if (seenSessions.has(item.sessionId)) {
      continue;
    }
    picked.push(item);
    seenSessions.add(item.sessionId);
  }
  for (const item of sorted) {
    if (picked.length >= MAX_REPRESENTATIVE_EVIDENCE) {
      break;
    }
    if (picked.includes(item)) {
      continue;
    }
    picked.push(item);
  }
  return picked.map((item) => ({
    sessionId: item.sessionId,
    evidenceRef: item.evidenceRef,
    occurredAt: item.occurredAt,
    shortText: shortenAdmissionText(
      unitTexts?.[unitTextKey(item.sessionId, item.evidenceRef)] ??
        item.surfaceForm,
    ),
  }));
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function suspiciousFlagsFor(
  candidateRef: string,
  findings: AdmissionPilotSuspiciousRow[],
) {
  const flags = findings
    .filter((item) => item.conceptRef === candidateRef)
    .map((item) => item.kind);
  return [...new Set(flags)].sort((left, right) => left.localeCompare(right));
}

function matchKindsFor(occurrences: CandidateOccurrence[]) {
  const kinds = new Set<string>();
  for (const item of occurrences) {
    if (item.matchKind) {
      kinds.add(item.matchKind);
    } else if (item.resolvedAs === "new") {
      kinds.add("new");
    }
  }
  return [...kinds].sort((left, right) => left.localeCompare(right));
}

function provisionalHintsFor(
  row: AdmissionPilotConceptRow,
  occurrences: CandidateOccurrence[],
  matches: AdmissionPilotProvisionalRow[],
): AdmissionProvisionalHint[] {
  const surfaces = new Set(occurrences.map((item) => item.surfaceForm));
  const hints: AdmissionProvisionalHint[] = [];
  const seen = new Set<string>();
  for (const item of matches) {
    if (!surfaces.has(item.surfaceForm)) {
      continue;
    }
    if (item.candidateConceptRef === row.ref) {
      continue;
    }
    const key = `${item.candidateConceptRef}:${item.surfaceForm}:${item.evidenceRef}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    hints.push({
      otherCandidateRef: item.candidateConceptRef,
      otherCanonicalLabel: item.existingCanonicalLabel,
      surfaceForm: item.surfaceForm,
      evidenceRef: item.evidenceRef,
    });
  }
  return hints;
}
