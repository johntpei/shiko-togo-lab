import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCEPT_ADMISSION_ASSESSMENT_VERSION,
  CONCEPT_ADMISSION_POLICY_VERSION,
  type ConceptAssessment,
  type ConceptAssessmentInput,
} from "./assessment-types";
import { validateAssessmentCoverage } from "./assessment-validation";
import {
  ADMISSION_CALIBRATION_FIXTURE_VERSION,
  ADMISSION_CALIBRATION_GOALS,
  evaluateCalibrationGoals,
  evaluatePolicyCalibration,
  parseAdmissionCalibrationFixture,
} from "./calibration";
import {
  ADMISSION_POLICY_SPECS,
  POLICY_HIGH_ONLY,
  POLICY_NAMED_OR_HIGH,
  POLICY_TOPIC_PLUS_SIGNAL,
  applyAdmissionPolicy,
  judgeCandidatesWithPolicy,
  serverSignalsFromCandidate,
} from "./policy";
import { CONCEPT_ADMISSION_VERSION } from "./types";
import type { AdmissionCandidate } from "./types";
import { evaluateAdmissionCalibration } from "./report";

function candidate(
  overrides: Partial<AdmissionCandidate> &
    Pick<AdmissionCandidate, "candidateRef" | "canonicalLabel">,
): AdmissionCandidate {
  return {
    normalizedKey: overrides.canonicalLabel,
    occurrenceCount: 1,
    distinctSessionCount: 1,
    firstSeenAt: "2026-07-15",
    lastSeenAt: "2026-07-15",
    sessionIds: ["session-a"],
    evidenceRefs: ["M001:E01"],
    suspiciousFlags: [],
    matchKindsSeen: ["new"],
    representativeEvidence: [
      {
        sessionId: "session-a",
        evidenceRef: "M001:E01",
        occurredAt: "2026-07-15",
        shortText: "example",
      },
    ],
    provisionalHints: [],
    ...overrides,
  };
}

function assessment(
  input: ConceptAssessmentInput,
): ConceptAssessmentInput {
  return input;
}

function singletonSignals(): ReturnType<typeof serverSignalsFromCandidate> {
  return {
    occurrenceCount: 1,
    distinctSessionCount: 1,
    hasExactRecurrence: false,
    hasObservedAliasRecurrence: false,
    suspiciousFlags: [],
  };
}

function recurringSignals(): ReturnType<typeof serverSignalsFromCandidate> {
  return {
    occurrenceCount: 2,
    distinctSessionCount: 2,
    hasExactRecurrence: true,
    hasObservedAliasRecurrence: false,
    suspiciousFlags: [],
  };
}

test("assessment / policy version は v1 baseline と共存する", () => {
  assert.equal(CONCEPT_ADMISSION_VERSION, "concept-admission-v1");
  assert.equal(
    CONCEPT_ADMISSION_ASSESSMENT_VERSION,
    "concept-admission-assessment-v2",
  );
  assert.equal(CONCEPT_ADMISSION_POLICY_VERSION, "concept-admission-policy-v1");
  assert.deepEqual(
    ADMISSION_POLICY_SPECS.map((item) => item.id),
    ["named_or_high", "topic_plus_signal", "high_only"],
  );
});

test("valid assessment は coverage を通す", () => {
  const coverage = validateAssessmentCoverage({
    candidates: [{ candidateRef: "C20" }, { candidateRef: "C31" }],
    assessments: [
      assessment({
        candidateRef: "C20",
        conceptForm: "stable_topic",
        evidenceRole: "central",
        longitudinalPotential: "high",
      }),
      assessment({
        candidateRef: "C31",
        conceptForm: "generic_head",
        evidenceRole: "supporting",
        longitudinalPotential: "low",
      }),
    ],
  });
  assert.equal(coverage.ok, true);
  if (!coverage.ok) {
    return;
  }
  assert.equal(coverage.assessments[0]?.conceptForm, "stable_topic");
  assert.equal("decision" in coverage.assessments[0]!, false);
  assert.equal("reasonCode" in coverage.assessments[0]!, false);
  assert.equal("canonicalLabel" in coverage.assessments[0]!, false);
});

