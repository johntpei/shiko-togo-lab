import { CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-admission-assessment";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import { normalizeConceptKey } from "@/lib/concepts/normalize";
import {
  CONCEPT_EXTRACTION_VERSION,
  CONCEPT_MATCHING_VERSION,
  CONCEPT_SOURCE_ROLES,
  CONCEPT_SOURCE_TYPES,
} from "@/lib/concepts/types";
import {
  CONCEPT_ADMISSION_ASSESSMENT_VERSION,
  CONCEPT_ADMISSION_POLICY_VERSION,
  type AdmissionServerSignals,
  type ConceptAssessment,
  type ConceptForm,
  type EvidenceRole,
  type LongitudinalPotential,
  type PolicyReasonCode,
} from "./assessment-types";
import { validateAssessmentCoverage } from "./assessment-validation";
import {
  buildAdmissionCandidates,
  collectAdmissionOccurrences,
  intraCandidateDuplicateOccurrenceKeys,
  unitTextKey,
  type CandidateOccurrence,
} from "./candidates";
import { hashArtifactText, hashJsonContent } from "./canonical-json";
import {
  reconstructAdmissionProvenance,
  sessionIdsFromAdmissionSnapshot,
  type AdmissionEvidenceSession,
  type AdmissionProvenanceUnit,
} from "./evidence";
import { snapshotFromConceptPilotReport } from "./loader";
import {
  POLICY_NAMED_OR_HIGH,
  applyAdmissionPolicy,
  judgeCandidatesWithPolicy,
  serverSignalsFromCandidate,
} from "./policy";
import { admissionIdentityInvariants } from "./report";
import type { AdmissionCandidate } from "./types";

export const CONCEPT_ADMISSION_APPLY_MANIFEST_VERSION =
  "concept-admission-apply-manifest-v1";
export const CONCEPT_ADMISSION_APPLY_MODE = "initial";
export const CONCEPT_ADMISSION_APPLY_EXPECTED_ASSESSMENT_MODEL =
  "gpt-4o-2024-08-06";
export const CONCEPT_ADMISSION_APPLY_POLICY_ID = POLICY_NAMED_OR_HIGH.id;

export const CONCEPT_APPLY_DEFAULT_CANDIDATES =
  "data/concept-pilot-2b-v4.json";
export const CONCEPT_APPLY_DEFAULT_ASSESSMENT =
  "data/concept-admission-assessment-v2-gpt4o.json";
export const CONCEPT_APPLY_DEFAULT_MANIFEST =
  "data/concept-admission-apply-manifest-v1.json";
export const CONCEPT_APPLY_APPLY_ERROR =
  "preflight is read-only; --apply is not accepted";
export const CONCEPT_APPLY_DRY_RUN_REFUSES_APPLY =
  "dry-run does not write the Concept Registry";
export const CONCEPT_APPLY_DEFAULT_PREFLIGHT =
  "data/concept-admission-preflight-v1.json";
export const CONCEPT_APPLY_DEFAULT_RESULT =
  "data/concept-admission-apply-result-v1.json";

const CALIBRATION_LEAK_KEYS = [
  "importantStableLabels",
  "importantStable",
  "classAAdmitRate",
  "ADMISSION_CALIBRATION_GOALS",
  "evaluatePolicyCalibration",
  "AdmissionCalibrationFixture",
  "calibrationClass",
  "calibrationClasses",
] as const;

export type ApplyManifestOccurrence = {
  sessionId: string;
  messageId: string;
  evidenceRef: string;
  occurredAt: string;
  sourceRole: (typeof CONCEPT_SOURCE_ROLES)[number];
  sourceType: (typeof CONCEPT_SOURCE_TYPES)[number];
  extractionVersion: typeof CONCEPT_EXTRACTION_VERSION;
};

export type ApplyManifestAssessment = {
  conceptForm: ConceptForm;
  evidenceRole: EvidenceRole;
  longitudinalPotential: LongitudinalPotential;
};

export type ApplyManifestAdmittedCandidate = {
  candidateRef: string;
  canonicalLabel: string;
  normalizedKey: string;
  occurrenceCount: number;
  distinctSessionCount: number;
  sessionIds: string[];
  evidenceRefs: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: ApplyManifestOccurrence[];
  assessment: ApplyManifestAssessment;
  serverSignals: AdmissionServerSignals;
  policyRuleId: string;
  policyReasonCode: PolicyReasonCode;
};

export type ApplyManifestMetadata = {
  manifestVersion: typeof CONCEPT_ADMISSION_APPLY_MANIFEST_VERSION;
  mode: typeof CONCEPT_ADMISSION_APPLY_MODE;
  sourceCandidateReport: string;
  assessmentReport: string;
  sourceCandidateReportHash: string;
  assessmentReportHash: string;
  extractPromptVersion: string;
  extractionVersion: string;
  matchingVersion: string;
  assessmentPromptVersion: string;
  assessmentVersion: string;
  assessmentModel: string;
  admissionPolicyId: string;
  admissionPolicyVersion: string;
  generatedAt: string;
  contentHash: string;
};

export type ConceptAdmissionApplyManifest = {
  metadata: ApplyManifestMetadata;
  admittedCandidates: ApplyManifestAdmittedCandidate[];
  aliasesToCreate: 0;
};

export type ApplyManifestIssue = {
  code: string;
  detail: string;
};

export type ApplyManifestValidation = {
  valid: boolean;
  errors: ApplyManifestIssue[];
  warnings: ApplyManifestIssue[];
};

export type ApplyManifestRegistryCounts = {
  concepts: number;
  conceptAliases: number;
  conceptOccurrences: number;
};

export type AssessmentApplyArtifact = {
  metadata: {
    assessmentPromptVersion: string;
    assessmentVersion: string;
    model: string | null;
  };
  assessments: Array<{
    candidateRef: string;
    conceptForm: string;
    evidenceRole: string;
    longitudinalPotential: string;
    serverSignals?: AdmissionServerSignals;
  }>;
};

export type BuildApplyManifestInput = {
  sourceCandidateReportPath: string;
  assessmentReportPath: string;
  candidateReportText: string;
  assessmentReportText: string;
  candidateReportRaw: unknown;
  assessmentReportRaw: unknown;
  sessions: AdmissionEvidenceSession[];
  now?: () => string;
};

function issue(code: string, detail: string): ApplyManifestIssue {
  return { code, detail };
}

function sameStringArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameSignals(
  left: AdmissionServerSignals,
  right: AdmissionServerSignals,
) {
  return (
    left.occurrenceCount === right.occurrenceCount &&
    left.distinctSessionCount === right.distinctSessionCount &&
    left.hasExactRecurrence === right.hasExactRecurrence &&
    left.hasObservedAliasRecurrence === right.hasObservedAliasRecurrence &&
    sameStringArray(left.suspiciousFlags, right.suspiciousFlags)
  );
}

function findCalibrationLeaks(value: unknown, path = "$"): string[] {
  const leaks: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      leaks.push(...findCalibrationLeaks(item, `${path}[${index}]`));
    });
    return leaks;
  }
  if (!value || typeof value !== "object") {
    return leaks;
  }
  for (const [key, child] of Object.entries(value)) {
    if ((CALIBRATION_LEAK_KEYS as readonly string[]).includes(key)) {
      leaks.push(`${path}.${key}`);
    }
    leaks.push(...findCalibrationLeaks(child, `${path}.${key}`));
  }
  return leaks;
}

