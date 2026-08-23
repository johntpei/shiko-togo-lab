import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { normalizeConceptKey } from "@/lib/concepts/normalize";
import { applySqlMigrations } from "@/lib/db/client";
import { insertConcept, insertConceptOccurrence } from "@/lib/db/concept-queries";
import * as schema from "@/lib/db/schema";
import { verifyPreparedIncrementalNewAdmissionAlreadyApplied } from "./new-admission-exact-recovery";
import type { IncrementalNewAdmissionManifest } from "./new-admission-manifest";
import { CONCEPT_INCREMENTAL_NEW_ADMISSION_MANIFEST_VERSION } from "./new-admission-manifest";

const SESSION = "session-exact";
const MESSAGE = `${SESSION}-u`;

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function seedSession(db: ReturnType<typeof openMemoryDb>) {
  db.insert(schema.sessions)
    .values({
      id: SESSION,
      title: SESSION,
      occurredAt: "2099-01-01",
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
  db.insert(schema.messages)
    .values({
      id: MESSAGE,
      sessionId: SESSION,
      index: 0,
      role: "user",
      content: "睡眠の質について考えた",
      charStart: 0,
      charEnd: 10,
      sourceMessageId: null,
      sourceCreatedAt: "2026-07-15T12:00:00.000Z",
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

function admittedManifest(): IncrementalNewAdmissionManifest {
  return {
    metadata: {
      version: CONCEPT_INCREMENTAL_NEW_ADMISSION_MANIFEST_VERSION,
      mode: "incremental_new",
      sessionId: SESSION,
      matchingVersion: "concept-matching-v1",
      admissionPolicyId: "named_or_high",
      admissionPolicyVersion: "concept-admission-policy-v1",
      source: {
        intentContentHash: "hash",
        extractPromptVersion: "concept-extract-v1",
        extractionVersion: CONCEPT_EXTRACTION_VERSION,
        coverageSourceHash: "cov",
        assessmentModel: "test",
        assessmentPromptVersion: "concept-admission-assessment-v1",
        assessmentVersion: "concept-admission-assessment-v2",
      },
      generatedAt: "2026-08-24T00:00:00.000Z",
      contentHash: "placeholder",
    },
    admittedCandidates: [
      {
        candidateRef: "c1",
        canonicalLabel: "睡眠の質",
        normalizedKey: normalizeConceptKey("睡眠の質"),
        provenance: {
          sessionId: SESSION,
          messageId: MESSAGE,
          evidenceRef: "M001:E01",
          sourceRole: "user",
          sourceType: "evidence_unit",
          extractionVersion: CONCEPT_EXTRACTION_VERSION,
          surfaceForm: "睡眠の質",
          occurredAt: "2026-07-15T12:00:00.000Z",
        },
        assessment: {
          conceptForm: "specific_named_concept",
          evidenceRole: "central",
          longitudinalPotential: "high",
        },
        policy: {
          policyVersion: "concept-admission-policy-v1",
          policyRuleId: "named_or_high",
          reasonCode: "named_or_high_match",
        },
      },
    ],
    notAdmitted: [],
    aliasesToCreate: 0,
  };
}

test("N. exact Concept + exact Occurrence → alreadyAppliedExact true", () => {
  const db = openMemoryDb();
  seedSession(db);
  insertConcept(
    {
      id: "concept-sleep",
      canonicalLabel: "睡眠の質",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  insertConceptOccurrence(
    {
      id: "occ-sleep",
      conceptId: "concept-sleep",
      sessionId: SESSION,
      messageId: MESSAGE,
      evidenceRef: "M001:E01",
      occurredAt: "2026-07-15T12:00:00.000Z",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  const result = verifyPreparedIncrementalNewAdmissionAlreadyApplied(
    admittedManifest(),
    db,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.alreadyAppliedExact, true);
  }
});

test("O. same normalizedKey / wrong messageId provenance → false", () => {
  const db = openMemoryDb();
  seedSession(db);
  db.insert(schema.messages)
    .values({
      id: `${SESSION}-other`,
      sessionId: SESSION,
      index: 1,
      role: "user",
      content: "other",
      charStart: 0,
      charEnd: 5,
      sourceMessageId: null,
      sourceCreatedAt: "2026-07-15T12:00:00.000Z",
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
  insertConcept(
    {
      id: "concept-sleep",
      canonicalLabel: "睡眠の質",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  insertConceptOccurrence(
    {
      id: "occ-sleep",
      conceptId: "concept-sleep",
      sessionId: SESSION,
      messageId: `${SESSION}-other`,
      evidenceRef: "M001:E01",
      occurredAt: "2026-07-15T12:00:00.000Z",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  const result = verifyPreparedIncrementalNewAdmissionAlreadyApplied(
    admittedManifest(),
    db,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.alreadyAppliedExact, false);
  }
});

test("P. different Session → false", () => {
  const db = openMemoryDb();
  seedSession(db);
  db.insert(schema.sessions)
    .values({
      id: "other-session",
      title: "other",
      occurredAt: "2099-01-01",
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
  insertConcept(
    {
      id: "concept-sleep",
      canonicalLabel: "睡眠の質",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  insertConceptOccurrence(
    {
      id: "occ-sleep",
      conceptId: "concept-sleep",
      sessionId: "other-session",
      messageId: MESSAGE,
      evidenceRef: "M001:E01",
      occurredAt: "2026-07-15T12:00:00.000Z",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  const result = verifyPreparedIncrementalNewAdmissionAlreadyApplied(
    admittedManifest(),
    db,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.alreadyAppliedExact, false);
  }
});

test("Q. different evidenceRef → false", () => {
  const db = openMemoryDb();
  seedSession(db);
  insertConcept(
    {
      id: "concept-sleep",
      canonicalLabel: "睡眠の質",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  insertConceptOccurrence(
    {
      id: "occ-sleep",
      conceptId: "concept-sleep",
      sessionId: SESSION,
      messageId: MESSAGE,
      evidenceRef: "M001:E02",
      occurredAt: "2026-07-15T12:00:00.000Z",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  const result = verifyPreparedIncrementalNewAdmissionAlreadyApplied(
    admittedManifest(),
    db,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.alreadyAppliedExact, false);
  }
});

test("R. multiple admitted NEW — all exact only success", () => {
  const db = openMemoryDb();
  seedSession(db);
  const manifest = admittedManifest();
  manifest.admittedCandidates.push({
    ...manifest.admittedCandidates[0]!,
    candidateRef: "c2",
    canonicalLabel: "統合支援ツール",
    normalizedKey: normalizeConceptKey("統合支援ツール"),
    provenance: {
      ...manifest.admittedCandidates[0]!.provenance,
      surfaceForm: "統合支援ツール",
    },
  });
  insertConcept(
    {
      id: "concept-sleep",
      canonicalLabel: "睡眠の質",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  insertConceptOccurrence(
    {
      id: "occ-sleep",
      conceptId: "concept-sleep",
      sessionId: SESSION,
      messageId: MESSAGE,
      evidenceRef: "M001:E01",
      occurredAt: "2026-07-15T12:00:00.000Z",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  const partial = verifyPreparedIncrementalNewAdmissionAlreadyApplied(
    manifest,
    db,
  );
  assert.equal(partial.ok, false);
  if (!partial.ok) {
    assert.equal(partial.code, "partial_new_recovery_mismatch");
  }

  insertConcept(
    {
      id: "concept-tool",
      canonicalLabel: "統合支援ツール",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  insertConceptOccurrence(
    {
      id: "occ-tool",
      conceptId: "concept-tool",
      sessionId: SESSION,
      messageId: MESSAGE,
      evidenceRef: "M001:E01",
      occurredAt: "2026-07-15T12:00:00.000Z",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  const full = verifyPreparedIncrementalNewAdmissionAlreadyApplied(manifest, db);
  assert.equal(full.ok, true);
  if (full.ok) {
    assert.equal(full.alreadyAppliedExact, true);
  }
});
