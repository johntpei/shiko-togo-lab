import { validateAssessmentCoverage } from "./assessment-validation";
import {
  POLICY_ELIGIBLE_FORMS,
  POLICY_HARD_NEGATIVE_FORMS,
  type AdmissionServerSignals,
  type ConceptAssessment,
  type ConceptAssessmentInput,
  type PolicyEligibleForm,
  type PolicyHardNegativeForm,
  type PolicyPositiveSignal,
  type PolicyReasonCode,
} from "./assessment-types";
import {
  admissionIdentityInvariants,
  cloneAdmissionCandidate,
  type AdmissionIdentityInvariants,
} from "./report";
import type { AdmissionCandidate, AdmissionDecisionKind } from "./types";

export type AdmitRule = {
  id: string;
  reasonCode: PolicyReasonCode;
  forms: PolicyEligibleForm[];
  requireAllSignals?: PolicyPositiveSignal[];
  requireAnySignals?: PolicyPositiveSignal[];
};

export type AdmissionPolicySpec = {
  id: string;
  hardNegativeForms: readonly PolicyHardNegativeForm[];
  rejectGenericHead: boolean;
  deferUnclearForm: boolean;
  deferEligibleWithoutAdmit: boolean;
  admitRules: AdmitRule[];
  defaultDecision: Exclude<AdmissionDecisionKind, "admit">;
  defaultReasonCode: PolicyReasonCode;
};

export type AdmissionPolicyResult = {
  decision: AdmissionDecisionKind;
  policyRuleId: string;
  reasonCode: PolicyReasonCode;
};

export type PolicyJudgedCandidate = AdmissionCandidate & AdmissionPolicyResult;

const HARD_NEGATIVE_REASONS: Record<
  PolicyHardNegativeForm,
  PolicyReasonCode
> = {
  pii: "hard_pii",
  clause_or_statement: "hard_clause",
  episodic_object: "hard_episodic",
  temporary_state: "hard_temporary_state",
  task_or_action: "hard_task_or_action",
  relation_or_claim: "hard_relation_or_claim",
};

const ELIGIBLE_FORM_SET = new Set<string>(POLICY_ELIGIBLE_FORMS);

export function serverSignalsFromCandidate(
  candidate: Pick<
    AdmissionCandidate,
    | "occurrenceCount"
    | "distinctSessionCount"
    | "matchKindsSeen"
    | "suspiciousFlags"
  >,
): AdmissionServerSignals {
  return {
    occurrenceCount: candidate.occurrenceCount,
    distinctSessionCount: candidate.distinctSessionCount,
    hasExactRecurrence: candidate.matchKindsSeen.includes("exact"),
    hasObservedAliasRecurrence:
      candidate.matchKindsSeen.includes("observed_alias"),
    suspiciousFlags: [...candidate.suspiciousFlags],
  };
}

export function collectPolicySignals(
  assessment: ConceptAssessment,
  serverSignals: AdmissionServerSignals,
): Set<PolicyPositiveSignal> {
  const active = new Set<PolicyPositiveSignal>();
  if (assessment.conceptForm === "specific_named_concept") {
    active.add("specific_named_concept");
  }
  if (assessment.conceptForm === "stable_topic") {
    active.add("stable_topic");
  }
  if (assessment.longitudinalPotential === "high") {
    active.add("longitudinal_high");
  }
  if (assessment.evidenceRole === "central") {
    active.add("evidence_central");
  }
  if (serverSignals.distinctSessionCount >= 2) {
    active.add("multi_session");
  }
  if (serverSignals.hasExactRecurrence) {
    active.add("exact_recurrence");
  }
  if (serverSignals.hasObservedAliasRecurrence) {
    active.add("observed_alias_recurrence");
  }
  return active;
}

function isHardNegativeForm(
  value: string,
): value is PolicyHardNegativeForm {
  return (POLICY_HARD_NEGATIVE_FORMS as readonly string[]).includes(value);
}

function isEligibleForm(value: string): value is PolicyEligibleForm {
  return ELIGIBLE_FORM_SET.has(value);
}

function admitRuleMatches(
  assessment: ConceptAssessment,
  active: Set<PolicyPositiveSignal>,
  rule: AdmitRule,
) {
  if (!rule.forms.includes(assessment.conceptForm as PolicyEligibleForm)) {
    return false;
  }
  const requiredAll = rule.requireAllSignals ?? [];
  if (requiredAll.some((signal) => !active.has(signal))) {
    return false;
  }
  const requiredAny = rule.requireAnySignals ?? [];
  if (
    requiredAny.length > 0 &&
    requiredAny.every((signal) => !active.has(signal))
  ) {
    return false;
  }
  return true;
}

