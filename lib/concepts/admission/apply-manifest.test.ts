import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-admission-assessment";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import { CONCEPT_EXTRACTION_VERSION, CONCEPT_MATCHING_VERSION } from "@/lib/concepts/types";
import {
  CONCEPT_ADMISSION_ASSESSMENT_VERSION,
  CONCEPT_ADMISSION_POLICY_VERSION,
} from "./assessment-types";
import {
  CONCEPT_ADMISSION_APPLY_EXPECTED_ASSESSMENT_MODEL,
  CONCEPT_ADMISSION_APPLY_MANIFEST_VERSION,
  CONCEPT_ADMISSION_APPLY_MODE,
  CONCEPT_ADMISSION_APPLY_POLICY_ID,
  applyManifestPreview,
  buildApplyManifest,
  hashApplyManifestContent,
  hashSourceArtifactText,
  validateApplyManifest,
  type ConceptAdmissionApplyManifest,
} from "./apply-manifest";
import { hashJsonContent } from "./canonical-json";
import type { AdmissionEvidenceSession } from "./evidence";
import {
  POLICY_NAMED_OR_HIGH,
  applyAdmissionPolicy,
  judgeCandidatesWithPolicy,
  serverSignalsFromCandidate,
} from "./policy";
import { snapshotFromConceptPilotReport } from "./loader";
import { buildAdmissionCandidates } from "./candidates";
import { reconstructAdmissionProvenance } from "./evidence";

const SESSION_A = "080a113a-b0b3-4c50-9160-8415203e4a48";
const SESSION_B = "32935f2d-cac9-4c9e-85f3-c9969717ece2";

const USER_A =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const USER_B =
  "人間関係を最小限にする道を選びました。高性能AIについても触れます。";
const ASSISTANT = "了解しました。人間関係と高性能AIの両方を整理します。";

function session(
  id: string,
  occurredAt: string,
  user: string,
): AdmissionEvidenceSession {
  return {
    sessionId: id,
    occurredAt,
    messages: [
      {
        id: `${id}-u`,
        role: "user",
        content: user,
        sourceCreatedAt: "2019-01-01T00:00:00.000Z",
      },
      { id: `${id}-a`, role: "assistant", content: ASSISTANT },
    ],
  };
}

const SESSIONS = [
  session(SESSION_A, "2026-07-15", USER_A),
  session(SESSION_B, "2026-07-16", USER_B),
];

function v4LikeReport() {
  return {
    metadata: {
      generatedAt: "2026-08-21T10:21:19.667Z",
      model: "gpt-4o-mini-2024-07-18",
      promptVersion: "concept-extract-prompt-v4",
      extractionVersion: "concept-extraction-v1",
      selectedSessionIds: [SESSION_A, SESSION_B],
      outputPath: "data/concept-pilot-2b-v4.json",
    },
    concepts: [
      {
        ref: "C20",
        canonicalLabel: "人間関係",
        normalizedKey: "人間関係",
        aliases: [],
        occurrenceCount: 2,
        distinctSessionCount: 2,
      },
      {
        ref: "C42",
        canonicalLabel: "高性能AI",
        normalizedKey: "高性能ai",
        aliases: [],
        occurrenceCount: 1,
        distinctSessionCount: 1,
      },
      {
        ref: "C31",
        canonicalLabel: "高性能",
        normalizedKey: "高性能",
        aliases: [],
        occurrenceCount: 1,
        distinctSessionCount: 1,
      },
      {
        ref: "C22",
        canonicalLabel: "恐ろしいこと",
        normalizedKey: "恐ろしいこと",
        aliases: [],
        occurrenceCount: 1,
        distinctSessionCount: 1,
      },
    ],
    actions: [
      {
        sessionId: SESSION_A,
        evidenceRef: "M001:E01",
        surfaceForm: "人間関係",
        resolvedAs: "new",
        matchKind: null,
        conceptRef: "C20",
      },
      {
        sessionId: SESSION_B,
        evidenceRef: "M001:E01",
        surfaceForm: "人間関係",
        resolvedAs: "match",
        matchKind: "exact",
        conceptRef: "C20",
      },
      {
        sessionId: SESSION_B,
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        resolvedAs: "new",
        matchKind: null,
        conceptRef: "C42",
      },
      {
        sessionId: SESSION_B,
        evidenceRef: "M001:E01",
        surfaceForm: "高性能",
        resolvedAs: "new",
        matchKind: null,
        conceptRef: "C31",
      },
      {
        sessionId: SESSION_A,
        evidenceRef: "M001:E01",
        surfaceForm: "恐ろしいこと",
        resolvedAs: "new",
        matchKind: null,
        conceptRef: "C22",
      },
    ],
    suspicious: [{ kind: "generic_surface", conceptRef: "C31" }],
    provisionalMatches: [],
  };
}

