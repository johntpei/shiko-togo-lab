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
import {
  applyExistingMatchOccurrences,
  readIncrementalRegistryCounts,
} from "./append";
import {
  runExistingMatchOccurrenceAppend,
  runExistingMatchOccurrencePreflight,
} from "./preflight";
import {
  planIncrementalConceptCandidates,
  type ExistingMatchPlan,
  type IncrementalGroundedCandidate,
} from "./plan";
import { loadConceptRegistrySnapshot } from "./registry";

const HUMAN_ID = "concept-human-relations";
const AI_ID = "concept-high-perf-ai";
const SESSION_A = "session-a";
const SESSION_B = "session-b";
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

function candidate(
  overrides: Partial<IncrementalGroundedCandidate> &
    Pick<IncrementalGroundedCandidate, "candidateRef" | "canonicalLabel" | "surfaceForm">,
): IncrementalGroundedCandidate {
  return {
    sessionId: SESSION_A,
    messageId: `${SESSION_A}-u`,
    evidenceRef: "M001:E01",
    occurredAt: "2026-07-15",
    sourceRole: "user",
    sourceType: "evidence_unit",
    extractionVersion: CONCEPT_EXTRACTION_VERSION,
    ...overrides,
  };
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
  const content = input.content ?? USER_A;
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

function seedBase(db: ReturnType<typeof openMemoryDb>) {
  insertConcept(
    {
      id: HUMAN_ID,
      canonicalLabel: "人間関係",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  insertConcept(
    {
      id: AI_ID,
      canonicalLabel: "高性能AI",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  insertConceptAlias({ conceptId: HUMAN_ID, aliasLabel: "対人関係" }, db);
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

function planExisting(
  db: ReturnType<typeof openMemoryDb>,
  input: IncrementalGroundedCandidate,
): ExistingMatchPlan {
  const result = planIncrementalConceptCandidates(
    [input],
    loadConceptRegistrySnapshot(db),
  );
  const plan = result.plans[0];
  assert.equal(plan?.kind, "existing_match", JSON.stringify(result.plans));
  if (plan?.kind !== "existing_match") {
    throw new Error("expected existing_match");
  }
  return plan;
}

function counts(db: ReturnType<typeof openMemoryDb>) {
  return readIncrementalRegistryCounts(db);
}

test("A. ready: insertable 1件、preflight write 0", () => {
  const db = openMemoryDb();
  seedBase(db);
  const before = counts(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  const result = runExistingMatchOccurrencePreflight([plan], { db });
  assert.equal(result.status, "ready");
  assert.equal(result.plansChecked, 1);
  assert.equal(result.predictedCreates, 1);
  assert.equal(result.alreadyPresent, 0);
  assert.equal(result.blockers.length, 0);
  assert.deepEqual(counts(db), before);
});

test("B. mixed ready: 1 insertable + 1 already_present", () => {
  const db = openMemoryDb();
  seedBase(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  const applied = applyExistingMatchOccurrences([plan], { db });
  assert.equal(applied.ok, true);
  const extra = planExisting(
    db,
    candidate({
      candidateRef: "C42",
      canonicalLabel: "高性能AI",
      surfaceForm: "高性能AI",
      sessionId: SESSION_B,
      messageId: `${SESSION_B}-u`,
      occurredAt: "2026-07-16",
    }),
  );
  const before = counts(db);
  const result = runExistingMatchOccurrencePreflight([plan, extra], { db });
  assert.equal(result.status, "ready");
  assert.equal(result.predictedCreates, 1);
  assert.equal(result.alreadyPresent, 1);
  assert.deepEqual(counts(db), before);
});

test("C. no_op: 全件 already_present", () => {
  const db = openMemoryDb();
  seedBase(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  assert.equal(applyExistingMatchOccurrences([plan], { db }).ok, true);
  const before = counts(db);
  const result = runExistingMatchOccurrencePreflight([plan], { db });
  assert.equal(result.status, "no_op");
  assert.equal(result.predictedCreates, 0);
  assert.equal(result.alreadyPresent, 1);
  assert.equal(result.blockers.length, 0);
  assert.deepEqual(counts(db), before);
});

test("D. blocked missing Concept", () => {
  const db = openMemoryDb();
  seedBase(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  const missing: ExistingMatchPlan = { ...plan, conceptId: "missing-concept" };
  const result = runExistingMatchOccurrencePreflight([missing], { db });
  assert.equal(result.status, "blocked");
  assert.equal(result.blockers.some((item) => item.code === "missing_concept"), true);
  assert.equal(countConceptOccurrences(db), 0);
});

test("E. blocked Identity mismatch", () => {
  const db = openMemoryDb();
  seedBase(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  const mismatched: ExistingMatchPlan = {
    ...plan,
    canonicalLabel: "高性能AI",
    normalizedKey: "高性能ai",
  };
  const result = runExistingMatchOccurrencePreflight([mismatched], { db });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.blockers.some((item) => item.code === "identity_mismatch"),
    true,
  );
});

test("F. blocked invalid provenance", () => {
  const db = openMemoryDb();
  seedBase(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  const invalid: ExistingMatchPlan = {
    ...plan,
    provenance: { ...plan.provenance, sessionId: "missing-session" },
  };
  const result = runExistingMatchOccurrencePreflight([invalid], { db });
  assert.equal(result.status, "blocked");
  assert.equal(result.blockers.some((item) => item.code === "missing_session"), true);
});

test("G. blocked occurrence conflict", () => {
  const db = openMemoryDb();
  seedBase(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  insertConceptOccurrence(
    {
      id: "existing-occ",
      conceptId: plan.conceptId,
      sessionId: plan.provenance.sessionId,
      messageId: plan.provenance.messageId,
      evidenceRef: plan.provenance.evidenceRef,
      occurredAt: "2010-01-01",
      sourceRole: plan.provenance.sourceRole,
      sourceType: plan.provenance.sourceType,
      extractionVersion: plan.provenance.extractionVersion,
    },
    db,
  );
  const result = runExistingMatchOccurrencePreflight([plan], { db });
  assert.equal(result.status, "blocked");
  assert.equal(result.conflicts, 1);
  assert.equal(
    result.blockers.some((item) => item.code === "occurrence_conflict"),
    true,
  );
});

test("H. same Evidence / multiple Concepts は両方 insertable", () => {
  const db = openMemoryDb();
  seedBase(db);
  const human = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
      sessionId: SESSION_B,
      messageId: `${SESSION_B}-u`,
      occurredAt: "2026-07-16",
    }),
  );
  const ai = planExisting(
    db,
    candidate({
      candidateRef: "C42",
      canonicalLabel: "高性能AI",
      surfaceForm: "高性能AI",
      sessionId: SESSION_B,
      messageId: `${SESSION_B}-u`,
      occurredAt: "2026-07-16",
    }),
  );
  const result = runExistingMatchOccurrencePreflight([human, ai], { db });
  assert.equal(result.status, "ready");
  assert.equal(result.predictedCreates, 2);
  assert.equal(result.alreadyPresent, 0);
});

test("I. same-batch exact duplicate: preflight予測と execution が一致", () => {
  const db = openMemoryDb();
  seedBase(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  const preflight = runExistingMatchOccurrencePreflight([plan, plan], { db });
  assert.equal(preflight.status, "ready");
  assert.equal(preflight.predictedCreates, 1);
  assert.equal(preflight.alreadyPresent, 1);
  const executed = runExistingMatchOccurrenceAppend({
    plans: [plan, plan],
    db,
    apply: true,
  });
  assert.equal(executed.transactionStarted, true);
  assert.equal(executed.occurrencesCreated, preflight.predictedCreates);
  assert.equal(executed.alreadyPresent, preflight.alreadyPresent);
  assert.equal(executed.applyResult?.ok, true);
});

test("J. same-batch conflicting duplicate → blocked", () => {
  const db = openMemoryDb();
  seedBase(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  const conflicted: ExistingMatchPlan = {
    ...plan,
    provenance: { ...plan.provenance, occurredAt: "2026-07-16" },
  };
  const result = runExistingMatchOccurrencePreflight([plan, conflicted], { db });
  assert.equal(result.status, "blocked");
  assert.equal(result.conflicts, 1);
});

test("K. dry-run boundary: apply 未指定は preflight のみ / DB 不変", () => {
  const db = openMemoryDb();
  seedBase(db);
  const before = counts(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  const omitted = runExistingMatchOccurrenceAppend({ plans: [plan], db });
  assert.equal(omitted.applyRequested, false);
  assert.equal(omitted.transactionStarted, false);
  assert.equal(omitted.preflight.status, "ready");
  assert.deepEqual(counts(db), before);
  const explicitFalse = runExistingMatchOccurrenceAppend({
    plans: [plan],
    db,
    apply: false,
  });
  assert.equal(explicitFalse.transactionStarted, false);
  assert.deepEqual(counts(db), before);
});

test("L. explicit apply temp DB: created / alreadyPresent が preflight と一致", () => {
  const db = openMemoryDb();
  seedBase(db);
  const conceptsBefore = countConcepts(db);
  const aliasesBefore = countConceptAliases(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  const preflight = runExistingMatchOccurrencePreflight([plan], { db });
  const executed = runExistingMatchOccurrenceAppend({
    plans: [plan],
    db,
    apply: true,
  });
  assert.equal(preflight.status, "ready");
  assert.equal(executed.transactionStarted, true);
  assert.equal(executed.occurrencesCreated, preflight.predictedCreates);
  assert.equal(executed.alreadyPresent, preflight.alreadyPresent);
  assert.equal(countConcepts(db), conceptsBefore);
  assert.equal(countConceptAliases(db), aliasesBefore);
  assert.equal(countConceptOccurrences(db), 1);
});

test("M. blocked + apply=true は transaction 開始なし / write 0", () => {
  const db = openMemoryDb();
  seedBase(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  const missing: ExistingMatchPlan = { ...plan, conceptId: "missing-concept" };
  const before = counts(db);
  const executed = runExistingMatchOccurrenceAppend({
    plans: [missing],
    db,
    apply: true,
  });
  assert.equal(executed.preflight.status, "blocked");
  assert.equal(executed.transactionStarted, false);
  assert.equal(executed.applyResult, null);
  assert.deepEqual(counts(db), before);
});

test("N. no_op + apply=true は write transaction なし / rows 不変", () => {
  const db = openMemoryDb();
  seedBase(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  assert.equal(applyExistingMatchOccurrences([plan], { db }).ok, true);
  const before = counts(db);
  const executed = runExistingMatchOccurrenceAppend({
    plans: [plan],
    db,
    apply: true,
  });
  assert.equal(executed.preflight.status, "no_op");
  assert.equal(executed.transactionStarted, false);
  assert.equal(executed.occurrencesCreated, 0);
  assert.equal(executed.alreadyPresent, 1);
  assert.equal(executed.applyResult, null);
  assert.deepEqual(counts(db), before);
});

test("O. TOCTOU: preflight ready は authorization ではない", () => {
  const db = openMemoryDb();
  seedBase(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  const preflight = runExistingMatchOccurrencePreflight([plan], { db });
  assert.equal(preflight.status, "ready");
  insertConceptOccurrence(
    {
      id: "stale-occ",
      conceptId: plan.conceptId,
      sessionId: plan.provenance.sessionId,
      messageId: plan.provenance.messageId,
      evidenceRef: plan.provenance.evidenceRef,
      occurredAt: "2010-01-01",
      sourceRole: plan.provenance.sourceRole,
      sourceType: plan.provenance.sourceType,
      extractionVersion: plan.provenance.extractionVersion,
    },
    db,
  );
  const before = counts(db);
  const applied = applyExistingMatchOccurrences([plan], { db });
  assert.equal(applied.ok, false);
  if (!applied.ok) {
    assert.equal(applied.transactionCommitted, false);
    assert.equal(applied.code, "occurrence_conflict");
  }
  assert.deepEqual(counts(db), before);

  const runner = runExistingMatchOccurrenceAppend({
    plans: [plan],
    db,
    apply: true,
  });
  assert.equal(runner.preflight.status, "blocked");
  assert.equal(runner.transactionStarted, false);
  assert.deepEqual(counts(db), before);
});

test("P. preflight 前後で Registry counts 完全一致", () => {
  const db = openMemoryDb();
  seedBase(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  const before = counts(db);
  runExistingMatchOccurrencePreflight([plan], { db });
  assert.deepEqual(counts(db), before);
});

test("empty plans は no_op", () => {
  const db = openMemoryDb();
  seedBase(db);
  const result = runExistingMatchOccurrencePreflight([], { db });
  assert.equal(result.status, "no_op");
  assert.equal(result.plansChecked, 0);
  assert.equal(result.predictedCreates, 0);
  assert.equal(result.alreadyPresent, 0);
  assert.equal(result.conflicts, 0);
  assert.deepEqual(result.blockers, []);
});

test("preflight / validate は write function と real DB path を持たない", () => {
  const sources = [
    "lib/concepts/incremental/preflight.ts",
    "lib/concepts/incremental/validate.ts",
  ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));
  for (const source of sources) {
    assert.doesNotMatch(source, /insertConceptOccurrence/);
    assert.doesNotMatch(source, /insertConcept\(/);
    assert.doesNotMatch(source, /getDb\(/);
    assert.doesNotMatch(source, /app\.db/);
    assert.doesNotMatch(source, /openai/);
    assert.doesNotMatch(source, /applyInitialAdmissionManifest/);
    assert.doesNotMatch(source, /負の連鎖/);
  }
  const preflight = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/preflight.ts"),
    "utf8",
  );
  assert.match(preflight, /applyExistingMatchOccurrences/);
  assert.match(preflight, /apply !== true/);
});
