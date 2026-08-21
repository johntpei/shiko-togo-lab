import { validateAdmissionCoverage } from "./validation";
import type { AdmissionCoverage } from "./validation";
import {
  ADMISSION_REASON_CODES,
  type AdmissionCalibrationLabel,
  type AdmissionCandidate,
  type AdmissionDecision,
  type AdmissionDecisionKind,
  type AdmissionJudgedCandidate,
  type AdmissionReasonCode,
  type AdmissionReport,
  type AdmissionReportRow,
} from "./types";

export type ApplyAdmissionResult =
  | { ok: true; judged: AdmissionJudgedCandidate[]; report: AdmissionReport }
  | (AdmissionCoverage & { ok: false });

export function applyAdmissionDecisions(
  candidates: AdmissionCandidate[],
  decisions: AdmissionDecision[],
): ApplyAdmissionResult {
  const coverage = validateAdmissionCoverage({ candidates, decisions });
  if (!coverage.ok) {
    return coverage;
  }
  const byRef = new Map(
    decisions.map((item) => [item.candidateRef, item] as const),
  );
  const judged: AdmissionJudgedCandidate[] = candidates.map((candidate) => {
    const decision = byRef.get(candidate.candidateRef)!;
    return {
      ...cloneAdmissionCandidate(candidate),
      decision: decision.decision as AdmissionDecisionKind,
      reasonCode: decision.reasonCode as AdmissionReasonCode,
    };
  });
  return { ok: true, judged, report: buildAdmissionReport(judged) };
}

export function cloneAdmissionCandidate(
  candidate: AdmissionCandidate,
): AdmissionCandidate {
  return {
    candidateRef: candidate.candidateRef,
    canonicalLabel: candidate.canonicalLabel,
    normalizedKey: candidate.normalizedKey,
    occurrenceCount: candidate.occurrenceCount,
    distinctSessionCount: candidate.distinctSessionCount,
    firstSeenAt: candidate.firstSeenAt,
    lastSeenAt: candidate.lastSeenAt,
    sessionIds: [...candidate.sessionIds],
    evidenceRefs: [...candidate.evidenceRefs],
    suspiciousFlags: [...candidate.suspiciousFlags],
    matchKindsSeen: [...candidate.matchKindsSeen],
    representativeEvidence: candidate.representativeEvidence.map((item) => ({
      ...item,
    })),
    provisionalHints: candidate.provisionalHints.map((item) => ({ ...item })),
  };
}

export function buildAdmissionReport(
  judged: AdmissionJudgedCandidate[],
): AdmissionReport {
  const reasonCodeCounts = emptyReasonCounts();
  const admitted: AdmissionReportRow[] = [];
  const deferred: AdmissionReportRow[] = [];
  const rejected: AdmissionReportRow[] = [];
  for (const item of judged) {
    reasonCodeCounts[item.reasonCode] += 1;
    const row = toReportRow(item);
    if (item.decision === "admit") {
      admitted.push(row);
    } else if (item.decision === "defer") {
      deferred.push(row);
    } else {
      rejected.push(row);
    }
  }
  return {
    totals: {
      totalCandidates: judged.length,
      admitted: admitted.length,
      deferred: deferred.length,
      rejected: rejected.length,
      reasonCodeCounts,
    },
    admitted,
    deferred,
    rejected,
    perSession: buildPerSession(judged),
  };
}

function toReportRow(item: AdmissionJudgedCandidate): AdmissionReportRow {
  return {
    candidateRef: item.candidateRef,
    canonicalLabel: item.canonicalLabel,
    occurrenceCount: item.occurrenceCount,
    distinctSessionCount: item.distinctSessionCount,
    reasonCode: item.reasonCode,
  };
}

function emptyReasonCounts(): Record<AdmissionReasonCode, number> {
  return Object.fromEntries(
    ADMISSION_REASON_CODES.map((code) => [code, 0]),
  ) as Record<AdmissionReasonCode, number>;
}

function buildPerSession(judged: AdmissionJudgedCandidate[]) {
  const sessions = new Map<
    string,
    {
      candidateCount: number;
      admittedCount: number;
      deferredCount: number;
      rejectedCount: number;
    }
  >();
  for (const item of judged) {
    for (const sessionId of item.sessionIds) {
      const row = sessions.get(sessionId) ?? {
        candidateCount: 0,
        admittedCount: 0,
        deferredCount: 0,
        rejectedCount: 0,
      };
      row.candidateCount += 1;
      if (item.decision === "admit") {
        row.admittedCount += 1;
      } else if (item.decision === "defer") {
        row.deferredCount += 1;
      } else {
        row.rejectedCount += 1;
      }
      sessions.set(sessionId, row);
    }
  }
  return [...sessions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sessionId, counts]) => ({ sessionId, ...counts }));
}