test("assessment coverage は missing / duplicate / unknown / invalid enum を拒否する", () => {
  const candidates = [{ candidateRef: "C20" }, { candidateRef: "C31" }];
  const validC20 = assessment({
    candidateRef: "C20",
    conceptForm: "stable_topic",
    evidenceRole: "central",
    longitudinalPotential: "high",
  });
  const validC31 = assessment({
    candidateRef: "C31",
    conceptForm: "generic_head",
    evidenceRole: "central",
    longitudinalPotential: "low",
  });

  const missing = validateAssessmentCoverage({
    candidates,
    assessments: [validC20],
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.reason, "missing_candidate_ref");
    assert.equal(missing.detail, "C31");
  }

  const duplicate = validateAssessmentCoverage({
    candidates,
    assessments: [validC20, validC31, validC20],
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.equal(duplicate.reason, "duplicate_candidate_ref");
  }

  const unknown = validateAssessmentCoverage({
    candidates,
    assessments: [
      validC20,
      validC31,
      assessment({
        candidateRef: "C99",
        conceptForm: "stable_topic",
        evidenceRole: "central",
        longitudinalPotential: "high",
      }),
    ],
  });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.equal(unknown.reason, "unknown_candidate_ref");
    assert.equal(unknown.detail, "C99");
  }

  const invalidForm = validateAssessmentCoverage({
    candidates: [{ candidateRef: "C20" }],
    assessments: [
      assessment({
        candidateRef: "C20",
        conceptForm: "generic",
        evidenceRole: "central",
        longitudinalPotential: "high",
      }),
    ],
  });
  assert.equal(invalidForm.ok, false);
  if (!invalidForm.ok) {
    assert.equal(invalidForm.reason, "invalid_concept_form");
  }

  const invalidRole = validateAssessmentCoverage({
    candidates: [{ candidateRef: "C20" }],
    assessments: [
      assessment({
        candidateRef: "C20",
        conceptForm: "stable_topic",
        evidenceRole: "main",
        longitudinalPotential: "high",
      }),
    ],
  });
  assert.equal(invalidRole.ok, false);
  if (!invalidRole.ok) {
    assert.equal(invalidRole.reason, "invalid_evidence_role");
  }

  const invalidPotential = validateAssessmentCoverage({
    candidates: [{ candidateRef: "C20" }],
    assessments: [
      assessment({
        candidateRef: "C20",
        conceptForm: "stable_topic",
        evidenceRole: "central",
        longitudinalPotential: "very_high",
      }),
    ],
  });
  assert.equal(invalidPotential.ok, false);
  if (!invalidPotential.ok) {
    assert.equal(invalidPotential.reason, "invalid_longitudinal_potential");
  }
});

test("server signals は exact / observed_alias recurrence を Candidate から取る", () => {
  const exact = serverSignalsFromCandidate(
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      occurrenceCount: 2,
      distinctSessionCount: 2,
      matchKindsSeen: ["exact", "new"],
      suspiciousFlags: ["generic_surface"],
    }),
  );
  assert.equal(exact.hasExactRecurrence, true);
  assert.equal(exact.hasObservedAliasRecurrence, false);
  assert.equal(exact.distinctSessionCount, 2);
  assert.deepEqual(exact.suspiciousFlags, ["generic_surface"]);

  const alias = serverSignalsFromCandidate(
    candidate({
      candidateRef: "C07",
      canonicalLabel: "alias-example",
      matchKindsSeen: ["observed_alias"],
    }),
  );
  assert.equal(alias.hasExactRecurrence, false);
  assert.equal(alias.hasObservedAliasRecurrence, true);
});

test("specific strong singleton は Recall / balanced Policy で ADMIT できる", () => {
  const item: ConceptAssessment = {
    candidateRef: "C37",
    conceptForm: "specific_named_concept",
    evidenceRole: "central",
    longitudinalPotential: "high",
  };
  const named = applyAdmissionPolicy(item, singletonSignals(), POLICY_NAMED_OR_HIGH);
  const balanced = applyAdmissionPolicy(
    item,
    singletonSignals(),
    POLICY_TOPIC_PLUS_SIGNAL,
  );
  const precision = applyAdmissionPolicy(item, singletonSignals(), POLICY_HIGH_ONLY);
  assert.equal(named.decision, "admit");
  assert.equal(named.reasonCode, "form_specific");
  assert.equal(balanced.decision, "admit");
  assert.equal(precision.decision, "admit");
});

