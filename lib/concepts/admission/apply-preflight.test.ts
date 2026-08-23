import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { applySqlMigrations } from "@/lib/db/client";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  insertConcept,
  insertConceptAlias,
  insertConceptOccurrence,
} from "@/lib/db/concept-queries";
import * as schema from "@/lib/db/schema";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { buildApplyManifest } from "./apply-manifest";
import { runApplyPreflight } from "./apply-preflight";
import {
  CONCEPT_APPLY_APPLY_ERROR,
  parseConceptAdmissionPreflightArgs,
  runConceptAdmissionPreflight,
} from "./apply-preflight-pilot";
import type { AdmissionEvidenceSession } from "./evidence";

const SESSION_A = "080a113a-b0b3-4c50-9160-8415203e4a48";
const SESSION_B = "32935f2d-cac9-4c9e-85f3-c9969717ece2";
const USER_A =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const USER_B =
  "人間関係を最小限にする道を選びました。高性能AIについても触れます。";
const ASSISTANT = "了解しました。人間関係と高性能AIの両方を整理します。";

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function session(
  id: string,
  occurredAt: string,
  user: string,
): AdmissionEvidenceSession {
  return {
    sessionId: id,
    occurredAt,
    messages: [
      { id: `${id}-u`, role: "user", content: user },
      { id: `${id}-a`, role: "assistant", content: ASSISTANT },
    ],
  };
}

const EVIDENCE_SESSIONS = [
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
    },
    concepts: [
      {
        ref: "C20",
        canonicalLabel: "人間関係",
        normalizedKey: "人間関係",
        aliases: [],
      },
      {
        ref: "C42",
        canonicalLabel: "高性能AI",
        normalizedKey: "高性能ai",
        aliases: [],
      },
      {
        ref: "C31",
        canonicalLabel: "高性能",
        normalizedKey: "高性能",
        aliases: [],
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
    ],
    suspicious: [{ kind: "generic_surface", conceptRef: "C31" }],
    provisionalMatches: [],
  };
}

function assessmentReport() {
  return {
    metadata: {
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
        serverSignals: {
          occurrenceCount: 1,
          distinctSessionCount: 1,
          hasExactRecurrence: false,
          hasObservedAliasRecurrence: false,
          suspiciousFlags: ["generic_surface"],
        },
      },
    ],
  };
}