export function applyAdmissionPolicy(
  assessment: ConceptAssessment,
  serverSignals: AdmissionServerSignals,
  policySpec: AdmissionPolicySpec,
): AdmissionPolicyResult {
  if (isHardNegativeForm(assessment.conceptForm)) {
    if (policySpec.hardNegativeForms.includes(assessment.conceptForm)) {
      return {
        decision: "reject",
        policyRuleId: `hard_negative:${assessment.conceptForm}`,
        reasonCode: HARD_NEGATIVE_REASONS[assessment.conceptForm],
      };
    }
  }

  if (
    policySpec.rejectGenericHead &&
    assessment.conceptForm === "generic_head"
  ) {
    return {
      decision: "reject",
      policyRuleId: "hard_generic",
      reasonCode: "hard_generic",
    };
  }

  if (policySpec.deferUnclearForm && assessment.conceptForm === "unclear") {
    return {
      decision: "defer",
      policyRuleId: "form_unclear",
      reasonCode: "form_unclear",
    };
  }

  const active = collectPolicySignals(assessment, serverSignals);
  for (const rule of policySpec.admitRules) {
    if (admitRuleMatches(assessment, active, rule)) {
      return {
        decision: "admit",
        policyRuleId: rule.id,
        reasonCode: rule.reasonCode,
      };
    }
  }

  if (
    policySpec.deferEligibleWithoutAdmit &&
    isEligibleForm(assessment.conceptForm)
  ) {
    return {
      decision: "defer",
      policyRuleId: "eligible_without_signal",
      reasonCode: "insufficient_positive_signal",
    };
  }

  return {
    decision: policySpec.defaultDecision,
    policyRuleId: "default",
    reasonCode: policySpec.defaultReasonCode,
  };
}

const SHARED_HARD_NEGATIVES = [...POLICY_HARD_NEGATIVE_FORMS];

function basePolicy(
  id: string,
  admitRules: AdmitRule[],
): AdmissionPolicySpec {
  return {
    id,
    hardNegativeForms: SHARED_HARD_NEGATIVES,
    rejectGenericHead: true,
    deferUnclearForm: true,
    deferEligibleWithoutAdmit: true,
    admitRules,
    defaultDecision: "reject",
    defaultReasonCode: "insufficient_positive_signal",
  };
}

export const POLICY_NAMED_OR_HIGH: AdmissionPolicySpec = basePolicy(
  "named_or_high",
  [
    {
      id: "form_specific",
      reasonCode: "form_specific",
      forms: ["specific_named_concept"],
    },
    {
      id: "form_stable_high",
      reasonCode: "form_stable_high",
      forms: ["stable_topic"],
      requireAllSignals: ["longitudinal_high"],
    },
  ],
);

export const POLICY_TOPIC_PLUS_SIGNAL: AdmissionPolicySpec = basePolicy(
  "topic_plus_signal",
  [
    {
      id: "form_eligible_with_signal",
      reasonCode: "form_eligible_with_signal",
      forms: ["specific_named_concept", "stable_topic"],
      requireAnySignals: [
        "longitudinal_high",
        "evidence_central",
        "multi_session",
        "exact_recurrence",
      ],
    },
  ],
);

export const POLICY_HIGH_ONLY: AdmissionPolicySpec = basePolicy("high_only", [
  {
    id: "form_eligible_high",
    reasonCode: "form_eligible_high",
    forms: ["specific_named_concept", "stable_topic"],
    requireAllSignals: ["longitudinal_high"],
  },
]);

export const ADMISSION_POLICY_SPECS = [
  POLICY_NAMED_OR_HIGH,
  POLICY_TOPIC_PLUS_SIGNAL,
  POLICY_HIGH_ONLY,
] as const;

export type JudgeCandidatesWithPolicyResult =
  | {
      ok: true;
      judged: PolicyJudgedCandidate[];
      invariants: AdmissionIdentityInvariants;
    }
  | {
      ok: false;
      reason: string;
      detail: string;
    };

export function judgeCandidatesWithPolicy(input: {
  candidates: AdmissionCandidate[];
  assessments: ConceptAssessmentInput[];
  policySpec: AdmissionPolicySpec;
}): JudgeCandidatesWithPolicyResult {
  const coverage = validateAssessmentCoverage({
    candidates: input.candidates,
    assessments: input.assessments,
  });
  if (!coverage.ok) {
    return {
      ok: false,
      reason: coverage.reason,
      detail: coverage.detail,
    };
  }

  const byRef = new Map(
    coverage.assessments.map((item) => [item.candidateRef, item] as const),
  );
  const judged: PolicyJudgedCandidate[] = input.candidates.map((candidate) => {
    const assessment = byRef.get(candidate.candidateRef)!;
    const result = applyAdmissionPolicy(
      assessment,
      serverSignalsFromCandidate(candidate),
      input.policySpec,
    );
    return {
      ...cloneAdmissionCandidate(candidate),
      ...result,
    };
  });

  return {
    ok: true,
    judged,
    invariants: admissionIdentityInvariants(input.candidates, judged),
  };
}