test("stable recurring は ADMIT する", () => {
  const item: ConceptAssessment = {
    candidateRef: "C20",
    conceptForm: "stable_topic",
    evidenceRole: "central",
    longitudinalPotential: "high",
  };
  for (const spec of ADMISSION_POLICY_SPECS) {
    const result = applyAdmissionPolicy(item, recurringSignals(), spec);
    assert.equal(result.decision, "admit", spec.id);
  }
});

test("generic_head は distinctSessionCount>=2 でも REJECT する", () => {
  const item: ConceptAssessment = {
    candidateRef: "C41",
    conceptForm: "generic_head",
    evidenceRole: "central",
    longitudinalPotential: "high",
  };
  for (const spec of ADMISSION_POLICY_SPECS) {
    const result = applyAdmissionPolicy(item, recurringSignals(), spec);
    assert.equal(result.decision, "reject", spec.id);
    assert.equal(result.reasonCode, "hard_generic", spec.id);
  }
});

test("hard negative は frequency で救わず REJECT する", () => {
  const clause: ConceptAssessment = {
    candidateRef: "C22",
    conceptForm: "clause_or_statement",
    evidenceRole: "central",
    longitudinalPotential: "high",
  };
  const episodic: ConceptAssessment = {
    candidateRef: "C14",
    conceptForm: "episodic_object",
    evidenceRole: "central",
    longitudinalPotential: "high",
  };
  for (const spec of ADMISSION_POLICY_SPECS) {
    const clauseResult = applyAdmissionPolicy(clause, recurringSignals(), spec);
    assert.equal(clauseResult.decision, "reject", spec.id);
    assert.equal(clauseResult.reasonCode, "hard_clause", spec.id);
    const episodicResult = applyAdmissionPolicy(
      episodic,
      recurringSignals(),
      spec,
    );
    assert.equal(episodicResult.decision, "reject", spec.id);
    assert.equal(episodicResult.reasonCode, "hard_episodic", spec.id);
  }
});

test("specific incidental singleton は PolicySpec 差し替えで decision が分かれる", () => {
  const item: ConceptAssessment = {
    candidateRef: "C32",
    conceptForm: "specific_named_concept",
    evidenceRole: "incidental",
    longitudinalPotential: "medium",
  };
  const recall = applyAdmissionPolicy(item, singletonSignals(), POLICY_NAMED_OR_HIGH);
  const balanced = applyAdmissionPolicy(
    item,
    singletonSignals(),
    POLICY_TOPIC_PLUS_SIGNAL,
  );
  const precision = applyAdmissionPolicy(item, singletonSignals(), POLICY_HIGH_ONLY);
  assert.equal(recall.decision, "admit");
  assert.equal(balanced.decision, "defer");
  assert.equal(precision.decision, "defer");
  assert.equal(balanced.reasonCode, "insufficient_positive_signal");
  assert.equal(precision.reasonCode, "insufficient_positive_signal");
});

test("unclear form は DEFER し hard-negative の逃げにはならない", () => {
  const unclear: ConceptAssessment = {
    candidateRef: "C07",
    conceptForm: "unclear",
    evidenceRole: "unclear",
    longitudinalPotential: "medium",
  };
  const result = applyAdmissionPolicy(
    unclear,
    singletonSignals(),
    POLICY_TOPIC_PLUS_SIGNAL,
  );
  assert.equal(result.decision, "defer");
  assert.equal(result.reasonCode, "form_unclear");

  const pii: ConceptAssessment = {
    candidateRef: "C13",
    conceptForm: "pii",
    evidenceRole: "unclear",
    longitudinalPotential: "medium",
  };
  const piiResult = applyAdmissionPolicy(pii, recurringSignals(), POLICY_NAMED_OR_HIGH);
  assert.equal(piiResult.decision, "reject");
  assert.equal(piiResult.reasonCode, "hard_pii");
});

