import { CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-admission-assessment";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import { toEvidenceRole } from "@/lib/ai/evidence-units";
import { prepareUserEvidenceUnits } from "@/lib/concepts/user-units";
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
  CONCEPT_APPLY_DEFAULT_ASSESSMENT,
  CONCEPT_APPLY_DEFAULT_CANDIDATES,
  CONCEPT_APPLY_DEFAULT_MANIFEST,
  CONCEPT_APPLY_DEFAULT_PREFLIGHT,
  hashApplyManifestContent,
  hashSourceArtifactText,
  validateApplyManifest,
  type ConceptAdmissionApplyManifest,
} from "./apply-manifest";
import { snapshotFromConceptPilotReport } from "./loader";
import { sessionIdsFromAdmissionSnapshot } from "./evidence";
import { POLICY_NAMED_OR_HIGH, applyAdmissionPolicy } from "./policy";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  findConceptByNormalizedKey,
  type ConceptQueryDb,
} from "@/lib/db/concept-queries";
import { messages, sessions } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";

export const CONCEPT_APPLY_DEFAULT_PREFLIGHT_REPORT =
  CONCEPT_APPLY_DEFAULT_PREFLIGHT;

export type ApplyPreflightDb = ConceptQueryDb;

export type ApplyPreflightBlocker = {
  code: string;
  detail: string;
};

export type ApplyPreflightProvenanceError = {
  candidateRef: string;
  sessionId: string;
  messageId: string;
  evidenceRef: string;
  errorCode:
    | "missing_session"
    | "missing_message"
    | "message_session_mismatch"
    | "message_not_user"
    | "evidence_ref_unresolved"
    | "evidence_message_mismatch";
};

export type ApplyPreflightPreviewRow = {
  candidateRef: string;
  canonicalLabel: string;
  normalizedKey: string;
  occurrenceCount: number;
  distinctSessionCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  conceptForm: string;
  policyRuleId: string;
};

export type ApplyPreflightResult = {
  status: "ready" | "blocked";
  mode: typeof CONCEPT_ADMISSION_APPLY_MODE;
  checkedAt: string;
  dbPath: string;
  manifestPath: string;
  manifestContentHash: string;
  sourceValidation: {
    candidateHashValid: boolean;
    assessmentHashValid: boolean;
    manifestHashValid: boolean;
  };
  manifestValid: boolean;
  registry: {
    concepts: number;
    aliases: number;
    occurrences: number;
    normalizedKeyConflicts: string[];
  };
  provenance: {
    totalOccurrences: number;
    resolvedOccurrences: number;
    unresolvedOccurrences: number;
    errors: ApplyPreflightProvenanceError[];
  };
  predictedWrites: {
    concepts: number;
    occurrences: number;
    aliases: 0;
  };
  preview: ApplyPreflightPreviewRow[];
  blockers: ApplyPreflightBlocker[];
};

export type RunApplyPreflightInput = {
  db: ApplyPreflightDb;
  dbPath: string;
  manifestPath: string;
  candidateReportPath: string;
  assessmentReportPath: string;
  candidateReportText: string;
  assessmentReportText: string;
  manifest: ConceptAdmissionApplyManifest;
  now?: () => string;
};

function blocker(code: string, detail: string): ApplyPreflightBlocker {
  return { code, detail };
}

function findSession(db: ApplyPreflightDb, sessionId: string) {
  return (
    db.select().from(sessions).where(eq(sessions.id, sessionId)).get() ?? null
  );
}

function findMessageById(db: ApplyPreflightDb, messageId: string) {
  return (
    db.select().from(messages).where(eq(messages.id, messageId)).get() ?? null
  );
}

function listMessages(db: ApplyPreflightDb, sessionId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.index))
    .all();
}

function frozenOccurredAtBySession(manifest: ConceptAdmissionApplyManifest) {
  const times = new Map<string, string>();
  for (const candidate of manifest.admittedCandidates) {
    for (const occurrence of candidate.occurrences) {
      if (!times.has(occurrence.sessionId)) {
        times.set(occurrence.sessionId, occurrence.occurredAt);
      }
    }
  }
  return times;
}

