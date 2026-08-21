import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAdmissionCandidates,
  unitTextKey,
  type AdmissionPilotActionRow,
  type AdmissionPilotSnapshot,
} from "./candidates";
import { applyAdmissionDecisions, evaluateAdmissionCalibration } from "./report";
import { validateAdmissionCoverage } from "./validation";
import { CONCEPT_ADMISSION_VERSION } from "./types";
import type { AdmissionDecision } from "./types";

const SESSION_A = "080a113a-b0b3-4c50-9160-8415203e4a48";
const SESSION_B = "32935f2d-cac9-4c9e-85f3-c9969717ece2";
const SESSION_C = "a6560a0e-3e32-4681-bd59-ca8ff39f0d2b";
const SESSION_D = "c7d43746-2a7c-4d0f-a7ce-8646bb0aebf3";

function action(input: {
  sessionId: string;
  evidenceRef: string;
  surfaceForm: string;
  resolvedAs: string;
  conceptRef: string;
  matchKind?: string | null;
}): AdmissionPilotActionRow {
  return {
    sessionId: input.sessionId,
    evidenceRef: input.evidenceRef,
    surfaceForm: input.surfaceForm,
    resolvedAs: input.resolvedAs,
    matchKind: input.matchKind ?? null,
    conceptRef: input.conceptRef,
  };
}

function v4LikeSnapshot(): AdmissionPilotSnapshot {
  return {
    concepts: [
      {
        ref: "C20",
        canonicalLabel: "人間関係",
        normalizedKey: "人間関係",
      },
      {
        ref: "C31",
        canonicalLabel: "高性能",
        normalizedKey: "高性能",
      },
      {
        ref: "C42",
        canonicalLabel: "高性能AI",
        normalizedKey: "高性能AI",
      },
      {
        ref: "C22",
        canonicalLabel: "恐ろしいこと",
        normalizedKey: "恐ろしいこと",
      },
    ],
    actions: [
      action({
        sessionId: SESSION_A,
        evidenceRef: "M011:E02",
        surfaceForm: "人間関係",
        resolvedAs: "new",
        conceptRef: "C20",
      }),
      action({
        sessionId: SESSION_B,
        evidenceRef: "M005:E02",
        surfaceForm: "人間関係",
        resolvedAs: "match",
        matchKind: "exact",
        conceptRef: "C20",
      }),
      action({
        sessionId: SESSION_C,
        evidenceRef: "M016:E01",
        surfaceForm: "高性能",
        resolvedAs: "new",
        conceptRef: "C31",
      }),
      action({
        sessionId: SESSION_D,
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        resolvedAs: "new",
        matchKind: "semantic",
        conceptRef: "C42",
      }),
      {
        sessionId: SESSION_D,
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        resolvedAs: "provisional_match",
        matchKind: "semantic",
        conceptRef: "C42",
      },
      action({
        sessionId: SESSION_B,
        evidenceRef: "M003:E03",
        surfaceForm: "恐ろしいこと",
        resolvedAs: "new",
        conceptRef: "C22",
      }),
    ],
    suspicious: [
      { kind: "generic_surface", conceptRef: "C31" },
      { kind: "adjective_only", conceptRef: "C31" },
      { kind: "clause_like", conceptRef: "C22" },
    ],
    provisionalMatches: [
      {
        sessionId: SESSION_D,
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        candidateConceptRef: "C31",
        existingCanonicalLabel: "高性能",
      },
    ],
  };
}

const SESSION_OCCURRED_AT = {
  [SESSION_A]: "2026-07-15",
  [SESSION_B]: "2026-07-16",
  [SESSION_C]: "2026-07-18",
  [SESSION_D]: "2026-08-02",
};

test("admission version は concept-admission-v1", () => {
  assert.equal(CONCEPT_ADMISSION_VERSION, "concept-admission-v1");
});

