import { unitTextKey } from "@/lib/concepts/admission/candidates";
import {
  CONCEPT_ADMISSION_ASSESSMENT_VERSION,
  type ConceptAssessment,
} from "@/lib/concepts/admission/assessment-types";
import {
  ADMISSION_SHORT_TEXT_MAX_CHARS,
  type AdmissionCandidate,
} from "@/lib/concepts/admission/types";
import {
  POLICY_NAMED_OR_HIGH,
  applyAdmissionPolicy,
  serverSignalsFromCandidate,
} from "@/lib/concepts/admission/policy";
import { validateAssessmentCoverage } from "@/lib/concepts/admission/assessment-validation";
import { CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-admission-assessment";
import { runConceptAssessment } from "@/lib/ai/tasks/concept-admission-assessment";
import type { AiProvider } from "@/lib/ai/provider";
import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import {
  intentToNewCandidatePlans,
  loadNewAssessmentIntent,
  type NewAssessmentIntent,
} from "./new-assessment-intent";
import {
  buildIncrementalNewAdmissionManifest,
  type IncrementalNewAdmissionManifest,
  type IncrementalNewJudgedCandidate,
} from "./new-admission-manifest";
import {
  loadIncrementalNewSessionEvidence,
  validateIncrementalNewCandidateAgainstDb,
} from "./new-admission-validate";
import type { NewCandidatePlan } from "./plan";

function shortText(text: string) {
  return text.slice(0, ADMISSION_SHORT_TEXT_MAX_CHARS);
}

function admissionCandidateFromNewPlan(
  plan: NewCandidatePlan,
  unitText: string,
): AdmissionCandidate {
  return {
    candidateRef: plan.candidateRef,
    canonicalLabel: plan.canonicalLabel,
    normalizedKey: plan.normalizedKey,
    occurrenceCount: 1,
    distinctSessionCount: 1,
    firstSeenAt: plan.provenance.occurredAt,
    lastSeenAt: plan.provenance.occurredAt,
    sessionIds: [plan.provenance.sessionId],
    evidenceRefs: [plan.provenance.evidenceRef],
    suspiciousFlags: [],
    matchKindsSeen: [],
    representativeEvidence: [
      {
        sessionId: plan.provenance.sessionId,
        evidenceRef: plan.provenance.evidenceRef,
        occurredAt: plan.provenance.occurredAt,
        shortText: shortText(unitText),
      },
    ],
    provisionalHints: [],
  };
}

export type IncrementalNewAssessmentPipelineResult =
  | {
      ok: true;
      intent: NewAssessmentIntent;
      plans: NewCandidatePlan[];
      assessments: ConceptAssessment[];
      judged: IncrementalNewJudgedCandidate[];
      manifest: IncrementalNewAdmissionManifest;
      assessmentModel: string;
      promptVersion: typeof CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION;
      assessmentVersion: typeof CONCEPT_ADMISSION_ASSESSMENT_VERSION;
    }
  | {
      ok: false;
      stage: "intent" | "evidence" | "assessment";
      code: string;
      detail: string;
    };

/**
 * Frozen NEW Intent → fresh Evidence resolve → Grounding 再確認 →
 * Semantic Assessment v2 → named_or_high → Incremental NEW Manifest.
 * Apply / real LLM provider は caller が制御する。
 */
export async function assessIncrementalNewFromIntent(input: {
  intentText: string;
  db: ConceptQueryDb;
  generateStructured: AiProvider["generateStructured"];
  now?: () => string;
}): Promise<IncrementalNewAssessmentPipelineResult> {
  const loaded = loadNewAssessmentIntent(input.intentText);
  if (!loaded.ok) {
    return {
      ok: false,
      stage: "intent",
      code: loaded.code,
      detail: loaded.detail,
    };
  }
  const plans = intentToNewCandidatePlans(loaded.intent);
  if (plans.some((plan) => plan.kind !== "new")) {
    return {
      ok: false,
      stage: "intent",
      code: "provisional_not_allowed",
      detail: "kind",
    };
  }

  const sessionId = loaded.intent.metadata.sessionId;
  const evidence = loadIncrementalNewSessionEvidence(input.db, sessionId);
  if (!evidence.ok) {
    return {
      ok: false,
      stage: "evidence",
      code: evidence.code,
      detail: evidence.detail,
    };
  }

  const unitTexts: Record<string, string> = {};
  const candidates: AdmissionCandidate[] = [];
  for (const plan of plans) {
    const validated = validateIncrementalNewCandidateAgainstDb(
      plan,
      sessionId,
      input.db,
      evidence.evidence,
    );
    if (!validated.ok) {
      return {
        ok: false,
        stage: "evidence",
        code: validated.code,
        detail: validated.detail,
      };
    }
    const key = unitTextKey(plan.provenance.sessionId, plan.provenance.evidenceRef);
    unitTexts[key] = validated.unit.text;
    candidates.push(admissionCandidateFromNewPlan(plan, validated.unit.text));
  }

  const assessed = await runConceptAssessment(
    { candidates, unitTexts },
    { generateStructured: input.generateStructured },
  );
  if (!assessed.ok) {
    return {
      ok: false,
      stage: "assessment",
      code: assessed.code,
      detail: assessed.error,
    };
  }

  const coverage = validateAssessmentCoverage({
    candidates,
    assessments: assessed.assessments,
  });
  if (!coverage.ok) {
    return {
      ok: false,
      stage: "assessment",
      code: coverage.reason,
      detail: coverage.detail,
    };
  }

  const assessmentByRef = new Map(
    coverage.assessments.map((item) => [item.candidateRef, item] as const),
  );
  const judged: IncrementalNewJudgedCandidate[] = [];
  for (const plan of plans) {
    const assessment = assessmentByRef.get(plan.candidateRef);
    if (!assessment) {
      return {
        ok: false,
        stage: "assessment",
        code: "missing_candidate_ref",
        detail: plan.candidateRef,
      };
    }
    const candidate = candidates.find(
      (item) => item.candidateRef === plan.candidateRef,
    )!;
    const policy = applyAdmissionPolicy(
      assessment,
      serverSignalsFromCandidate(candidate),
      POLICY_NAMED_OR_HIGH,
    );
    judged.push({
      plan,
      assessment,
      decision: policy.decision,
      policyRuleId: policy.policyRuleId,
      reasonCode: policy.reasonCode,
    });
  }

  const built = buildIncrementalNewAdmissionManifest({
    intent: loaded.intent,
    judged,
    assessmentModel: assessed.model,
    now: input.now,
  });
  if (!built.ok) {
    return {
      ok: false,
      stage: "assessment",
      code: built.code,
      detail: built.detail,
    };
  }

  return {
    ok: true,
    intent: loaded.intent,
    plans,
    assessments: coverage.assessments,
    judged,
    manifest: built.manifest,
    assessmentModel: assessed.model,
    promptVersion: CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION,
    assessmentVersion: CONCEPT_ADMISSION_ASSESSMENT_VERSION,
  };
}