function assessmentReport() {
  return {
    metadata: {
      generatedAt: "2026-08-22T00:00:00.000Z",
      assessmentPromptVersion: "concept-admission-assessment-prompt-v2",
      assessmentVersion: "concept-admission-assessment-v2",
      model: "gpt-4o-2024-08-06",
    },
    assessments: [
      {
        candidateRef: "C20",
        canonicalLabel: "人間関係",
        conceptForm: "specific_named_concept",
        evidenceRole: "central",
        longitudinalPotential: "high",
        evidenceRefs: ["M001:E01"],
        serverSignals: {
          occurrenceCount: 2,
          distinctSessionCount: 2,
          hasExactRecurrence: true,
          hasObservedAliasRecurrence: false,
          suspiciousFlags: [],
        },
      },
      {
        candidateRef: "C42",
        canonicalLabel: "高性能AI",
        conceptForm: "stable_topic",
        evidenceRole: "supporting",
        longitudinalPotential: "high",
        evidenceRefs: ["M001:E01"],
        serverSignals: {
          occurrenceCount: 1,
          distinctSessionCount: 1,
          hasExactRecurrence: false,
          hasObservedAliasRecurrence: false,
          suspiciousFlags: [],
        },
      },
      {
        candidateRef: "C31",
        canonicalLabel: "高性能",
        conceptForm: "generic_head",
        evidenceRole: "incidental",
        longitudinalPotential: "low",
        evidenceRefs: ["M001:E01"],
        serverSignals: {
          occurrenceCount: 1,
          distinctSessionCount: 1,
          hasExactRecurrence: false,
          hasObservedAliasRecurrence: false,
          suspiciousFlags: ["generic_surface"],
        },
      },
      {
        candidateRef: "C22",
        canonicalLabel: "恐ろしいこと",
        conceptForm: "unclear",
        evidenceRole: "unclear",
        longitudinalPotential: "low",
        evidenceRefs: ["M001:E01"],
        serverSignals: {
          occurrenceCount: 1,
          distinctSessionCount: 1,
          hasExactRecurrence: false,
          hasObservedAliasRecurrence: false,
          suspiciousFlags: [],
        },
      },
    ],
  };
}

function buildInput(overrides?: {
  candidateReport?: ReturnType<typeof v4LikeReport>;
  assessmentReport?: ReturnType<typeof assessmentReport>;
  sessions?: AdmissionEvidenceSession[];
  now?: () => string;
}) {
  const candidateReport = overrides?.candidateReport ?? v4LikeReport();
  const assessment = overrides?.assessmentReport ?? assessmentReport();
  return {
    sourceCandidateReportPath: "data/concept-pilot-2b-v4.json",
    assessmentReportPath: "data/concept-admission-assessment-v2-gpt4o.json",
    candidateReportText: JSON.stringify(candidateReport),
    assessmentReportText: JSON.stringify(assessment),
    candidateReportRaw: candidateReport,
    assessmentReportRaw: assessment,
    sessions: overrides?.sessions ?? SESSIONS,
    now: overrides?.now,
  };
}

function productionApplySources() {
  return [
    "lib/concepts/admission/apply-manifest.ts",
    "lib/concepts/admission/apply-pilot.ts",
    "lib/concepts/admission/canonical-json.ts",
    "scripts/concept-admission-apply.ts",
  ].map((path) =>
    readFileSync(resolve(process.cwd(), path), "utf8"),
  );
}