test("v4 report 形から Candidate を構築し occurrence を維持する", () => {
  const built = buildAdmissionCandidates({
    snapshot: v4LikeSnapshot(),
    sessionOccurredAt: SESSION_OCCURRED_AT,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const relation = built.candidates.find((item) => item.candidateRef === "C20");
  assert.ok(relation);
  assert.equal(relation?.canonicalLabel, "人間関係");
  assert.equal(relation?.normalizedKey, "人間関係");
  assert.equal(relation?.occurrenceCount, 2);
  assert.equal(relation?.distinctSessionCount, 2);
  assert.equal(relation?.firstSeenAt, "2026-07-15");
  assert.equal(relation?.lastSeenAt, "2026-07-16");
  assert.deepEqual(relation?.sessionIds, [SESSION_A, SESSION_B].sort());
  assert.deepEqual(relation?.evidenceRefs, ["M011:E02", "M005:E02"]);
  assert.deepEqual(relation?.matchKindsSeen, ["exact", "new"]);
  assert.equal(relation?.provisionalHints.length, 0);
});

test("suspiciousFlags と semantic provisional hint を持ち merge しない", () => {
  const built = buildAdmissionCandidates({
    snapshot: v4LikeSnapshot(),
    sessionOccurredAt: SESSION_OCCURRED_AT,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const generic = built.candidates.find((item) => item.candidateRef === "C31");
  const specific = built.candidates.find((item) => item.candidateRef === "C42");
  assert.deepEqual(generic?.suspiciousFlags, ["adjective_only", "generic_surface"]);
  assert.equal(specific?.canonicalLabel, "高性能AI");
  assert.equal(generic?.canonicalLabel, "高性能");
  assert.equal(specific?.candidateRef !== generic?.candidateRef, true);
  assert.equal(built.candidates.length, 4);
  assert.equal(specific?.provisionalHints[0]?.otherCandidateRef, "C31");
  assert.equal(specific?.provisionalHints[0]?.otherCanonicalLabel, "高性能");
});

test("representative Evidence は USER surface、最大2、distinct Session 優先", () => {
  const built = buildAdmissionCandidates({
    snapshot: {
      concepts: [
        { ref: "C20", canonicalLabel: "人間関係", normalizedKey: "人間関係" },
      ],
      actions: [
        action({
          sessionId: SESSION_A,
          evidenceRef: "M011:E02",
          surfaceForm: "人間関係",
          resolvedAs: "new",
          conceptRef: "C20",
        }),
        action({
          sessionId: SESSION_A,
          evidenceRef: "M011:E03",
          surfaceForm: "人間関係",
          resolvedAs: "new",
          conceptRef: "C20",
        }),
        action({
          sessionId: SESSION_B,
          evidenceRef: "M005:E02",
          surfaceForm: "人間関係",
          resolvedAs: "match",
          matchKind: "exact",
          conceptRef: "C20",
        }),
      ],
    },
    sessionOccurredAt: SESSION_OCCURRED_AT,
    unitTexts: {
      [unitTextKey(SESSION_A, "M011:E02")]: "これまでの人間関係でなぜ上手くいかないのか",
      [unitTextKey(SESSION_A, "M011:E03")]: "同じSessionの別Unitは選ばれない想定",
      [unitTextKey(SESSION_B, "M005:E02")]: "人間関係を最小限にする道を選びました",
    },
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const evidence = built.candidates[0]?.representativeEvidence ?? [];
  assert.equal(evidence.length, 2);
  assert.equal(evidence[0]?.sessionId, SESSION_A);
  assert.equal(evidence[0]?.evidenceRef, "M011:E02");
  assert.equal(evidence[1]?.sessionId, SESSION_B);
  assert.equal(evidence[1]?.evidenceRef, "M005:E02");
  assert.match(evidence[0]?.shortText ?? "", /人間関係/);
  assert.equal(evidence.some((item) => item.evidenceRef === "M011:E03"), false);
});

test("representative Evidence は決定論的で Assistant 本文を使わない", () => {
  const snapshot: AdmissionPilotSnapshot = {
    concepts: [
      { ref: "C01", canonicalLabel: "高性能AI", normalizedKey: "高性能AI" },
    ],
    actions: [
      action({
        sessionId: SESSION_D,
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        resolvedAs: "new",
        conceptRef: "C01",
      }),
    ],
  };
  const first = buildAdmissionCandidates({
    snapshot,
    sessionOccurredAt: SESSION_OCCURRED_AT,
  });
  const second = buildAdmissionCandidates({
    snapshot,
    sessionOccurredAt: SESSION_OCCURRED_AT,
  });
  assert.deepEqual(first, second);
  if (!first.ok) {
    return;
  }
  assert.equal(first.candidates[0]?.representativeEvidence[0]?.shortText, "高性能AI");
  assert.doesNotMatch(
    first.candidates[0]?.representativeEvidence[0]?.shortText ?? "",
    /了解しました/,
  );
});

test("duplicate CandidateRef は構築時に拒否する", () => {
  const built = buildAdmissionCandidates({
    snapshot: {
      concepts: [
        { ref: "C01", canonicalLabel: "A", normalizedKey: "a" },
        { ref: "C01", canonicalLabel: "B", normalizedKey: "b" },
      ],
      actions: [],
    },
  });
  assert.equal(built.ok, false);
  if (built.ok) {
    return;
  }
  assert.equal(built.reason, "duplicate_candidate_ref");
  assert.equal(built.detail, "C01");
});

test("coverage は全Refちょうど1件", () => {
  const built = buildAdmissionCandidates({
    snapshot: v4LikeSnapshot(),
    sessionOccurredAt: SESSION_OCCURRED_AT,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const valid: AdmissionDecision[] = [
    { candidateRef: "C20", decision: "admit", reasonCode: "stable_topic" },
    { candidateRef: "C31", decision: "reject", reasonCode: "generic" },
    { candidateRef: "C42", decision: "admit", reasonCode: "specific_named_concept" },
    { candidateRef: "C22", decision: "reject", reasonCode: "clause" },
  ];
  assert.equal(
    validateAdmissionCoverage({ candidates: built.candidates, decisions: valid }).ok,
    true,
  );
  assert.equal(
    validateAdmissionCoverage({
      candidates: built.candidates,
      decisions: valid.slice(1),
    }).reason,
    "missing_candidate_ref",
  );
  assert.equal(
    validateAdmissionCoverage({
      candidates: built.candidates,
      decisions: [...valid, valid[0]!],
    }).reason,
    "duplicate_candidate_ref",
  );
  assert.equal(
    validateAdmissionCoverage({
      candidates: built.candidates,
      decisions: [
        ...valid.slice(0, 3),
        { candidateRef: "C99", decision: "reject", reasonCode: "generic" },
      ],
    }).reason,
    "unknown_candidate_ref",
  );
});

test("decision / reason の許可と矛盾を検証する", () => {
  const candidates = [{ candidateRef: "C01" }];
  assert.equal(
    validateAdmissionCoverage({
      candidates,
      decisions: [
        { candidateRef: "C01", decision: "admit", reasonCode: "stable_topic" },
      ],
    }).ok,
    true,
  );
  assert.equal(
    validateAdmissionCoverage({
      candidates,
      decisions: [
        {
          candidateRef: "C01",
          decision: "defer",
          reasonCode: "insufficient_context",
        },
      ],
    }).ok,
    true,
  );
  assert.equal(
    validateAdmissionCoverage({
      candidates,
      decisions: [
        { candidateRef: "C01", decision: "reject", reasonCode: "generic" },
      ],
    }).ok,
    true,
  );
  assert.equal(
    validateAdmissionCoverage({
      candidates,
      decisions: [
        { candidateRef: "C01", decision: "admit", reasonCode: "generic" },
      ],
    }).reason,
    "invalid_decision_reason",
  );
  assert.equal(
    validateAdmissionCoverage({
      candidates,
      decisions: [
        { candidateRef: "C01", decision: "reject", reasonCode: "stable_topic" },
      ],
    }).reason,
    "invalid_decision_reason",
  );
  assert.equal(
    validateAdmissionCoverage({
      candidates,
      decisions: [
        { candidateRef: "C01", decision: "keep", reasonCode: "stable_topic" },
      ],
    }).reason,
    "invalid_decision",
  );
  assert.equal(
    validateAdmissionCoverage({
      candidates,
      decisions: [
        { candidateRef: "C01", decision: "admit", reasonCode: "mystery" },
      ],
    }).reason,
    "invalid_reason_code",
  );
});

test("Admission は canonical / occurrence を変更せず decision だけ付ける", () => {
  const built = buildAdmissionCandidates({
    snapshot: v4LikeSnapshot(),
    sessionOccurredAt: SESSION_OCCURRED_AT,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const before = structuredClone(built.candidates);
  const result = applyAdmissionDecisions(built.candidates, [
    { candidateRef: "C20", decision: "admit", reasonCode: "longitudinal_value" },
    { candidateRef: "C31", decision: "reject", reasonCode: "generic" },
    {
      candidateRef: "C42",
      decision: "admit",
      reasonCode: "specific_named_concept",
    },
    { candidateRef: "C22", decision: "reject", reasonCode: "clause" },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(built.candidates, before);
  const relation = result.judged.find((item) => item.candidateRef === "C20");
  assert.equal(relation?.decision, "admit");
  assert.equal(relation?.canonicalLabel, "人間関係");
  assert.equal(relation?.occurrenceCount, 2);
  assert.equal(relation?.distinctSessionCount, 2);
  assert.equal(relation?.evidenceRefs.length, 2);
});

test("report は totals / reasonCode / perSession を出す", () => {
  const built = buildAdmissionCandidates({
    snapshot: v4LikeSnapshot(),
    sessionOccurredAt: SESSION_OCCURRED_AT,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const result = applyAdmissionDecisions(built.candidates, [
    { candidateRef: "C20", decision: "admit", reasonCode: "longitudinal_value" },
    { candidateRef: "C31", decision: "reject", reasonCode: "generic" },
    {
      candidateRef: "C42",
      decision: "admit",
      reasonCode: "specific_named_concept",
    },
    { candidateRef: "C22", decision: "defer", reasonCode: "insufficient_context" },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.report.totals.totalCandidates, 4);
  assert.equal(result.report.totals.admitted, 2);
  assert.equal(result.report.totals.deferred, 1);
  assert.equal(result.report.totals.rejected, 1);
  assert.equal(result.report.totals.reasonCodeCounts.longitudinal_value, 1);
  assert.equal(result.report.totals.reasonCodeCounts.generic, 1);
  const sessionA = result.report.perSession.find(
    (item) => item.sessionId === SESSION_A,
  );
  assert.equal(sessionA?.candidateCount, 1);
  assert.equal(sessionA?.admittedCount, 1);
  const sessionB = result.report.perSession.find(
    (item) => item.sessionId === SESSION_B,
  );
  assert.equal(sessionB?.candidateCount, 2);
  assert.equal(sessionB?.admittedCount, 1);
  assert.equal(sessionB?.deferredCount, 1);
});

test("calibration helper は A+B 比率と important decision を fixture から計算する", () => {
  const built = buildAdmissionCandidates({
    snapshot: v4LikeSnapshot(),
    sessionOccurredAt: SESSION_OCCURRED_AT,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const result = applyAdmissionDecisions(built.candidates, [
    { candidateRef: "C20", decision: "admit", reasonCode: "stable_topic" },
    { candidateRef: "C31", decision: "reject", reasonCode: "generic" },
    {
      candidateRef: "C42",
      decision: "admit",
      reasonCode: "specific_named_concept",
    },
    { candidateRef: "C22", decision: "reject", reasonCode: "clause" },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const calibration = evaluateAdmissionCalibration({
    judged: result.judged,
    labels: [
      { candidateRef: "C20", class: "A" },
      { candidateRef: "C42", class: "A" },
      { candidateRef: "C31", class: "C" },
      { candidateRef: "C22", class: "D" },
    ],
    importantLabels: ["人間関係", "高性能AI", "第2の脳"],
  });
  assert.equal(calibration.admittedABRatio, 1);
  assert.equal(calibration.admittedCDRatio, 0);
  assert.equal(calibration.classAAdmitRate, 1);
  assert.equal(calibration.classDRejectRate, 1);
  assert.equal(calibration.importantDecisions[0]?.found, true);
  assert.equal(calibration.importantDecisions[0]?.decision, "admit");
  assert.equal(calibration.importantDecisions[1]?.decision, "admit");
  assert.equal(calibration.importantDecisions[2]?.found, false);
});