function checkManifestVersions(manifest: ConceptAdmissionApplyManifest) {
  const blockers: ApplyPreflightBlocker[] = [];
  const expected: Array<[string, string, string]> = [
    ["manifestVersion", manifest.metadata.manifestVersion, CONCEPT_ADMISSION_APPLY_MANIFEST_VERSION],
    ["mode", manifest.metadata.mode, CONCEPT_ADMISSION_APPLY_MODE],
    ["extractPromptVersion", manifest.metadata.extractPromptVersion, CONCEPT_EXTRACT_PROMPT_VERSION],
    ["extractionVersion", manifest.metadata.extractionVersion, CONCEPT_EXTRACTION_VERSION],
    ["matchingVersion", manifest.metadata.matchingVersion, CONCEPT_MATCHING_VERSION],
    [
      "assessmentPromptVersion",
      manifest.metadata.assessmentPromptVersion,
      CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION,
    ],
    [
      "assessmentVersion",
      manifest.metadata.assessmentVersion,
      CONCEPT_ADMISSION_ASSESSMENT_VERSION,
    ],
    [
      "assessmentModel",
      manifest.metadata.assessmentModel,
      CONCEPT_ADMISSION_APPLY_EXPECTED_ASSESSMENT_MODEL,
    ],
    [
      "admissionPolicyId",
      manifest.metadata.admissionPolicyId,
      CONCEPT_ADMISSION_APPLY_POLICY_ID,
    ],
    [
      "admissionPolicyVersion",
      manifest.metadata.admissionPolicyVersion,
      CONCEPT_ADMISSION_POLICY_VERSION,
    ],
  ];
  for (const [field, actual, wanted] of expected) {
    if (actual !== wanted) {
      blockers.push(blocker("version_mismatch", `${field}:${actual}`));
    }
  }
  if (manifest.aliasesToCreate !== 0) {
    blockers.push(blocker("aliases_to_create", String(manifest.aliasesToCreate)));
  }
  return blockers;
}

function checkPolicy(manifest: ConceptAdmissionApplyManifest) {
  const blockers: ApplyPreflightBlocker[] = [];
  for (const candidate of manifest.admittedCandidates) {
    const policy = applyAdmissionPolicy(
      {
        candidateRef: candidate.candidateRef,
        ...candidate.assessment,
      },
      candidate.serverSignals,
      POLICY_NAMED_OR_HIGH,
    );
    if (policy.decision !== "admit") {
      blockers.push(
        blocker("non_admit_in_manifest", `${candidate.candidateRef}:${policy.decision}`),
      );
      continue;
    }
    if (policy.policyRuleId !== candidate.policyRuleId) {
      blockers.push(blocker("policy_rule_mismatch", candidate.candidateRef));
    }
    if (policy.reasonCode !== candidate.policyReasonCode) {
      blockers.push(blocker("policy_reason_mismatch", candidate.candidateRef));
    }
  }
  return blockers;
}

function checkDuplicateOccurrences(manifest: ConceptAdmissionApplyManifest) {
  const blockers: ApplyPreflightBlocker[] = [];
  for (const candidate of manifest.admittedCandidates) {
    const seen = new Set<string>();
    for (const occurrence of candidate.occurrences) {
      const key = `${occurrence.extractionVersion}:${occurrence.sourceType}:${occurrence.messageId}:${occurrence.evidenceRef}`;
      if (seen.has(key)) {
        blockers.push(
          blocker("duplicate_occurrence", `${candidate.candidateRef}:${key}`),
        );
      }
      seen.add(key);
    }
  }
  return blockers;
}