export type AdmissionCalibrationResult = {
  labeledCandidateCount: number;
  admittedABRatio: number | null;
  admittedCDRatio: number | null;
  classAAdmitRate: number | null;
  classDRejectRate: number | null;
  importantDecisions: Array<{
    label: string;
    candidateRef: string | null;
    decision: AdmissionDecisionKind | null;
    found: boolean;
  }>;
};

export function evaluateAdmissionCalibration(input: {
  judged: AdmissionJudgedCandidate[];
  labels: AdmissionCalibrationLabel[];
  importantLabels?: string[];
}): AdmissionCalibrationResult {
  const classByRef = new Map(
    input.labels.map((item) => [item.candidateRef, item.class] as const),
  );
  const admitted = input.judged.filter((item) => item.decision === "admit");
  const admittedLabeled = admitted.filter((item) =>
    classByRef.has(item.candidateRef),
  );
  const admittedAB = admittedLabeled.filter((item) => {
    const klass = classByRef.get(item.candidateRef);
    return klass === "A" || klass === "B";
  }).length;
  const admittedCD = admittedLabeled.filter((item) => {
    const klass = classByRef.get(item.candidateRef);
    return klass === "C" || klass === "D";
  }).length;

  const classA = input.judged.filter(
    (item) => classByRef.get(item.candidateRef) === "A",
  );
  const classD = input.judged.filter(
    (item) => classByRef.get(item.candidateRef) === "D",
  );

  const byLabel = new Map(
    input.judged.map((item) => [item.canonicalLabel, item] as const),
  );

  return {
    labeledCandidateCount: input.labels.length,
    admittedABRatio: ratio(admittedAB, admittedLabeled.length),
    admittedCDRatio: ratio(admittedCD, admittedLabeled.length),
    classAAdmitRate: ratio(
      classA.filter((item) => item.decision === "admit").length,
      classA.length,
    ),
    classDRejectRate: ratio(
      classD.filter((item) => item.decision === "reject").length,
      classD.length,
    ),
    importantDecisions: (input.importantLabels ?? []).map((label) => {
      const hit = byLabel.get(label);
      if (!hit) {
        return {
          label,
          candidateRef: null,
          decision: null,
          found: false,
        };
      }
      return {
        label,
        candidateRef: hit.candidateRef,
        decision: hit.decision,
        found: true,
      };
    }),
  };
}

function ratio(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

export type AdmissionIdentityInvariants = {
  canonicalChanged: number;
  mergedCandidates: number;
  occurrenceChanged: number;
};

export function admissionIdentityInvariants(
  before: AdmissionCandidate[],
  after: Array<Pick<AdmissionCandidate, "candidateRef" | "canonicalLabel" | "normalizedKey" | "occurrenceCount" | "distinctSessionCount" | "evidenceRefs" | "sessionIds">>,
): AdmissionIdentityInvariants {
  const beforeRefs = new Set(before.map((item) => item.candidateRef));
  const afterRefs = new Set(after.map((item) => item.candidateRef));
  let mergedCandidates = 0;
  for (const ref of beforeRefs) {
    if (!afterRefs.has(ref)) {
      mergedCandidates += 1;
    }
  }
  for (const ref of afterRefs) {
    if (!beforeRefs.has(ref)) {
      mergedCandidates += 1;
    }
  }
  const beforeByRef = new Map(before.map((item) => [item.candidateRef, item]));
  let canonicalChanged = 0;
  let occurrenceChanged = 0;
  for (const item of after) {
    const original = beforeByRef.get(item.candidateRef);
    if (!original) {
      continue;
    }
    if (
      original.canonicalLabel !== item.canonicalLabel ||
      original.normalizedKey !== item.normalizedKey
    ) {
      canonicalChanged += 1;
    }
    if (
      original.occurrenceCount !== item.occurrenceCount ||
      original.distinctSessionCount !== item.distinctSessionCount ||
      original.evidenceRefs.join("\0") !== item.evidenceRefs.join("\0") ||
      original.sessionIds.join("\0") !== item.sessionIds.join("\0")
    ) {
      occurrenceChanged += 1;
    }
  }
  return { canonicalChanged, mergedCandidates, occurrenceChanged };
}