test("artifact hash: same content, generatedAt-independent manifest hash, source/assessment drift", () => {
  assert.equal(hashJsonContent({ b: 2, a: 1 }), hashJsonContent({ a: 1, b: 2 }));
  const text = JSON.stringify(v4LikeReport());
  assert.equal(hashSourceArtifactText(text), hashSourceArtifactText(text));

  const first = buildApplyManifest(
    buildInput({ now: () => "2026-08-22T01:00:00.000Z" }),
  );
  const second = buildApplyManifest(
    buildInput({ now: () => "2026-08-22T09:00:00.000Z" }),
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) {
    return;
  }
  assert.notEqual(
    first.manifest.metadata.generatedAt,
    second.manifest.metadata.generatedAt,
  );
  assert.equal(
    first.manifest.metadata.contentHash,
    second.manifest.metadata.contentHash,
  );
  assert.equal(
    hashApplyManifestContent(first.manifest),
    first.manifest.metadata.contentHash,
  );

  const changedCandidate = v4LikeReport();
  changedCandidate.concepts[0]!.canonicalLabel = "人間関係の変化";
  assert.notEqual(
    hashSourceArtifactText(JSON.stringify(v4LikeReport())),
    hashSourceArtifactText(JSON.stringify(changedCandidate)),
  );

  const changedAssessment = assessmentReport();
  changedAssessment.assessments[0]!.conceptForm = "stable_topic";
  assert.notEqual(
    hashSourceArtifactText(JSON.stringify(assessmentReport())),
    hashSourceArtifactText(JSON.stringify(changedAssessment)),
  );
});

test("Manifest は Policy ADMIT だけを含め、件数を hardcode しない", () => {
  const built = buildApplyManifest(buildInput());
  assert.equal(built.ok, true, built.ok ? undefined : JSON.stringify(built.errors));
  if (!built.ok) {
    return;
  }
  const refs = built.manifest.admittedCandidates.map((item) => item.candidateRef);
  assert.deepEqual(refs, ["C20", "C42"]);
  assert.equal(
    built.manifest.admittedCandidates.some((item) => item.candidateRef === "C31"),
    false,
  );
  assert.equal(
    built.manifest.admittedCandidates.some((item) => item.candidateRef === "C22"),
    false,
  );

  const loaded = snapshotFromConceptPilotReport(v4LikeReport());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }
  const provenance = reconstructAdmissionProvenance(SESSIONS);
  const candidates = buildAdmissionCandidates({
    snapshot: loaded.loaded.snapshot,
    sessionOccurredAt: provenance.sessionOccurredAt,
    unitTexts: provenance.unitTexts,
  });
  assert.equal(candidates.ok, true);
  if (!candidates.ok) {
    return;
  }
  const judged = judgeCandidatesWithPolicy({
    candidates: candidates.candidates,
    assessments: assessmentReport().assessments,
    policySpec: POLICY_NAMED_OR_HIGH,
  });
  assert.equal(judged.ok, true);
  if (!judged.ok) {
    return;
  }
  const expectedAdmit = judged.judged
    .filter((item) => item.decision === "admit")
    .map((item) => item.candidateRef)
    .sort((left, right) => left.localeCompare(right));
  assert.deepEqual(refs, expectedAdmit);
  assert.notEqual(expectedAdmit.length, candidates.candidates.length);
  assert.equal(
    productionApplySources().some((source) =>
      /admittedCandidates\.length === 18|ADMIT_COUNT\s*=\s*18/.test(source),
    ),
    false,
  );

  assert.equal(
    built.manifest.metadata.manifestVersion,
    CONCEPT_ADMISSION_APPLY_MANIFEST_VERSION,
  );
  assert.equal(built.manifest.metadata.mode, CONCEPT_ADMISSION_APPLY_MODE);
  assert.equal(
    built.manifest.metadata.extractPromptVersion,
    CONCEPT_EXTRACT_PROMPT_VERSION,
  );
  assert.equal(
    built.manifest.metadata.extractionVersion,
    CONCEPT_EXTRACTION_VERSION,
  );
  assert.equal(
    built.manifest.metadata.matchingVersion,
    CONCEPT_MATCHING_VERSION,
  );
  assert.equal(
    built.manifest.metadata.assessmentPromptVersion,
    CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION,
  );
  assert.equal(
    built.manifest.metadata.assessmentVersion,
    CONCEPT_ADMISSION_ASSESSMENT_VERSION,
  );
  assert.equal(
    built.manifest.metadata.assessmentModel,
    CONCEPT_ADMISSION_APPLY_EXPECTED_ASSESSMENT_MODEL,
  );
  assert.equal(
    built.manifest.metadata.admissionPolicyId,
    CONCEPT_ADMISSION_APPLY_POLICY_ID,
  );
  assert.equal(
    built.manifest.metadata.admissionPolicyVersion,
    CONCEPT_ADMISSION_POLICY_VERSION,
  );
  assert.equal(built.manifest.aliasesToCreate, 0);

  const serialized = JSON.stringify(built.manifest);
  assert.doesNotMatch(serialized, /importantStable/);
  assert.doesNotMatch(serialized, /classAAdmitRate/);
  assert.doesNotMatch(serialized, /calibrationClass/);
  assert.doesNotMatch(serialized, new RegExp(USER_A));
  assert.doesNotMatch(serialized, /了解しました/);
});