test("Policy は Candidate identity を変更しない", () => {
  const original = candidate({
    candidateRef: "C20",
    canonicalLabel: "人間関係",
    normalizedKey: "人間関係",
    occurrenceCount: 2,
    distinctSessionCount: 2,
    sessionIds: ["session-a", "session-b"],
    evidenceRefs: ["M011:E02", "M005:E02"],
    matchKindsSeen: ["exact", "new"],
    provisionalHints: [
      {
        otherCandidateRef: "C19",
        otherCanonicalLabel: "人間との関係性",
        surfaceForm: "人間関係",
        evidenceRef: "M005:E02",
      },
    ],
  });
  const snapshot = structuredClone(original);
  const judged = judgeCandidatesWithPolicy({
    candidates: [original],
    assessments: [
      assessment({
        candidateRef: "C20",
        conceptForm: "stable_topic",
        evidenceRole: "central",
        longitudinalPotential: "high",
      }),
    ],
    policySpec: POLICY_TOPIC_PLUS_SIGNAL,
  });
  assert.equal(judged.ok, true);
  if (!judged.ok) {
    return;
  }
  assert.deepEqual(original, snapshot);
  assert.equal(judged.invariants.canonicalChanged, 0);
  assert.equal(judged.invariants.mergedCandidates, 0);
  assert.equal(judged.invariants.occurrenceChanged, 0);
  assert.equal(judged.judged.length, 1);
  assert.equal(judged.judged[0]?.candidateRef, "C20");
  assert.equal(judged.judged[0]?.canonicalLabel, "人間関係");
  assert.equal(judged.judged[0]?.normalizedKey, "人間関係");
  assert.equal(judged.judged[0]?.occurrenceCount, 2);
  assert.equal(judged.judged[0]?.distinctSessionCount, 2);
  assert.deepEqual(judged.judged[0]?.sessionIds, ["session-a", "session-b"]);
  assert.deepEqual(judged.judged[0]?.evidenceRefs, ["M011:E02", "M005:E02"]);
  assert.equal(judged.judged[0]?.decision, "admit");
  assert.equal(judged.judged[0]?.provisionalHints[0]?.otherCandidateRef, "C19");
});