function checkProvenance(
  manifest: ConceptAdmissionApplyManifest,
  db: ApplyPreflightDb,
) {
  const errors: ApplyPreflightProvenanceError[] = [];
  let total = 0;
  for (const candidate of manifest.admittedCandidates) {
    for (const occurrence of candidate.occurrences) {
      total += 1;
      const session = findSession(db, occurrence.sessionId);
      if (!session) {
        errors.push({
          candidateRef: candidate.candidateRef,
          sessionId: occurrence.sessionId,
          messageId: occurrence.messageId,
          evidenceRef: occurrence.evidenceRef,
          errorCode: "missing_session",
        });
        continue;
      }
      const message = findMessageById(db, occurrence.messageId);
      if (!message) {
        errors.push({
          candidateRef: candidate.candidateRef,
          sessionId: occurrence.sessionId,
          messageId: occurrence.messageId,
          evidenceRef: occurrence.evidenceRef,
          errorCode: "missing_message",
        });
        continue;
      }
      if (message.sessionId !== occurrence.sessionId) {
        errors.push({
          candidateRef: candidate.candidateRef,
          sessionId: occurrence.sessionId,
          messageId: occurrence.messageId,
          evidenceRef: occurrence.evidenceRef,
          errorCode: "message_session_mismatch",
        });
        continue;
      }
      if (toEvidenceRole(message.role) !== "user") {
        errors.push({
          candidateRef: candidate.candidateRef,
          sessionId: occurrence.sessionId,
          messageId: occurrence.messageId,
          evidenceRef: occurrence.evidenceRef,
          errorCode: "message_not_user",
        });
        continue;
      }
      const units = prepareUserEvidenceUnits({
        sessionId: session.id,
        occurredAt: session.occurredAt,
        messages: listMessages(db, session.id).map((item) => ({
          id: item.id,
          role: item.role,
          content: item.content,
          sourceCreatedAt: item.sourceCreatedAt,
        })),
      });
      const unit = units.find((item) => item.evidenceRef === occurrence.evidenceRef);
      if (!unit) {
        errors.push({
          candidateRef: candidate.candidateRef,
          sessionId: occurrence.sessionId,
          messageId: occurrence.messageId,
          evidenceRef: occurrence.evidenceRef,
          errorCode: "evidence_ref_unresolved",
        });
        continue;
      }
      if (unit.messageId !== occurrence.messageId) {
        errors.push({
          candidateRef: candidate.candidateRef,
          sessionId: occurrence.sessionId,
          messageId: occurrence.messageId,
          evidenceRef: occurrence.evidenceRef,
          errorCode: "evidence_message_mismatch",
        });
      }
    }
  }
  return {
    totalOccurrences: total,
    resolvedOccurrences: total - errors.length,
    unresolvedOccurrences: errors.length,
    errors,
  };
}

function loadSessionsForValidator(
  manifest: ConceptAdmissionApplyManifest,
  candidateReportRaw: unknown,
  db: ApplyPreflightDb,
) {
  const frozenTimes = frozenOccurredAtBySession(manifest);
  const ids = new Set<string>(frozenTimes.keys());
  const loaded = snapshotFromConceptPilotReport(candidateReportRaw);
  if (loaded.ok) {
    for (const sessionId of sessionIdsFromAdmissionSnapshot(
      loaded.loaded.snapshot,
    )) {
      ids.add(sessionId);
    }
  }
  return [...ids].flatMap((sessionId) => {
    const session = findSession(db, sessionId);
    if (!session) {
      return [];
    }
    return [
      {
        sessionId: session.id,
        occurredAt: frozenTimes.get(sessionId) ?? session.occurredAt,
        messages: listMessages(db, sessionId).map((item) => ({
          id: item.id,
          role: item.role,
          content: item.content,
          sourceCreatedAt: item.sourceCreatedAt,
        })),
      },
    ];
  });
}