test("Policy recomputation が一致し、mismatch / non-admit 混入は fail", () => {
  const built = buildApplyManifest(buildInput());
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  for (const row of built.manifest.admittedCandidates) {
    const recomputed = applyAdmissionPolicy(
      {
        candidateRef: row.candidateRef,
        ...row.assessment,
      },
      row.serverSignals,
      POLICY_NAMED_OR_HIGH,
    );
    assert.equal(recomputed.decision, "admit");
    assert.equal(recomputed.policyRuleId, row.policyRuleId);
    assert.equal(recomputed.reasonCode, row.policyReasonCode);
  }
  assert.equal(
    built.manifest.admittedCandidates.find((item) => item.candidateRef === "C20")
      ?.policyRuleId,
    "form_specific",
  );
  assert.equal(
    built.manifest.admittedCandidates.find((item) => item.candidateRef === "C42")
      ?.policyRuleId,
    "form_stable_high",
  );

  const mismatched: ConceptAdmissionApplyManifest = structuredClone(
    built.manifest,
  );
  mismatched.admittedCandidates[0]!.policyRuleId = "wrong_rule";
  mismatched.metadata.contentHash = hashApplyManifestContent(mismatched);
  const policyFail = validateApplyManifest({
    manifest: mismatched,
    candidateReportText: JSON.stringify(v4LikeReport()),
    assessmentReportText: JSON.stringify(assessmentReport()),
    candidateReportRaw: v4LikeReport(),
    assessmentReportRaw: assessmentReport(),
    sessions: SESSIONS,
  });
  assert.equal(policyFail.valid, false);
  assert.equal(
    policyFail.errors.some((item) => item.code === "policy_rule_mismatch"),
    true,
  );

  const leaked = structuredClone(built.manifest);
  leaked.admittedCandidates.push({
    ...leaked.admittedCandidates[0]!,
    candidateRef: "C31",
    canonicalLabel: "高性能",
    normalizedKey: "高性能",
    policyRuleId: "hard_generic",
    policyReasonCode: "hard_generic",
    assessment: {
      conceptForm: "generic_head",
      evidenceRole: "incidental",
      longitudinalPotential: "low",
    },
    serverSignals: serverSignalsFromCandidate({
      occurrenceCount: 1,
      distinctSessionCount: 1,
      matchKindsSeen: ["new"],
      suspiciousFlags: ["generic_surface"],
    }),
  });
  leaked.metadata.contentHash = hashApplyManifestContent(leaked);
  const nonAdmit = validateApplyManifest({
    manifest: leaked,
    candidateReportText: JSON.stringify(v4LikeReport()),
    assessmentReportText: JSON.stringify(assessmentReport()),
    candidateReportRaw: v4LikeReport(),
    assessmentReportRaw: assessmentReport(),
    sessions: SESSIONS,
  });
  assert.equal(nonAdmit.valid, false);
  assert.equal(
    nonAdmit.errors.some((item) => item.code === "non_admit_in_manifest"),
    true,
  );
});