test("Calibration fixture は Policy 分岐に label を使わず評価だけする", () => {
  const parsed = parseAdmissionCalibrationFixture({
    version: ADMISSION_CALIBRATION_FIXTURE_VERSION,
    sourceReport: "data/concept-pilot-2b-v4.json",
    extractPromptVersion: "concept-extract-prompt-v4",
    extractionVersion: "concept-extraction-v1",
    labels: [
      { candidateRef: "C20", canonicalLabel: "人間関係", class: "A" },
      { candidateRef: "C37", canonicalLabel: "第2の脳", class: "A" },
      { candidateRef: "C16", canonicalLabel: "評価されることの怖さ", class: "B" },
      { candidateRef: "C41", canonicalLabel: "気持ち", class: "C" },
      { candidateRef: "C22", canonicalLabel: "clause", class: "D" },
    ],
    importantStableLabels: ["人間関係", "第2の脳", "高性能AI"],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }

  const judged = [
    { candidateRef: "C20", canonicalLabel: "人間関係", decision: "admit" as const },
    { candidateRef: "C37", canonicalLabel: "第2の脳", decision: "admit" as const },
    {
      candidateRef: "C16",
      canonicalLabel: "評価されることの怖さ",
      decision: "defer" as const,
    },
    { candidateRef: "C41", canonicalLabel: "気持ち", decision: "reject" as const },
    { candidateRef: "C22", canonicalLabel: "clause", decision: "reject" as const },
  ];
  const result = evaluatePolicyCalibration({
    judged,
    fixture: parsed.fixture,
  });
  assert.equal(result.classATotal, 2);
  assert.equal(result.classAAdmitted, 2);
  assert.equal(result.classAAdmitRate, 1);
  assert.equal(result.classBAdmitted, 0);
  assert.equal(result.classBDeferred, 1);
  assert.equal(result.classBRejected, 0);
  assert.equal(result.classCAdmitted, 0);
  assert.equal(result.classCRejected, 1);
  assert.equal(result.classDTotal, 1);
  assert.equal(result.classDRejected, 1);
  assert.equal(result.classDRejectRate, 1);
  assert.equal(result.admittedTotal, 2);
  assert.equal(result.admittedAB, 2);
  assert.equal(result.admittedABRate, 1);
  assert.equal(result.falseAdmissions, 0);
  assert.equal(result.falseRejections, 0);
  assert.equal(result.importantStableTotal, 2);
  assert.equal(result.importantStableAdmitted, 2);
  assert.equal(result.importantStableRecall, 1);
  assert.equal(result.importantDecisions[2]?.found, false);
  assert.equal(result.importantDecisions[2]?.label, "高性能AI");

  const goals = evaluateCalibrationGoals(result);
  assert.equal(goals.passed, true);
  assert.deepEqual(goals.failures, []);
  assert.equal(ADMISSION_CALIBRATION_GOALS.minClassAAdmitRate, 0.8);
});

test("Calibration は false admission / false rejection / 低い important recall を検出する", () => {
  const fixture = parseAdmissionCalibrationFixture({
    version: ADMISSION_CALIBRATION_FIXTURE_VERSION,
    sourceReport: "data/concept-pilot-2b-v4.json",
    extractPromptVersion: "concept-extract-prompt-v4",
    extractionVersion: "concept-extraction-v1",
    labels: [
      { candidateRef: "C20", class: "A" },
      { candidateRef: "C37", class: "A" },
      { candidateRef: "C41", class: "C" },
      { candidateRef: "C22", class: "D" },
    ],
    importantStableLabels: ["人間関係", "第2の脳"],
  });
  assert.equal(fixture.ok, true);
  if (!fixture.ok) {
    return;
  }
  const result = evaluatePolicyCalibration({
    judged: [
      { candidateRef: "C20", canonicalLabel: "人間関係", decision: "reject" },
      { candidateRef: "C37", canonicalLabel: "第2の脳", decision: "reject" },
      { candidateRef: "C41", canonicalLabel: "気持ち", decision: "admit" },
      { candidateRef: "C22", canonicalLabel: "clause", decision: "admit" },
    ],
    fixture: fixture.fixture,
  });
  assert.equal(result.classAAdmitRate, 0);
  assert.equal(result.falseRejections, 2);
  assert.equal(result.falseAdmissions, 2);
  assert.equal(result.admittedABRate, 0);
  assert.equal(result.importantStableRecall, 0);
  const goals = evaluateCalibrationGoals(result);
  assert.equal(goals.passed, false);
  assert.ok(goals.failures.includes("minClassAAdmitRate"));
  assert.ok(goals.failures.includes("minImportantStableRecall"));
  assert.ok(goals.failures.includes("maxFalseAdmissionRate"));
});

test("v1 evaluateAdmissionCalibration は残っている", () => {
  const result = evaluateAdmissionCalibration({
    judged: [
      {
        ...candidate({
          candidateRef: "C20",
          canonicalLabel: "人間関係",
        }),
        decision: "admit",
        reasonCode: "stable_topic",
      },
    ],
    labels: [{ candidateRef: "C20", class: "A" }],
    importantLabels: ["人間関係"],
  });
  assert.equal(result.classAAdmitRate, 1);
  assert.equal(result.importantDecisions[0]?.decision, "admit");
});

test("duplicate fixture ref は拒否する", () => {
  const parsed = parseAdmissionCalibrationFixture({
    version: ADMISSION_CALIBRATION_FIXTURE_VERSION,
    sourceReport: "data/concept-pilot-2b-v4.json",
    extractPromptVersion: "concept-extract-prompt-v4",
    extractionVersion: "concept-extraction-v1",
    labels: [
      { candidateRef: "C20", class: "A" },
      { candidateRef: "C20", class: "B" },
    ],
    importantStableLabels: [],
  });
  assert.equal(parsed.ok, false);
});
