import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { applySqlMigrations, getDbPath } from "@/lib/db/client";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  insertConcept,
  listConcepts,
} from "@/lib/db/concept-queries";
import * as schema from "@/lib/db/schema";
import { CONCEPT_EXTRACTION_VERSION, CONCEPT_MATCHING_VERSION } from "@/lib/concepts/types";
import { buildApplyManifest } from "./apply-manifest";
import {
  CONCEPT_APPLY_DRY_RUN_REFUSES_APPLY,
  parseConceptAdmissionApplyArgs,
  runConceptAdmissionApply,
} from "./apply-pilot";
import {
  applyInitialAdmissionManifest,
  evaluateInitialRegistryGate,
} from "./apply-transaction";
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
  input: { id: string; sessionId: string; index?: number },
) {
  db.insert(schema.messages)
    .values({
      id: input.id,
      sessionId: input.sessionId,
      index: input.index ?? 0,
      role: "user",
      content: "hello",
      charStart: 0,
      charEnd: 5,
      sourceMessageId: null,
      sourceCreatedAt: "2019-01-01T00:00:00.000Z",
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

function seedProvenance(
  db: ReturnType<typeof openMemoryDb>,
  sessionOccurredAt?: { a?: string; b?: string },
) {
  seedSession(db, SESSION_A, sessionOccurredAt?.a ?? "2026-07-15");
  seedSession(db, SESSION_B, sessionOccurredAt?.b ?? "2026-07-16");
  seedMessage(db, { id: `${SESSION_A}-u`, sessionId: SESSION_A, index: 0 });
  seedMessage(db, { id: `${SESSION_A}-a`, sessionId: SESSION_A, index: 1 });
  seedMessage(db, { id: `${SESSION_B}-u`, sessionId: SESSION_B, index: 0 });
  seedMessage(db, { id: `${SESSION_B}-a`, sessionId: SESSION_B, index: 1 });
}

test("empty Registry gate は concepts/aliases/occurrences が 0 のときだけ通る", () => {
  const db = openMemoryDb();
  assert.equal(evaluateInitialRegistryGate(db).ok, true);
  insertConcept(
    {
      id: "existing",
      canonicalLabel: "既存",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  assert.equal(evaluateInitialRegistryGate(db).ok, false);
});

test("temp SQLite へ Initial Apply すると Concept / Occurrence が入り alias は 0", () => {
  const db = openMemoryDb();
  seedProvenance(db);
  const manifest = validatedManifest();
  const result = applyInitialAdmissionManifest(manifest, {
    db,
    now: () => "2026-08-22T12:00:00.000Z",
    createConceptId: (() => {
      let n = 0;
      return () => {
        n += 1;
        return `concept-${n}`;
      };
    })(),
  });
  assert.equal(result.ok, true, result.ok ? undefined : `${result.code}:${result.detail}`);
  if (!result.ok) {
    return;
  }
  assert.equal(result.transactionCommitted, true);
  assert.equal(result.aliasesCreated, 0);
  assert.equal(result.conceptsCreated, manifest.admittedCandidates.length);
  assert.equal(
    result.occurrencesCreated,
    manifest.admittedCandidates.reduce((sum, item) => sum + item.occurrences.length, 0),
  );
  assert.equal(countConcepts(db), result.conceptsCreated);
  assert.equal(countConceptOccurrences(db), result.occurrencesCreated);
  assert.equal(countConceptAliases(db), 0);
  assert.equal(getDbPath().endsWith("data/app.db"), true);

  const human = result.mapping.find((item) => item.candidateRef === "C20");
  assert.ok(human);
  const stored = listConcepts(db);
  const humanRow = stored.find((item) => item.id === human?.conceptId);
  assert.equal(humanRow?.canonicalLabel, "人間関係");
  assert.equal(humanRow?.normalizedKey, "人間関係");
  assert.equal(humanRow?.matchingVersion, CONCEPT_MATCHING_VERSION);

  const occs = db.select().from(schema.conceptOccurrences).all();
  const humanOccs = occs.filter((item) => item.conceptId === human?.conceptId);
  assert.equal(humanOccs.length, 2);
  assert.deepEqual(
    new Set(humanOccs.map((item) => item.sessionId)),
    new Set([SESSION_A, SESSION_B]),
  );
  assert.equal(
    humanOccs.every((item) => item.extractionVersion === CONCEPT_EXTRACTION_VERSION),
    true,
  );
  assert.equal(
    humanOccs.every((item) => item.sourceRole === "user"),
    true,
  );
});

test("occurredAt は Manifest 値を保存し Session.occurredAt へ置き換えない", () => {
  const db = openMemoryDb();
  seedProvenance(db, { a: "2099-01-01", b: "2099-01-02" });
  const manifest = validatedManifest();
  const result = applyInitialAdmissionManifest(manifest, { db });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const occs = db.select().from(schema.conceptOccurrences).all();
  const dates = occs.map((item) => item.occurredAt).sort();
  assert.ok(dates.includes("2026-07-15"));
  assert.ok(dates.includes("2026-07-16"));
  assert.equal(dates.includes("2099-01-01"), false);
});

test("2回目の initial apply は non-empty gate で拒否し、件数を増やさない", () => {
  const db = openMemoryDb();
  seedProvenance(db);
  const manifest = validatedManifest();
  const first = applyInitialAdmissionManifest(manifest, { db });
  assert.equal(first.ok, true);
  if (!first.ok) {
    return;
  }
  const concepts = countConcepts(db);
  const occs = countConceptOccurrences(db);
  const second = applyInitialAdmissionManifest(manifest, { db });
  assert.equal(second.ok, false);
  if (second.ok) {
    return;
  }
  assert.equal(second.transactionCommitted, false);
  assert.equal(second.code, "initial_registry_not_empty");
  assert.equal(countConcepts(db), concepts);
  assert.equal(countConceptOccurrences(db), occs);
  assert.equal(countConceptAliases(db), 0);
});

test("normalizedKey conflict は merge せず transaction rollback する", () => {
  const db = openMemoryDb();
  seedProvenance(db);
  const manifest = structuredClone(validatedManifest());
  const first = manifest.admittedCandidates[0]!;
  const second = structuredClone(first);
  second.candidateRef = "C99";
  manifest.admittedCandidates.push(second);
  const result = applyInitialAdmissionManifest(manifest, { db });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.transactionCommitted, false);
  assert.equal(result.code, "normalized_key_conflict");
  assert.equal(countConcepts(db), 0);
  assert.equal(countConceptOccurrences(db), 0);
  assert.equal(countConceptAliases(db), 0);
});

test("missing Session / Message は fail し Registry は空のまま", () => {
  const missingSession = openMemoryDb();
  seedSession(missingSession, SESSION_A, "2026-07-15");
  seedMessage(missingSession, { id: `${SESSION_A}-u`, sessionId: SESSION_A });
  const manifest = validatedManifest();
  const noSession = applyInitialAdmissionManifest(manifest, { db: missingSession });
  assert.equal(noSession.ok, false);
  if (!noSession.ok) {
    assert.equal(noSession.code, "missing_session");
  }
  assert.equal(countConcepts(missingSession), 0);

  const missingMessage = openMemoryDb();
  seedProvenance(missingMessage);
  const mutated = structuredClone(manifest);
  mutated.admittedCandidates[0]!.occurrences[0]!.messageId = "missing-message";
  const noMessage = applyInitialAdmissionManifest(mutated, { db: missingMessage });
  assert.equal(noMessage.ok, false);
  if (!noMessage.ok) {
    assert.equal(noMessage.code, "missing_message");
  }
  assert.equal(countConcepts(missingMessage), 0);
  assert.equal(countConceptOccurrences(missingMessage), 0);
});

test("異なる Candidate の同じ evidenceRef は許可し、同一 Candidate 重複は fail", () => {
  const db = openMemoryDb();
  seedProvenance(db);
  const manifest = validatedManifest();
  const shared = manifest.admittedCandidates.flatMap((item) =>
    item.occurrences.map((occ) => `${item.candidateRef}:${occ.sessionId}:${occ.evidenceRef}`),
  );
  assert.ok(
    shared.includes(`C20:${SESSION_B}:M001:E01`) &&
      shared.includes(`C42:${SESSION_B}:M001:E01`),
  );
  const ok = applyInitialAdmissionManifest(manifest, { db });
  assert.equal(ok.ok, true);

  const dupDb = openMemoryDb();
  seedProvenance(dupDb);
  const duplicated = structuredClone(manifest);
  duplicated.admittedCandidates[0]!.occurrences.push({
    ...duplicated.admittedCandidates[0]!.occurrences[0]!,
  });
  const dup = applyInitialAdmissionManifest(duplicated, { db: dupDb });
  assert.equal(dup.ok, false);
  if (!dup.ok) {
    assert.equal(dup.code, "duplicate_occurrence");
  }
  assert.equal(countConcepts(dupDb), 0);
});

test("dry-run runner は --apply を拒否し、apply-transaction を import しない", () => {
  assert.equal(parseConceptAdmissionApplyArgs(["--apply"]).apply, true);
  const result = runConceptAdmissionApply(["--apply"], {
    loadSession: () => {
      throw new Error("should not load");
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.code, "apply");
  assert.equal(result.error, CONCEPT_APPLY_DRY_RUN_REFUSES_APPLY);

  const dryRun = readFileSync(
    resolve(process.cwd(), "lib/concepts/admission/apply-pilot.ts"),
    "utf8",
  );
  assert.doesNotMatch(dryRun, /apply-transaction/);
  assert.doesNotMatch(dryRun, /applyInitialAdmissionManifest/);
  assert.doesNotMatch(dryRun, /insertConcept\(/);

  const cli = readFileSync(
    resolve(process.cwd(), "scripts/concept-admission-apply.ts"),
    "utf8",
  );
  assert.match(cli, /runConceptAdmissionApplyWrite/);
  assert.match(cli, /openWritableApplyDb/);
  assert.doesNotMatch(cli, /getDb\(/);

  const applySource = readFileSync(
    resolve(process.cwd(), "lib/concepts/admission/apply-transaction.ts"),
    "utf8",
  );
  assert.doesNotMatch(applySource, /getDb\(/);
  assert.doesNotMatch(applySource, /app\.db/);
  assert.doesNotMatch(applySource, /insertConceptAlias/);
  assert.doesNotMatch(applySource, /from "\.\/calibration"/);
  assert.doesNotMatch(applySource, /負の連鎖/);
});