function validatedManifest() {
  const candidateReport = v4LikeReport();
  const assessment = assessmentReport();
  const built = buildApplyManifest({
    sourceCandidateReportPath: "data/concept-pilot-2b-v4.json",
    assessmentReportPath: "data/concept-admission-assessment-v2-gpt4o.json",
    candidateReportText: JSON.stringify(candidateReport),
    assessmentReportText: JSON.stringify(assessment),
    candidateReportRaw: candidateReport,
    assessmentReportRaw: assessment,
    sessions: EVIDENCE_SESSIONS,
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(built.ok, true, built.ok ? undefined : JSON.stringify(built.errors));
  if (!built.ok) {
    throw new Error("fixture manifest failed");
  }
  return built.manifest;
}

function seedSession(
  db: ReturnType<typeof openMemoryDb>,
  id: string,
  occurredAt: string,
) {
  db.insert(schema.sessions)
    .values({
      id,
      title: id,
      occurredAt,
      source: "chatgpt",
      category: "制作",
      rawContent: "x",
      status: "parsed",
      sourceConversationId: null,
      importSource: "manual",
      sourceStartAt: null,
      sourceEndAt: null,
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
}

function seedMessage(
  db: ReturnType<typeof openMemoryDb>,
  input: {
    id: string;
    sessionId: string;
    role?: string;
    content?: string;
    index?: number;
  },
) {
  const content = input.content ?? "hello";
  db.insert(schema.messages)
    .values({
      id: input.id,
      sessionId: input.sessionId,
      index: input.index ?? 0,
      role: input.role ?? "user",
      content,
      charStart: 0,
      charEnd: content.length,
      sourceMessageId: null,
      sourceCreatedAt: "2019-01-01T00:00:00.000Z",
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

function seedProvenance(db: ReturnType<typeof openMemoryDb>) {
  seedSession(db, SESSION_A, "2099-01-01");
  seedSession(db, SESSION_B, "2099-01-02");
  seedMessage(db, {
    id: `${SESSION_A}-u`,
    sessionId: SESSION_A,
    content: USER_A,
    index: 0,
  });
  seedMessage(db, {
    id: `${SESSION_A}-a`,
    sessionId: SESSION_A,
    role: "assistant",
    content: ASSISTANT,
    index: 1,
  });
  seedMessage(db, {
    id: `${SESSION_B}-u`,
    sessionId: SESSION_B,
    content: USER_B,
    index: 0,
  });
  seedMessage(db, {
    id: `${SESSION_B}-a`,
    sessionId: SESSION_B,
    role: "assistant",
    content: ASSISTANT,
    index: 1,
  });
}

function preflight(
  db: ReturnType<typeof openMemoryDb>,
  overrides?: {
    candidateText?: string;
    assessmentText?: string;
    manifest?: ReturnType<typeof validatedManifest>;
  },
) {
  const manifest = overrides?.manifest ?? validatedManifest();
  const candidateText = overrides?.candidateText ?? JSON.stringify(v4LikeReport());
  const assessmentText =
    overrides?.assessmentText ?? JSON.stringify(assessmentReport());
  const before = {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
  };
  const result = runApplyPreflight({
    db,
    dbPath: ":memory:",
    manifestPath: "data/concept-admission-apply-manifest-v1.json",
    candidateReportPath: "data/concept-pilot-2b-v4.json",
    assessmentReportPath: "data/concept-admission-assessment-v2-gpt4o.json",
    candidateReportText: candidateText,
    assessmentReportText: assessmentText,
    manifest,
    now: () => "2026-08-22T12:00:00.000Z",
  });
  const after = {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
  };
  assert.deepEqual(after, before);
  return result;
}

test("empty Registry と valid provenance なら ready", () => {
  const db = openMemoryDb();
  seedProvenance(db);
  const result = preflight(db);
  assert.equal(result.status, "ready", JSON.stringify(result.blockers));
  assert.equal(result.manifestValid, true);
  assert.equal(result.sourceValidation.candidateHashValid, true);
  assert.equal(result.sourceValidation.assessmentHashValid, true);
  assert.equal(result.sourceValidation.manifestHashValid, true);
  assert.equal(result.registry.concepts, 0);
  assert.equal(result.predictedWrites.aliases, 0);
  assert.equal(result.predictedWrites.concepts, result.preview.length);
  assert.equal(
    result.predictedWrites.occurrences,
    result.preview.reduce((sum, item) => sum + item.occurrenceCount, 0),
  );
  assert.equal(result.provenance.unresolvedOccurrences, 0);
  const shared = result.preview.some((item) => item.candidateRef === "C20") &&
    result.preview.some((item) => item.candidateRef === "C42");
  assert.equal(shared, true);
});

test("artifact hash mismatch は blocked", () => {
  const db = openMemoryDb();
  seedProvenance(db);
  const candidate = preflight(db, {
    candidateText: JSON.stringify({ ...v4LikeReport(), extra: true }),
  });
  assert.equal(candidate.status, "blocked");
  assert.equal(candidate.sourceValidation.candidateHashValid, false);
  assert.equal(
    candidate.blockers.some((item) => item.code === "source_artifact_hash"),
    true,
  );

  const assessment = preflight(db, {
    assessmentText: JSON.stringify({ ...assessmentReport(), extra: true }),
  });
  assert.equal(assessment.status, "blocked");
  assert.equal(assessment.sourceValidation.assessmentHashValid, false);

  const mutated = structuredClone(validatedManifest());
  mutated.metadata.contentHash = "deadbeef";
  const manifest = preflight(db, { manifest: mutated });
  assert.equal(manifest.status, "blocked");
  assert.equal(manifest.sourceValidation.manifestHashValid, false);
});

test("Registry non-empty / normalizedKey conflict は blocked", () => {
  const conceptsDb = openMemoryDb();
  seedProvenance(conceptsDb);
  insertConcept(
    {
      id: "existing",
      canonicalLabel: "別物",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    conceptsDb,
  );
  const concepts = preflight(conceptsDb);
  assert.equal(concepts.status, "blocked");
  assert.equal(
    concepts.blockers.some((item) => item.code === "initial_registry_not_empty"),
    true,
  );

  const aliasDb = openMemoryDb();
  seedProvenance(aliasDb);
  insertConcept(
    {
      id: "c-alias",
      canonicalLabel: "距離感",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    aliasDb,
  );
  insertConceptAlias({ conceptId: "c-alias", aliasLabel: "対人距離" }, aliasDb);
  const aliases = preflight(aliasDb);
  assert.equal(aliases.status, "blocked");
  assert.equal(aliases.registry.aliases > 0, true);

  const occDb = openMemoryDb();
  seedProvenance(occDb);
  insertConcept(
    {
      id: "c-occ",
      canonicalLabel: "距離感",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    occDb,
  );
  insertConceptOccurrence(
    {
      id: "o1",
      conceptId: "c-occ",
      sessionId: SESSION_A,
      messageId: `${SESSION_A}-u`,
      evidenceRef: "M001:E01",
      occurredAt: "2026-07-15",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    occDb,
  );
  const occs = preflight(occDb);
  assert.equal(occs.status, "blocked");
  assert.equal(occs.registry.occurrences > 0, true);

  const conflictDb = openMemoryDb();
  seedProvenance(conflictDb);
  insertConcept(
    {
      id: "c-human",
      canonicalLabel: "人間関係",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    conflictDb,
  );
  const conflict = preflight(conflictDb);
  assert.equal(conflict.status, "blocked");
  assert.equal(
    conflict.blockers.some((item) => item.code === "normalized_key_conflict"),
    true,
  );
});

test("Provenance errors: missing session/message, mismatch, assistant, unresolved ref", () => {
  const missingSession = openMemoryDb();
  seedSession(missingSession, SESSION_A, "2026-07-15");
  seedMessage(missingSession, {
    id: `${SESSION_A}-u`,
    sessionId: SESSION_A,
    content: USER_A,
  });
  const noSession = preflight(missingSession);
  assert.equal(noSession.status, "blocked");
  assert.equal(
    noSession.provenance.errors.some((item) => item.errorCode === "missing_session"),
    true,
  );

  const missingMessage = openMemoryDb();
  seedProvenance(missingMessage);
  const mutated = structuredClone(validatedManifest());
  mutated.admittedCandidates[0]!.occurrences[0]!.messageId = "missing-message";
  const noMessage = preflight(missingMessage, { manifest: mutated });
  assert.equal(noMessage.status, "blocked");
  assert.equal(
    noMessage.provenance.errors.some((item) => item.errorCode === "missing_message"),
    true,
  );

  const mismatchDb = openMemoryDb();
  seedProvenance(mismatchDb);
  const mismatched = structuredClone(validatedManifest());
  mismatched.admittedCandidates[0]!.occurrences[0]!.messageId = `${SESSION_B}-u`;
  const sessionMismatch = preflight(mismatchDb, { manifest: mismatched });
  assert.equal(sessionMismatch.status, "blocked");
  assert.equal(
    sessionMismatch.provenance.errors.some(
      (item) => item.errorCode === "message_session_mismatch",
    ),
    true,
  );

  const assistantDb = openMemoryDb();
  seedProvenance(assistantDb);
  const assistantManifest = structuredClone(validatedManifest());
  assistantManifest.admittedCandidates[0]!.occurrences[0]!.messageId =
    `${SESSION_A}-a`;
  const assistant = preflight(assistantDb, { manifest: assistantManifest });
  assert.equal(assistant.status, "blocked");
  assert.equal(
    assistant.provenance.errors.some((item) => item.errorCode === "message_not_user"),
    true,
  );

  const unresolvedDb = openMemoryDb();
  seedProvenance(unresolvedDb);
  const unresolvedManifest = structuredClone(validatedManifest());
  unresolvedManifest.admittedCandidates[0]!.occurrences[0]!.evidenceRef =
    "M099:E01";
  const unresolved = preflight(unresolvedDb, { manifest: unresolvedManifest });
  assert.equal(unresolved.status, "blocked");
  assert.equal(
    unresolved.provenance.errors.some(
      (item) => item.errorCode === "evidence_ref_unresolved",
    ),
    true,
  );
});

test("same Candidate duplicate occurrence は blocked、異なる Candidate の共有は allowed", () => {
  const db = openMemoryDb();
  seedProvenance(db);
  const ok = preflight(db);
  assert.equal(ok.status, "ready");
  assert.ok(
    ok.preview.some((item) => item.candidateRef === "C20") &&
      ok.preview.some((item) => item.candidateRef === "C42"),
  );

  const dupDb = openMemoryDb();
  seedProvenance(dupDb);
  const duplicated = structuredClone(validatedManifest());
  duplicated.admittedCandidates[0]!.occurrences.push({
    ...duplicated.admittedCandidates[0]!.occurrences[0]!,
  });
  const dup = preflight(dupDb, { manifest: duplicated });
  assert.equal(dup.status, "blocked");
  assert.equal(
    dup.blockers.some((item) => item.code === "duplicate_occurrence"),
    true,
  );
});

test("Policy mismatch は blocked", () => {
  const db = openMemoryDb();
  seedProvenance(db);
  const mutated = structuredClone(validatedManifest());
  mutated.admittedCandidates[0]!.policyRuleId = "wrong_rule";
  const result = preflight(db, { manifest: mutated });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.blockers.some((item) => item.code === "policy_rule_mismatch"),
    true,
  );
});

test("CLI --apply reject と write import 禁止", () => {
  assert.equal(parseConceptAdmissionPreflightArgs(["--apply"]).apply, true);
  const result = runConceptAdmissionPreflight(["--apply"], {
    openDb: () => {
      throw new Error("should not open db");
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.code, "apply");
  assert.equal(result.error, CONCEPT_APPLY_APPLY_ERROR);

  const sources = [
    "lib/concepts/admission/apply-preflight.ts",
    "lib/concepts/admission/apply-preflight-pilot.ts",
    "scripts/concept-admission-preflight.ts",
  ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));
  for (const source of sources) {
    assert.doesNotMatch(source, /insertConcept/);
    assert.doesNotMatch(source, /insertConceptAlias/);
    assert.doesNotMatch(source, /insertConceptOccurrence/);
    assert.doesNotMatch(source, /applyInitialAdmissionManifest/);
    assert.doesNotMatch(source, /from "\.\/calibration"/);
    assert.doesNotMatch(source, /負の連鎖/);
  }

  const tx = readFileSync(
    resolve(process.cwd(), "lib/concepts/admission/apply-transaction.ts"),
    "utf8",
  );
  const inner = tx.indexOf("const run = sqlite.transaction");
  const innerGate = tx.indexOf("evaluateInitialRegistryGate", inner);
  assert.ok(inner >= 0 && innerGate > inner);
});