test("Provenance: USER Evidence / messageId / evidenceRef / occurredAt を freeze", () => {
  const built = buildApplyManifest(buildInput());
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const human = built.manifest.admittedCandidates.find(
    (item) => item.candidateRef === "C20",
  );
  assert.ok(human);
  assert.equal(human?.occurrences.length, 2);
  assert.deepEqual(
    human?.occurrences.map((item) => item.sessionId),
    [SESSION_A, SESSION_B],
  );
  assert.deepEqual(
    human?.occurrences.map((item) => item.messageId),
    [`${SESSION_A}-u`, `${SESSION_B}-u`],
  );
  assert.deepEqual(
    human?.occurrences.map((item) => item.evidenceRef),
    ["M001:E01", "M001:E01"],
  );
  assert.deepEqual(
    human?.occurrences.map((item) => item.occurredAt),
    ["2026-07-15", "2026-07-16"],
  );
  assert.equal(
    human?.occurrences.every((item) => item.sourceRole === "user"),
    true,
  );
  assert.equal(
    human?.occurrences.every((item) => item.sourceType === "evidence_unit"),
    true,
  );
  assert.equal(
    human?.occurrences.every(
      (item) => item.extractionVersion === CONCEPT_EXTRACTION_VERSION,
    ),
    true,
  );
  assert.equal(human?.occurrences.some((item) => item.messageId.endsWith("-a")), false);

  const mutated = structuredClone(built.manifest);
  mutated.admittedCandidates[0]!.occurrences[0]!.occurredAt = "2099-01-01";
  mutated.metadata.contentHash = hashApplyManifestContent(mutated);
  const occurredFail = validateApplyManifest({
    manifest: mutated,
    candidateReportText: JSON.stringify(v4LikeReport()),
    assessmentReportText: JSON.stringify(assessmentReport()),
    candidateReportRaw: v4LikeReport(),
    assessmentReportRaw: assessmentReport(),
    sessions: SESSIONS,
  });
  assert.equal(occurredFail.valid, false);
  assert.equal(
    occurredFail.errors.some((item) => item.code === "occurred_at_mismatch"),
    true,
  );

  const assistantReport = v4LikeReport();
  assistantReport.actions[0]!.evidenceRef = "M002:E01";
  const assistant = buildApplyManifest(
    buildInput({ candidateReport: assistantReport }),
  );
  assert.equal(assistant.ok, false);
  if (assistant.ok) {
    return;
  }
  assert.equal(
    assistant.errors.some((item) => item.code === "unresolved_user_evidence"),
    true,
  );
});