function sourceConceptAliases(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const concepts = (raw as { concepts?: unknown }).concepts;
  if (!Array.isArray(concepts)) {
    return [];
  }
  const nonempty: string[] = [];
  for (const row of concepts) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const aliases = (row as { ref?: unknown; aliases?: unknown }).aliases;
    if (Array.isArray(aliases) && aliases.length > 0) {
      nonempty.push(String((row as { ref?: unknown }).ref ?? "?"));
    }
  }
  return nonempty;
}

export function hashSourceArtifactText(text: string) {
  try {
    return hashJsonContent(JSON.parse(text));
  } catch {
    return hashArtifactText(text);
  }
}

export function applyManifestContentHashPayload(
  manifest: ConceptAdmissionApplyManifest,
) {
  const metadata = Object.fromEntries(
    Object.entries(manifest.metadata).filter(
      ([key]) => key !== "generatedAt" && key !== "contentHash",
    ),
  );
  return {
    metadata,
    admittedCandidates: manifest.admittedCandidates,
    aliasesToCreate: manifest.aliasesToCreate,
  };
}

export function hashApplyManifestContent(
  manifest: ConceptAdmissionApplyManifest,
) {
  return hashJsonContent(applyManifestContentHashPayload(manifest));
}

function parseAssessmentArtifact(
  raw: unknown,
):
  | { ok: true; artifact: AssessmentApplyArtifact }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Assessment report が object ではありません" };
  }
  const value = raw as Record<string, unknown>;
  const metadata = value.metadata;
  if (!metadata || typeof metadata !== "object") {
    return { ok: false, error: "Assessment metadata がありません" };
  }
  const meta = metadata as Record<string, unknown>;
  if (typeof meta.assessmentPromptVersion !== "string") {
    return { ok: false, error: "assessmentPromptVersion が不正です" };
  }
  if (typeof meta.assessmentVersion !== "string") {
    return { ok: false, error: "assessmentVersion が不正です" };
  }
  if (meta.model !== null && typeof meta.model !== "string") {
    return { ok: false, error: "assessment model が不正です" };
  }
  if (!Array.isArray(value.assessments)) {
    return { ok: false, error: "assessments がありません" };
  }
  const assessments: AssessmentApplyArtifact["assessments"] = [];
  for (const row of value.assessments) {
    if (!row || typeof row !== "object") {
      return { ok: false, error: "assessment row が不正です" };
    }
    const item = row as Record<string, unknown>;
    if (
      typeof item.candidateRef !== "string" ||
      typeof item.conceptForm !== "string" ||
      typeof item.evidenceRole !== "string" ||
      typeof item.longitudinalPotential !== "string"
    ) {
      return { ok: false, error: "assessment 属性が不正です" };
    }
    assessments.push({
      candidateRef: item.candidateRef,
      conceptForm: item.conceptForm,
      evidenceRole: item.evidenceRole,
      longitudinalPotential: item.longitudinalPotential,
      ...(item.serverSignals && typeof item.serverSignals === "object"
        ? { serverSignals: item.serverSignals as AdmissionServerSignals }
        : {}),
    });
  }
  return {
    ok: true,
    artifact: {
      metadata: {
        assessmentPromptVersion: meta.assessmentPromptVersion,
        assessmentVersion: meta.assessmentVersion,
        model: typeof meta.model === "string" ? meta.model : null,
      },
      assessments,
    },
  };
}

