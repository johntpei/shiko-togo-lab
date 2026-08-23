import { CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-admission-assessment";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import { hashJsonContent } from "@/lib/concepts/admission/canonical-json";
import {
  CONCEPT_ADMISSION_ASSESSMENT_VERSION,
  CONCEPT_ADMISSION_POLICY_VERSION,
  type ConceptAssessment,
  type ConceptForm,
  type EvidenceRole,
  type LongitudinalPotential,
  type PolicyReasonCode,
} from "@/lib/concepts/admission/assessment-types";
import { POLICY_NAMED_OR_HIGH } from "@/lib/concepts/admission/policy";
import type { AdmissionDecisionKind } from "@/lib/concepts/admission/types";
import { normalizeConceptKey } from "@/lib/concepts/normalize";
import {
  CONCEPT_EXTRACTION_VERSION,
  CONCEPT_MATCHING_VERSION,
  CONCEPT_SOURCE_ROLES,
  CONCEPT_SOURCE_TYPES,
} from "@/lib/concepts/types";
import type { NewAssessmentIntent } from "./new-assessment-intent";
import type { IncrementalCandidateProvenance, NewCandidatePlan } from "./plan";

export const CONCEPT_INCREMENTAL_NEW_ADMISSION_MANIFEST_VERSION =
  "concept-incremental-new-admission-manifest-v1";
export const CONCEPT_INCREMENTAL_NEW_ADMISSION_MODE = "incremental_new";
export const CONCEPT_INCREMENTAL_NEW_ADMISSION_POLICY_ID =
  POLICY_NAMED_OR_HIGH.id;

export type IncrementalNewManifestAssessment = {
  conceptForm: ConceptForm;
  evidenceRole: EvidenceRole;
  longitudinalPotential: LongitudinalPotential;
};

export type IncrementalNewManifestPolicy = {
  policyVersion: typeof CONCEPT_ADMISSION_POLICY_VERSION;
  policyRuleId: string;
  reasonCode: PolicyReasonCode;
};

export type IncrementalNewManifestAdmittedCandidate = {
  candidateRef: string;
  canonicalLabel: string;
  normalizedKey: string;
  provenance: IncrementalCandidateProvenance;
  assessment: IncrementalNewManifestAssessment;
  policy: IncrementalNewManifestPolicy;
};

export type IncrementalNewManifestNotAdmitted = {
  candidateRef: string;
  decision: Exclude<AdmissionDecisionKind, "admit">;
  policyRuleId: string;
  reasonCode: PolicyReasonCode;
};

export type IncrementalNewAdmissionManifestSource = {
  intentContentHash: string;
  extractPromptVersion: string;
  extractionVersion: string;
  coverageSourceHash: string;
  assessmentModel: string;
  assessmentPromptVersion: string;
  assessmentVersion: string;
};

export type IncrementalNewAdmissionManifestMetadata = {
  version: typeof CONCEPT_INCREMENTAL_NEW_ADMISSION_MANIFEST_VERSION;
  mode: typeof CONCEPT_INCREMENTAL_NEW_ADMISSION_MODE;
  sessionId: string;
  matchingVersion: string;
  admissionPolicyId: string;
  admissionPolicyVersion: typeof CONCEPT_ADMISSION_POLICY_VERSION;
  source: IncrementalNewAdmissionManifestSource;
  generatedAt: string;
  contentHash: string;
};

export type IncrementalNewAdmissionManifest = {
  metadata: IncrementalNewAdmissionManifestMetadata;
  admittedCandidates: IncrementalNewManifestAdmittedCandidate[];
  notAdmitted: IncrementalNewManifestNotAdmitted[];
  aliasesToCreate: 0;
};

export type IncrementalNewJudgedCandidate = {
  plan: NewCandidatePlan;
  assessment: ConceptAssessment;
  decision: AdmissionDecisionKind;
  policyRuleId: string;
  reasonCode: PolicyReasonCode;
};

export type IncrementalNewManifestIssue = {
  code: string;
  detail: string;
};

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function incrementalNewManifestContentHashPayload(
  manifest: Omit<IncrementalNewAdmissionManifest, "metadata"> & {
    metadata: Omit<IncrementalNewAdmissionManifestMetadata, "contentHash">;
  },
) {
  return {
    metadata: {
      version: manifest.metadata.version,
      mode: manifest.metadata.mode,
      sessionId: manifest.metadata.sessionId,
      matchingVersion: manifest.metadata.matchingVersion,
      admissionPolicyId: manifest.metadata.admissionPolicyId,
      admissionPolicyVersion: manifest.metadata.admissionPolicyVersion,
      source: manifest.metadata.source,
    },
    admittedCandidates: manifest.admittedCandidates,
    notAdmitted: manifest.notAdmitted,
    aliasesToCreate: 0,
  };
}

export function hashIncrementalNewAdmissionManifest(
  manifest: IncrementalNewAdmissionManifest,
) {
  return hashJsonContent(
    incrementalNewManifestContentHashPayload({
      ...manifest,
      metadata: {
        version: manifest.metadata.version,
        mode: manifest.metadata.mode,
        sessionId: manifest.metadata.sessionId,
        matchingVersion: manifest.metadata.matchingVersion,
        admissionPolicyId: manifest.metadata.admissionPolicyId,
        admissionPolicyVersion: manifest.metadata.admissionPolicyVersion,
        source: manifest.metadata.source,
        generatedAt: manifest.metadata.generatedAt,
      },
    }),
  );
}

export function buildIncrementalNewAdmissionManifest(input: {
  intent: NewAssessmentIntent;
  judged: IncrementalNewJudgedCandidate[];
  assessmentModel: string;
  now?: () => string;
}):
  | { ok: true; manifest: IncrementalNewAdmissionManifest }
  | { ok: false; code: string; detail: string } {
  const sessionId = input.intent.metadata.sessionId;
  const byRef = new Map(input.judged.map((item) => [item.plan.candidateRef, item]));
  if (byRef.size !== input.judged.length) {
    return { ok: false, code: "duplicate_candidate_ref", detail: "judged" };
  }
  for (const plan of input.intent.candidates) {
    if (!byRef.has(plan.candidateRef)) {
      return {
        ok: false,
        code: "missing_judgment",
        detail: plan.candidateRef,
      };
    }
  }
  if (input.judged.length !== input.intent.candidates.length) {
    return { ok: false, code: "judgment_coverage", detail: "count" };
  }

  const admitted: IncrementalNewManifestAdmittedCandidate[] = [];
  const notAdmitted: IncrementalNewManifestNotAdmitted[] = [];

  for (const judged of input.judged) {
    if (judged.plan.kind !== "new") {
      return { ok: false, code: "provisional_not_allowed", detail: judged.plan.kind };
    }
    if (judged.assessment.candidateRef !== judged.plan.candidateRef) {
      return {
        ok: false,
        code: "assessment_ref_mismatch",
        detail: judged.plan.candidateRef,
      };
    }
    if (normalizeConceptKey(judged.plan.canonicalLabel) !== judged.plan.normalizedKey) {
      return {
        ok: false,
        code: "normalized_key_renormalize",
        detail: judged.plan.candidateRef,
      };
    }
    if (judged.decision === "admit") {
      admitted.push({
        candidateRef: judged.plan.candidateRef,
        canonicalLabel: judged.plan.canonicalLabel,
        normalizedKey: judged.plan.normalizedKey,
        provenance: { ...judged.plan.provenance },
        assessment: {
          conceptForm: judged.assessment.conceptForm,
          evidenceRole: judged.assessment.evidenceRole,
          longitudinalPotential: judged.assessment.longitudinalPotential,
        },
        policy: {
          policyVersion: CONCEPT_ADMISSION_POLICY_VERSION,
          policyRuleId: judged.policyRuleId,
          reasonCode: judged.reasonCode,
        },
      });
    } else {
      notAdmitted.push({
        candidateRef: judged.plan.candidateRef,
        decision: judged.decision,
        policyRuleId: judged.policyRuleId,
        reasonCode: judged.reasonCode,
      });
    }
  }

  const generatedAt = (input.now ?? (() => new Date().toISOString()))();
  const metadataWithoutHash = {
    version: CONCEPT_INCREMENTAL_NEW_ADMISSION_MANIFEST_VERSION,
    mode: CONCEPT_INCREMENTAL_NEW_ADMISSION_MODE,
    sessionId,
    matchingVersion: CONCEPT_MATCHING_VERSION,
    admissionPolicyId: CONCEPT_INCREMENTAL_NEW_ADMISSION_POLICY_ID,
    admissionPolicyVersion: CONCEPT_ADMISSION_POLICY_VERSION,
    source: {
      intentContentHash: input.intent.metadata.contentHash,
      extractPromptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
      coverageSourceHash: input.intent.metadata.source.coverageSourceHash,
      assessmentModel: input.assessmentModel,
      assessmentPromptVersion: CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION,
      assessmentVersion: CONCEPT_ADMISSION_ASSESSMENT_VERSION,
    },
    generatedAt,
  } as const;
  const contentHash = hashJsonContent(
    incrementalNewManifestContentHashPayload({
      metadata: metadataWithoutHash,
      admittedCandidates: admitted,
      notAdmitted,
      aliasesToCreate: 0,
    }),
  );

  return {
    ok: true,
    manifest: {
      metadata: { ...metadataWithoutHash, contentHash },
      admittedCandidates: admitted,
      notAdmitted,
      aliasesToCreate: 0,
    },
  };
}

export function validateIncrementalNewAdmissionManifest(
  manifest: IncrementalNewAdmissionManifest,
): IncrementalNewManifestIssue[] {
  const errors: IncrementalNewManifestIssue[] = [];
  if (manifest.metadata.version !== CONCEPT_INCREMENTAL_NEW_ADMISSION_MANIFEST_VERSION) {
    errors.push({
      code: "manifest_version",
      detail: manifest.metadata.version,
    });
  }
  if (manifest.metadata.mode !== CONCEPT_INCREMENTAL_NEW_ADMISSION_MODE) {
    errors.push({ code: "unsupported_mode", detail: manifest.metadata.mode });
  }
  if (manifest.aliasesToCreate !== 0) {
    errors.push({
      code: "aliases_to_create",
      detail: String(manifest.aliasesToCreate),
    });
  }
  if (manifest.metadata.admissionPolicyId !== CONCEPT_INCREMENTAL_NEW_ADMISSION_POLICY_ID) {
    errors.push({
      code: "policy_id",
      detail: manifest.metadata.admissionPolicyId,
    });
  }
  if (
    manifest.metadata.admissionPolicyVersion !== CONCEPT_ADMISSION_POLICY_VERSION
  ) {
    errors.push({
      code: "policy_version",
      detail: manifest.metadata.admissionPolicyVersion,
    });
  }
  if (!nonempty(manifest.metadata.sessionId)) {
    errors.push({ code: "sessionId", detail: "empty" });
  }
  if (
    hashIncrementalNewAdmissionManifest(manifest) !==
    manifest.metadata.contentHash
  ) {
    errors.push({
      code: "content_hash",
      detail: manifest.metadata.contentHash,
    });
  }

  const seen = new Set<string>();
  for (const candidate of manifest.admittedCandidates) {
    if (seen.has(candidate.candidateRef)) {
      errors.push({
        code: "duplicate_candidate_ref",
        detail: candidate.candidateRef,
      });
    }
    seen.add(candidate.candidateRef);
    if (candidate.provenance.sessionId !== manifest.metadata.sessionId) {
      errors.push({
        code: "session_invariant",
        detail: candidate.candidateRef,
      });
    }
    if (candidate.provenance.sourceRole !== "user") {
      errors.push({
        code: "sourceRole",
        detail: candidate.candidateRef,
      });
    }
    if (
      !(CONCEPT_SOURCE_ROLES as readonly string[]).includes(
        candidate.provenance.sourceRole,
      )
    ) {
      errors.push({ code: "sourceRole", detail: candidate.candidateRef });
    }
    if (candidate.provenance.sourceType !== "evidence_unit") {
      errors.push({
        code: "sourceType",
        detail: candidate.candidateRef,
      });
    }
    if (
      !(CONCEPT_SOURCE_TYPES as readonly string[]).includes(
        candidate.provenance.sourceType,
      )
    ) {
      errors.push({ code: "sourceType", detail: candidate.candidateRef });
    }
    if (candidate.provenance.extractionVersion !== CONCEPT_EXTRACTION_VERSION) {
      errors.push({
        code: "extractionVersion",
        detail: candidate.candidateRef,
      });
    }
    if (
      normalizeConceptKey(candidate.canonicalLabel) !== candidate.normalizedKey
    ) {
      errors.push({
        code: "normalized_key_renormalize",
        detail: candidate.candidateRef,
      });
    }
    if (candidate.policy.policyVersion !== CONCEPT_ADMISSION_POLICY_VERSION) {
      errors.push({
        code: "policy_version",
        detail: candidate.candidateRef,
      });
    }
  }
  return errors;
}