test("Occurrence は全件保存し、同一 Candidate 重複は fail、異なる Candidate の共有は許可", () => {
  const built = buildApplyManifest(buildInput());
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const human = built.manifest.admittedCandidates.find(
    (item) => item.candidateRef === "C20",
  );
  const ai = built.manifest.admittedCandidates.find(
    (item) => item.candidateRef === "C42",
  );
  assert.equal(human?.occurrenceCount, 2);
  assert.equal(human?.occurrences.length, 2);
  assert.equal(ai?.occurrences.length, 1);
  assert.equal(ai?.occurrences[0]?.evidenceRef, "M001:E01");
  assert.equal(ai?.occurrences[0]?.sessionId, SESSION_B);
  assert.equal(
    human?.occurrences.some(
      (item) =>
        item.sessionId === SESSION_B && item.evidenceRef === "M001:E01",
    ),
    true,
  );

  const duplicateReport = v4LikeReport();
  duplicateReport.actions.push({ ...duplicateReport.actions[0]! });
  const duplicate = buildApplyManifest(
    buildInput({ candidateReport: duplicateReport }),
  );
  assert.equal(duplicate.ok, false);
  if (duplicate.ok) {
    return;
  }
  assert.equal(
    duplicate.errors.some((item) => item.code === "duplicate_occurrence"),
    true,
  );

  const cloned = structuredClone(built.manifest);
  cloned.admittedCandidates[0]!.occurrences.push({
    ...cloned.admittedCandidates[0]!.occurrences[0]!,
  });
  cloned.metadata.contentHash = hashApplyManifestContent(cloned);
  const dupValidate = validateApplyManifest({
    manifest: cloned,
    candidateReportText: JSON.stringify(v4LikeReport()),
    assessmentReportText: JSON.stringify(assessmentReport()),
    candidateReportRaw: v4LikeReport(),
    assessmentReportRaw: assessmentReport(),
    sessions: SESSIONS,
  });
  assert.equal(dupValidate.valid, false);
  assert.equal(
    dupValidate.errors.some((item) => item.code === "duplicate_occurrence"),
    true,
  );
});

test("Identity: rename / merge / split / alias generation は 0", () => {
  const built = buildApplyManifest(buildInput());
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  assert.equal(built.manifest.aliasesToCreate, 0);
  const preview = applyManifestPreview({ manifest: built.manifest });
  assert.equal(preview.aliasCountToCreate, 0);
  assert.equal(preview.mode, "initial");
  assert.equal(preview.conceptCountToCreate, 2);
  assert.equal(preview.occurrenceCountToCreate, 3);
  const human = built.manifest.admittedCandidates.find(
    (item) => item.candidateRef === "C20",
  );
  assert.equal(human?.canonicalLabel, "人間関係");
  assert.equal(human?.normalizedKey, "人間関係");
});

test("source artifact hash mismatch / assessment model mismatch / calibration leak は fail", () => {
  const built = buildApplyManifest(buildInput());
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const hashMismatch = validateApplyManifest({
    manifest: built.manifest,
    candidateReportText: JSON.stringify({ ...v4LikeReport(), extra: true }),
    assessmentReportText: JSON.stringify(assessmentReport()),
    candidateReportRaw: v4LikeReport(),
    assessmentReportRaw: assessmentReport(),
    sessions: SESSIONS,
  });
  assert.equal(hashMismatch.valid, false);
  assert.equal(
    hashMismatch.errors.some((item) => item.code === "source_artifact_hash"),
    true,
  );

  const wrongModel = assessmentReport();
  wrongModel.metadata.model = "gpt-4o-mini-2024-07-18";
  const modelFail = buildApplyManifest(
    buildInput({ assessmentReport: wrongModel }),
  );
  assert.equal(modelFail.ok, false);
  if (modelFail.ok) {
    return;
  }
  assert.equal(
    modelFail.errors.some((item) => item.code === "assessment_model"),
    true,
  );

  const contaminated = structuredClone(built.manifest) as ConceptAdmissionApplyManifest & {
    importantStable?: string[];
  };
  contaminated.importantStable = ["人間関係"];
  contaminated.metadata.contentHash = hashApplyManifestContent(contaminated);
  const leak = validateApplyManifest({
    manifest: contaminated,
    candidateReportText: JSON.stringify(v4LikeReport()),
    assessmentReportText: JSON.stringify(assessmentReport()),
    candidateReportRaw: v4LikeReport(),
    assessmentReportRaw: assessmentReport(),
    sessions: SESSIONS,
  });
  assert.equal(leak.valid, false);
  assert.equal(
    leak.errors.some((item) => item.code === "calibration_field"),
    true,
  );

  for (const source of productionApplySources()) {
    assert.doesNotMatch(source, /from ["']\.\/calibration["']/);
    assert.doesNotMatch(source, /from ["']@\/lib\/concepts\/admission\/calibration["']/);
    assert.doesNotMatch(source, /insertConcept/);
    assert.doesNotMatch(source, /負の連鎖/);
  }
});