function freezeOccurrences(
  candidate: AdmissionCandidate,
  rows: CandidateOccurrence[],
  units: Record<string, AdmissionProvenanceUnit>,
):
  | { ok: true; occurrences: ApplyManifestOccurrence[] }
  | { ok: false; errors: ApplyManifestIssue[] } {
  const errors: ApplyManifestIssue[] = [];
  const occurrences: ApplyManifestOccurrence[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const unit = units[unitTextKey(row.sessionId, row.evidenceRef)];
    if (!unit) {
      errors.push(
        issue(
          "unresolved_user_evidence",
          `${candidate.candidateRef}:${row.sessionId}:${row.evidenceRef}`,
        ),
      );
      continue;
    }
    const dupKey = `${CONCEPT_EXTRACTION_VERSION}:${unit.messageId}:${row.evidenceRef}`;
    if (seen.has(dupKey)) {
      errors.push(
        issue("duplicate_occurrence", `${candidate.candidateRef}:${dupKey}`),
      );
      continue;
    }
    seen.add(dupKey);
    occurrences.push({
      sessionId: row.sessionId,
      messageId: unit.messageId,
      evidenceRef: row.evidenceRef,
      occurredAt: row.occurredAt,
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, occurrences };
}

export function buildApplyManifest(
  input: BuildApplyManifestInput,
):
  | { ok: true; manifest: ConceptAdmissionApplyManifest }
  | { ok: false; errors: ApplyManifestIssue[] } {
  const errors: ApplyManifestIssue[] = [];
  const loaded = snapshotFromConceptPilotReport(input.candidateReportRaw);
  if (!loaded.ok) {
    return { ok: false, errors: [issue("candidate_report", loaded.error)] };
  }
  const assessment = parseAssessmentArtifact(input.assessmentReportRaw);
  if (!assessment.ok) {
    return { ok: false, errors: [issue("assessment_report", assessment.error)] };
  }

  if (loaded.loaded.extractPromptVersion !== CONCEPT_EXTRACT_PROMPT_VERSION) {
    errors.push(
      issue(
        "extract_prompt_version",
        String(loaded.loaded.extractPromptVersion),
      ),
    );
  }
  if (loaded.loaded.extractionVersion !== CONCEPT_EXTRACTION_VERSION) {
    errors.push(
      issue("extraction_version", String(loaded.loaded.extractionVersion)),
    );
  }
  if (
    assessment.artifact.metadata.assessmentPromptVersion !==
    CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION
  ) {
    errors.push(
      issue(
        "assessment_prompt_version",
        assessment.artifact.metadata.assessmentPromptVersion,
      ),
    );
  }
  if (
    assessment.artifact.metadata.assessmentVersion !==
    CONCEPT_ADMISSION_ASSESSMENT_VERSION
  ) {
    errors.push(
      issue(
        "assessment_version",
        assessment.artifact.metadata.assessmentVersion,
      ),
    );
  }
  if (
    assessment.artifact.metadata.model !==
    CONCEPT_ADMISSION_APPLY_EXPECTED_ASSESSMENT_MODEL
  ) {
    errors.push(
      issue("assessment_model", String(assessment.artifact.metadata.model)),
    );
  }

  const sourceAliases = sourceConceptAliases(input.candidateReportRaw);
  if (sourceAliases.length > 0) {
    errors.push(issue("source_aliases_present", sourceAliases.join(",")));
  }

  const provenance = reconstructAdmissionProvenance(input.sessions);
  const expectedSessionIds = sessionIdsFromAdmissionSnapshot(
    loaded.loaded.snapshot,
  );
  const loadedSessionIds = new Set(
    input.sessions.map((session) => session.sessionId),
  );
  for (const sessionId of expectedSessionIds) {
    if (!loadedSessionIds.has(sessionId)) {
      errors.push(issue("missing_session", sessionId));
    }
  }

  const sourceDuplicates = intraCandidateDuplicateOccurrenceKeys(
    loaded.loaded.snapshot,
  );
  for (const key of sourceDuplicates) {
    errors.push(issue("duplicate_occurrence", key));
  }

  const built = buildAdmissionCandidates({
    snapshot: loaded.loaded.snapshot,
    sessionOccurredAt: provenance.sessionOccurredAt,
    unitTexts: provenance.unitTexts,
  });
  if (!built.ok) {
    return {
      ok: false,
      errors: [issue("candidates", `${built.reason}:${built.detail}`)],
    };
  }

  const coverage = validateAssessmentCoverage({
    candidates: built.candidates,
    assessments: assessment.artifact.assessments,
  });
  const judged = judgeCandidatesWithPolicy({
    candidates: built.candidates,
    assessments: assessment.artifact.assessments,
    policySpec: POLICY_NAMED_OR_HIGH,
  });
  if (!coverage.ok) {
    errors.push(
      issue("assessment_coverage", `${coverage.reason}:${coverage.detail}`),
    );
  }
  if (!judged.ok) {
    errors.push(issue("assessment_coverage", `${judged.reason}:${judged.detail}`));
  }
  if (errors.length > 0 || !coverage.ok || !judged.ok) {
    return { ok: false, errors };
  }

  const typedByRef = new Map(
    coverage.assessments.map((item) => [item.candidateRef, item] as const),
  );
  const reportedByRef = new Map(
    assessment.artifact.assessments.map(
      (item) => [item.candidateRef, item] as const,
    ),
  );
  const occurrenceRows = collectAdmissionOccurrences(
    loaded.loaded.snapshot,
    provenance.sessionOccurredAt,
  );
  const admitted: ApplyManifestAdmittedCandidate[] = [];

  for (const candidate of judged.judged) {
    const typed = typedByRef.get(candidate.candidateRef);
    const reported = reportedByRef.get(candidate.candidateRef);
    if (!typed || !reported) {
      errors.push(issue("missing_assessment", candidate.candidateRef));
      continue;
    }
    const computedSignals = serverSignalsFromCandidate(candidate);
    if (
      reported.serverSignals &&
      !sameSignals(computedSignals, reported.serverSignals)
    ) {
      errors.push(issue("server_signals_mismatch", candidate.candidateRef));
    }
    if (candidate.decision !== "admit") {
      continue;
    }
    const frozen = freezeOccurrences(
      candidate,
      occurrenceRows.get(candidate.candidateRef) ?? [],
      provenance.units,
    );
    if (!frozen.ok) {
      errors.push(...frozen.errors);
      continue;
    }
    if (normalizeConceptKey(candidate.canonicalLabel) !== candidate.normalizedKey) {
      errors.push(issue("normalized_key_mismatch", candidate.candidateRef));
    }
    admitted.push({
      candidateRef: candidate.candidateRef,
      canonicalLabel: candidate.canonicalLabel,
      normalizedKey: candidate.normalizedKey,
      occurrenceCount: candidate.occurrenceCount,
      distinctSessionCount: candidate.distinctSessionCount,
      sessionIds: [...candidate.sessionIds],
      evidenceRefs: [...candidate.evidenceRefs],
      firstSeenAt: candidate.firstSeenAt,
      lastSeenAt: candidate.lastSeenAt,
      occurrences: frozen.occurrences,
      assessment: {
        conceptForm: typed.conceptForm,
        evidenceRole: typed.evidenceRole,
        longitudinalPotential: typed.longitudinalPotential,
      },
      serverSignals: computedSignals,
      policyRuleId: candidate.policyRuleId,
      policyReasonCode: candidate.reasonCode,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  admitted.sort((left, right) =>
    left.candidateRef.localeCompare(right.candidateRef),
  );

  const invariants = admissionIdentityInvariants(
    built.candidates,
    judged.judged,
  );
  if (
    invariants.canonicalChanged !== 0 ||
    invariants.mergedCandidates !== 0 ||
    invariants.occurrenceChanged !== 0
  ) {
    return {
      ok: false,
      errors: [issue("identity_invariant", JSON.stringify(invariants))],
    };
  }

  const draft: ConceptAdmissionApplyManifest = {
    metadata: {
      manifestVersion: CONCEPT_ADMISSION_APPLY_MANIFEST_VERSION,
      mode: CONCEPT_ADMISSION_APPLY_MODE,
      sourceCandidateReport: input.sourceCandidateReportPath,
      assessmentReport: input.assessmentReportPath,
      sourceCandidateReportHash: hashSourceArtifactText(
        input.candidateReportText,
      ),
      assessmentReportHash: hashSourceArtifactText(input.assessmentReportText),
      extractPromptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
      matchingVersion: CONCEPT_MATCHING_VERSION,
      assessmentPromptVersion: CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION,
      assessmentVersion: CONCEPT_ADMISSION_ASSESSMENT_VERSION,
      assessmentModel: CONCEPT_ADMISSION_APPLY_EXPECTED_ASSESSMENT_MODEL,
      admissionPolicyId: CONCEPT_ADMISSION_APPLY_POLICY_ID,
      admissionPolicyVersion: CONCEPT_ADMISSION_POLICY_VERSION,
      generatedAt: (input.now ?? (() => new Date().toISOString()))(),
      contentHash: "",
    },
    admittedCandidates: admitted,
    aliasesToCreate: 0,
  };
  draft.metadata.contentHash = hashApplyManifestContent(draft);

  const validated = validateApplyManifest({
    manifest: draft,
    candidateReportText: input.candidateReportText,
    assessmentReportText: input.assessmentReportText,
    candidateReportRaw: input.candidateReportRaw,
    assessmentReportRaw: input.assessmentReportRaw,
    sessions: input.sessions,
  });
  if (!validated.valid) {
    return { ok: false, errors: validated.errors };
  }
  return { ok: true, manifest: draft };
}

export function validateApplyManifest(input: {
  manifest: ConceptAdmissionApplyManifest;
  candidateReportText: string;
  assessmentReportText: string;
  candidateReportRaw: unknown;
  assessmentReportRaw: unknown;
  sessions: AdmissionEvidenceSession[];
}): ApplyManifestValidation {
  const errors: ApplyManifestIssue[] = [];
  const warnings: ApplyManifestIssue[] = [];

  const leaks = findCalibrationLeaks(input.manifest);
  for (const leak of leaks) {
    errors.push(issue("calibration_field", leak));
  }

  if (
    input.manifest.metadata.manifestVersion !==
    CONCEPT_ADMISSION_APPLY_MANIFEST_VERSION
  ) {
    errors.push(
      issue("manifest_version", input.manifest.metadata.manifestVersion),
    );
  }
  if (input.manifest.metadata.mode !== CONCEPT_ADMISSION_APPLY_MODE) {
    errors.push(issue("manifest_mode", input.manifest.metadata.mode));
  }
  if (input.manifest.aliasesToCreate !== 0) {
    errors.push(
      issue("aliases_to_create", String(input.manifest.aliasesToCreate)),
    );
  }
  if (
    input.manifest.metadata.assessmentModel !==
    CONCEPT_ADMISSION_APPLY_EXPECTED_ASSESSMENT_MODEL
  ) {
    errors.push(
      issue("assessment_model", input.manifest.metadata.assessmentModel),
    );
  }
  if (
    input.manifest.metadata.admissionPolicyId !==
    CONCEPT_ADMISSION_APPLY_POLICY_ID
  ) {
    errors.push(
      issue("admission_policy_id", input.manifest.metadata.admissionPolicyId),
    );
  }
  if (
    input.manifest.metadata.admissionPolicyVersion !==
    CONCEPT_ADMISSION_POLICY_VERSION
  ) {
    errors.push(
      issue(
        "admission_policy_version",
        input.manifest.metadata.admissionPolicyVersion,
      ),
    );
  }

  const sourceHash = hashSourceArtifactText(input.candidateReportText);
  const assessmentHash = hashSourceArtifactText(input.assessmentReportText);
  if (sourceHash !== input.manifest.metadata.sourceCandidateReportHash) {
    errors.push(issue("source_artifact_hash", sourceHash));
  }
  if (assessmentHash !== input.manifest.metadata.assessmentReportHash) {
    errors.push(issue("assessment_artifact_hash", assessmentHash));
  }
  if (
    hashApplyManifestContent(input.manifest) !==
    input.manifest.metadata.contentHash
  ) {
    errors.push(issue("content_hash", input.manifest.metadata.contentHash));
  }

  const loaded = snapshotFromConceptPilotReport(input.candidateReportRaw);
  if (!loaded.ok) {
    errors.push(issue("candidate_report", loaded.error));
    return { valid: false, errors, warnings };
  }
  const assessment = parseAssessmentArtifact(input.assessmentReportRaw);
  if (!assessment.ok) {
    errors.push(issue("assessment_report", assessment.error));
    return { valid: false, errors, warnings };
  }
  if (
    assessment.artifact.metadata.model !==
    CONCEPT_ADMISSION_APPLY_EXPECTED_ASSESSMENT_MODEL
  ) {
    errors.push(
      issue("assessment_model", String(assessment.artifact.metadata.model)),
    );
  }

  const provenance = reconstructAdmissionProvenance(input.sessions);
  const built = buildAdmissionCandidates({
    snapshot: loaded.loaded.snapshot,
    sessionOccurredAt: provenance.sessionOccurredAt,
    unitTexts: provenance.unitTexts,
  });
  if (!built.ok) {
    errors.push(issue("candidates", `${built.reason}:${built.detail}`));
    return { valid: false, errors, warnings };
  }

  const coverage = validateAssessmentCoverage({
    candidates: built.candidates,
    assessments: assessment.artifact.assessments,
  });
  if (!coverage.ok) {
    errors.push(
      issue("assessment_coverage", `${coverage.reason}:${coverage.detail}`),
    );
    return { valid: false, errors, warnings };
  }

  const judged = judgeCandidatesWithPolicy({
    candidates: built.candidates,
    assessments: assessment.artifact.assessments,
    policySpec: POLICY_NAMED_OR_HIGH,
  });
  if (!judged.ok) {
    errors.push(issue("assessment_coverage", `${judged.reason}:${judged.detail}`));
    return { valid: false, errors, warnings };
  }

  const candidateByRef = new Map(
    built.candidates.map((item) => [item.candidateRef, item] as const),
  );
  const typedByRef = new Map(
    coverage.assessments.map((item) => [item.candidateRef, item] as const),
  );
  const occurrenceRows = collectAdmissionOccurrences(
    loaded.loaded.snapshot,
    provenance.sessionOccurredAt,
  );
  const seenRefs = new Set<string>();

  for (const row of input.manifest.admittedCandidates) {
    if (seenRefs.has(row.candidateRef)) {
      errors.push(issue("duplicate_candidate_ref", row.candidateRef));
      continue;
    }
    seenRefs.add(row.candidateRef);
    const candidate = candidateByRef.get(row.candidateRef);
    if (!candidate) {
      errors.push(issue("unknown_candidate_ref", row.candidateRef));
      continue;
    }
    const typed = typedByRef.get(row.candidateRef);
    if (!typed) {
      errors.push(issue("missing_assessment", row.candidateRef));
      continue;
    }
    if (row.canonicalLabel !== candidate.canonicalLabel) {
      errors.push(issue("canonical_label_mismatch", row.candidateRef));
    }
    if (row.normalizedKey !== candidate.normalizedKey) {
      errors.push(issue("normalized_key_mismatch", row.candidateRef));
    }
    if (normalizeConceptKey(row.canonicalLabel) !== row.normalizedKey) {
      errors.push(issue("normalized_key_renormalize", row.candidateRef));
    }
    if (row.occurrenceCount !== candidate.occurrenceCount) {
      errors.push(issue("occurrence_count_mismatch", row.candidateRef));
    }
    if (row.distinctSessionCount !== candidate.distinctSessionCount) {
      errors.push(issue("distinct_session_count_mismatch", row.candidateRef));
    }
    if (!sameStringArray(row.sessionIds, candidate.sessionIds)) {
      errors.push(issue("session_ids_mismatch", row.candidateRef));
    }
    if (!sameStringArray(row.evidenceRefs, candidate.evidenceRefs)) {
      errors.push(issue("evidence_refs_mismatch", row.candidateRef));
    }
    if (row.firstSeenAt !== candidate.firstSeenAt) {
      errors.push(issue("first_seen_mismatch", row.candidateRef));
    }
    if (row.lastSeenAt !== candidate.lastSeenAt) {
      errors.push(issue("last_seen_mismatch", row.candidateRef));
    }
    if (
      row.assessment.conceptForm !== typed.conceptForm ||
      row.assessment.evidenceRole !== typed.evidenceRole ||
      row.assessment.longitudinalPotential !== typed.longitudinalPotential
    ) {
      errors.push(issue("assessment_mismatch", row.candidateRef));
    }

    const computedSignals = serverSignalsFromCandidate(candidate);
    if (!sameSignals(row.serverSignals, computedSignals)) {
      errors.push(issue("server_signals_mismatch", row.candidateRef));
    }
    const policy = applyAdmissionPolicy(
      typed,
      computedSignals,
      POLICY_NAMED_OR_HIGH,
    );
    if (policy.decision !== "admit") {
      errors.push(issue("non_admit_in_manifest", row.candidateRef));
    }
    if (policy.policyRuleId !== row.policyRuleId) {
      errors.push(issue("policy_rule_mismatch", row.candidateRef));
    }
    if (policy.reasonCode !== row.policyReasonCode) {
      errors.push(issue("policy_reason_mismatch", row.candidateRef));
    }

    const sourceOccurrences = occurrenceRows.get(row.candidateRef) ?? [];
    if (row.occurrences.length !== sourceOccurrences.length) {
      errors.push(issue("occurrence_preservation", row.candidateRef));
    }
    const dup = new Set<string>();
    for (const [index, occurrence] of row.occurrences.entries()) {
      const source = sourceOccurrences[index];
      const unit =
        provenance.units[
          unitTextKey(occurrence.sessionId, occurrence.evidenceRef)
        ];
      if (!unit) {
        errors.push(
          issue(
            "unresolved_user_evidence",
            `${row.candidateRef}:${occurrence.evidenceRef}`,
          ),
        );
        continue;
      }
      if (occurrence.sourceRole !== "user") {
        errors.push(issue("non_user_source_role", row.candidateRef));
      }
      if (occurrence.sourceType !== "evidence_unit") {
        errors.push(issue("unsupported_source_type", row.candidateRef));
      }
      if (occurrence.extractionVersion !== CONCEPT_EXTRACTION_VERSION) {
        errors.push(issue("extraction_version", row.candidateRef));
      }
      if (occurrence.messageId !== unit.messageId) {
        errors.push(issue("message_id_mismatch", row.candidateRef));
      }
      if (source && occurrence.occurredAt !== source.occurredAt) {
        errors.push(issue("occurred_at_mismatch", row.candidateRef));
      }
      if (source && occurrence.sessionId !== source.sessionId) {
        errors.push(issue("occurrence_session_mismatch", row.candidateRef));
      }
      if (source && occurrence.evidenceRef !== source.evidenceRef) {
        errors.push(issue("occurrence_evidence_mismatch", row.candidateRef));
      }
      const identity = `${occurrence.extractionVersion}:${occurrence.messageId}:${occurrence.evidenceRef}`;
      if (dup.has(identity)) {
        errors.push(
          issue("duplicate_occurrence", `${row.candidateRef}:${identity}`),
        );
      }
      dup.add(identity);
    }
  }

  for (const candidate of judged.judged) {
    if (candidate.decision === "admit" && !seenRefs.has(candidate.candidateRef)) {
      errors.push(issue("missing_admitted_candidate", candidate.candidateRef));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function applyManifestPreview(input: {
  manifest: ConceptAdmissionApplyManifest;
  registryCounts?: ApplyManifestRegistryCounts | null;
}) {
  return {
    mode: input.manifest.metadata.mode,
    conceptCountToCreate: input.manifest.admittedCandidates.length,
    occurrenceCountToCreate: input.manifest.admittedCandidates.reduce(
      (sum, item) => sum + item.occurrences.length,
      0,
    ),
    aliasCountToCreate: input.manifest.aliasesToCreate,
    sourceCandidateHash: input.manifest.metadata.sourceCandidateReportHash,
    assessmentHash: input.manifest.metadata.assessmentReportHash,
    manifestContentHash: input.manifest.metadata.contentHash,
    registryCounts: input.registryCounts ?? null,
    concepts: input.manifest.admittedCandidates.map((item) => ({
      candidateRef: item.candidateRef,
      canonicalLabel: item.canonicalLabel,
      occurrenceCount: item.occurrenceCount,
      distinctSessionCount: item.distinctSessionCount,
      firstSeenAt: item.firstSeenAt,
      lastSeenAt: item.lastSeenAt,
      policyRuleId: item.policyRuleId,
    })),
  };
}

export function formatApplyManifestPreview(
  preview: ReturnType<typeof applyManifestPreview>,
) {
  const registry = preview.registryCounts
    ? `registry: concepts ${preview.registryCounts.concepts} / aliases ${preview.registryCounts.conceptAliases} / occurrences ${preview.registryCounts.conceptOccurrences}`
    : "registry: (not loaded)";
  const rows = preview.concepts
    .map(
      (item) =>
        `${item.candidateRef}\t${item.canonicalLabel}\tocc=${item.occurrenceCount}\tsessions=${item.distinctSessionCount}\t${item.firstSeenAt}..${item.lastSeenAt}\t${item.policyRuleId}`,
    )
    .join("\n");
  return [
    "Concept admission apply preview (dry-run)",
    `mode: ${preview.mode}`,
    `concepts to create: ${preview.conceptCountToCreate}`,
    `occurrences to create: ${preview.occurrenceCountToCreate}`,
    `aliases to create: ${preview.aliasCountToCreate}`,
    `source candidate hash: ${preview.sourceCandidateHash}`,
    `assessment hash: ${preview.assessmentHash}`,
    `manifest contentHash: ${preview.manifestContentHash}`,
    registry,
    "",
    "candidateRef\tcanonicalLabel\toccurrenceCount\tdistinctSessionCount\tfirstSeenAt..lastSeenAt\tpolicyRuleId",
    rows,
  ].join("\n");
}

export type { ConceptAssessment };