export function runApplyPreflight(
  input: RunApplyPreflightInput,
): ApplyPreflightResult {
  const blockers: ApplyPreflightBlocker[] = [];
  const manifest = input.manifest;
  const candidateHash = hashSourceArtifactText(input.candidateReportText);
  const assessmentHash = hashSourceArtifactText(input.assessmentReportText);
  const manifestHash = hashApplyManifestContent(manifest);
  const candidateHashValid =
    candidateHash === manifest.metadata.sourceCandidateReportHash;
  const assessmentHashValid =
    assessmentHash === manifest.metadata.assessmentReportHash;
  const manifestHashValid = manifestHash === manifest.metadata.contentHash;

  if (!candidateHashValid) {
    blockers.push(blocker("source_artifact_hash", candidateHash));
  }
  if (!assessmentHashValid) {
    blockers.push(blocker("assessment_artifact_hash", assessmentHash));
  }
  if (!manifestHashValid) {
    blockers.push(blocker("content_hash", manifestHash));
  }

  blockers.push(...checkManifestVersions(manifest));
  blockers.push(...checkPolicy(manifest));
  blockers.push(...checkDuplicateOccurrences(manifest));

  let candidateRaw: unknown = null;
  let assessmentRaw: unknown = null;
  try {
    candidateRaw = JSON.parse(input.candidateReportText);
    assessmentRaw = JSON.parse(input.assessmentReportText);
  } catch (error) {
    blockers.push(
      blocker(
        "artifact_parse",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }

  let manifestValid = false;
  if (candidateRaw && assessmentRaw) {
    const validation = validateApplyManifest({
      manifest,
      candidateReportText: input.candidateReportText,
      assessmentReportText: input.assessmentReportText,
      candidateReportRaw: candidateRaw,
      assessmentReportRaw: assessmentRaw,
      sessions: loadSessionsForValidator(manifest, candidateRaw, input.db),
    });
    manifestValid = validation.valid;
    const dateOnly = new Set([
      "occurred_at_mismatch",
      "first_seen_mismatch",
      "last_seen_mismatch",
    ]);
    const material = validation.errors.filter((issue) => !dateOnly.has(issue.code));
    if (material.length === 0) {
      manifestValid = true;
    } else {
      for (const issue of material) {
        blockers.push(blocker(issue.code, issue.detail));
      }
    }
  }

  const registryCounts = {
    concepts: countConcepts(input.db),
    aliases: countConceptAliases(input.db),
    occurrences: countConceptOccurrences(input.db),
  };
  if (
    registryCounts.concepts !== 0 ||
    registryCounts.aliases !== 0 ||
    registryCounts.occurrences !== 0
  ) {
    blockers.push(
      blocker("initial_registry_not_empty", JSON.stringify(registryCounts)),
    );
  }

  const normalizedKeyConflicts = [
    ...new Set(manifest.admittedCandidates.map((item) => item.normalizedKey)),
  ].filter((key) => Boolean(findConceptByNormalizedKey(key, input.db)));
  if (normalizedKeyConflicts.length > 0) {
    blockers.push(
      blocker("normalized_key_conflict", normalizedKeyConflicts.join(",")),
    );
  }

  const provenance = checkProvenance(manifest, input.db);
  for (const error of provenance.errors) {
    blockers.push(
      blocker(
        error.errorCode,
        `${error.candidateRef}:${error.sessionId}:${error.messageId}:${error.evidenceRef}`,
      ),
    );
  }

  const uniqueBlockers = [
    ...new Map(
      blockers.map((item) => [`${item.code}:${item.detail}`, item] as const),
    ).values(),
  ];
  const ready =
    uniqueBlockers.length === 0 &&
    candidateHashValid &&
    assessmentHashValid &&
    manifestHashValid &&
    manifestValid &&
    registryCounts.concepts === 0 &&
    registryCounts.aliases === 0 &&
    registryCounts.occurrences === 0 &&
    normalizedKeyConflicts.length === 0 &&
    provenance.unresolvedOccurrences === 0 &&
    manifest.aliasesToCreate === 0;

  return {
    status: ready ? "ready" : "blocked",
    mode: CONCEPT_ADMISSION_APPLY_MODE,
    checkedAt: (input.now ?? (() => new Date().toISOString()))(),
    dbPath: input.dbPath,
    manifestPath: input.manifestPath,
    manifestContentHash: manifest.metadata.contentHash,
    sourceValidation: {
      candidateHashValid,
      assessmentHashValid,
      manifestHashValid,
    },
    manifestValid,
    registry: {
      concepts: registryCounts.concepts,
      aliases: registryCounts.aliases,
      occurrences: registryCounts.occurrences,
      normalizedKeyConflicts,
    },
    provenance,
    predictedWrites: {
      concepts: manifest.admittedCandidates.length,
      occurrences: manifest.admittedCandidates.reduce(
        (sum, item) => sum + item.occurrences.length,
        0,
      ),
      aliases: 0,
    },
    preview: manifest.admittedCandidates.map((item) => ({
      candidateRef: item.candidateRef,
      canonicalLabel: item.canonicalLabel,
      normalizedKey: item.normalizedKey,
      occurrenceCount: item.occurrenceCount,
      distinctSessionCount: item.distinctSessionCount,
      firstSeenAt: item.firstSeenAt,
      lastSeenAt: item.lastSeenAt,
      conceptForm: item.assessment.conceptForm,
      policyRuleId: item.policyRuleId,
    })),
    blockers: uniqueBlockers,
  };
}

export function applyPreflightReportPayload(result: ApplyPreflightResult) {
  return {
    checkedAt: result.checkedAt,
    mode: result.mode,
    status: result.status,
    dbPath: result.dbPath,
    manifestPath: result.manifestPath,
    contentHash: result.manifestContentHash,
    sourceValidation: result.sourceValidation,
    manifestValid: result.manifestValid,
    registry: result.registry,
    provenance: {
      totalOccurrences: result.provenance.totalOccurrences,
      resolvedOccurrences: result.provenance.resolvedOccurrences,
      unresolvedOccurrences: result.provenance.unresolvedOccurrences,
      errors: result.provenance.errors,
    },
    predictedWrites: result.predictedWrites,
    preview: result.preview,
    blockers: result.blockers,
  };
}

export function formatApplyPreflightSummary(result: ApplyPreflightResult) {
  const blockers =
    result.blockers.length === 0
      ? "none"
      : result.blockers.map((item) => `${item.code}:${item.detail}`).join("\n");
  const rows = result.preview
    .map(
      (item) =>
        `${item.candidateRef}\t${item.canonicalLabel}\t${item.normalizedKey}\tocc=${item.occurrenceCount}\tsessions=${item.distinctSessionCount}\t${item.firstSeenAt}..${item.lastSeenAt}\t${item.conceptForm}\t${item.policyRuleId}`,
    )
    .join("\n");
  return [
    "Concept admission apply preflight (read-only)",
    `status: ${result.status}`,
    `mode: ${result.mode}`,
    `db: ${result.dbPath}`,
    `manifest: ${result.manifestPath}`,
    `contentHash: ${result.manifestContentHash}`,
    `candidate hash valid: ${result.sourceValidation.candidateHashValid}`,
    `assessment hash valid: ${result.sourceValidation.assessmentHashValid}`,
    `manifest hash valid: ${result.sourceValidation.manifestHashValid}`,
    `manifest valid: ${result.manifestValid}`,
    `registry: concepts ${result.registry.concepts} / aliases ${result.registry.aliases} / occurrences ${result.registry.occurrences}`,
    `normalizedKey conflicts: ${result.registry.normalizedKeyConflicts.length}`,
    `provenance: ${result.provenance.resolvedOccurrences}/${result.provenance.totalOccurrences} resolved`,
    `predicted writes: concepts ${result.predictedWrites.concepts} / occurrences ${result.predictedWrites.occurrences} / aliases ${result.predictedWrites.aliases}`,
    "",
    "candidateRef\tcanonicalLabel\tnormalizedKey\toccurrenceCount\tdistinctSessionCount\tfirstSeenAt..lastSeenAt\tconceptForm\tpolicyRuleId",
    rows,
    "",
    "blockers:",
    blockers,
  ].join("\n");
}

export {
  CONCEPT_APPLY_DEFAULT_ASSESSMENT,
  CONCEPT_APPLY_DEFAULT_CANDIDATES,
  CONCEPT_APPLY_DEFAULT_MANIFEST,
};
