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

test("A. exact canonical existing match は Occurrence 1件を追加し Concept/Alias は不変", () => {
  const db = openMemoryDb();
  seedBase(db);
  const before = readIncrementalRegistryCounts(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  const result = applyExistingMatchOccurrences([plan], { db });
  assert.equal(result.ok, true, result.ok ? undefined : `${result.code}:${result.detail}`);
  if (!result.ok) {
    return;
  }
  assert.equal(result.transactionCommitted, true);
  assert.equal(result.occurrencesCreated, 1);
  assert.equal(result.alreadyPresent, 0);
  assert.equal(result.conflicts, 0);
  assert.equal(countConcepts(db), before.concepts);
  assert.equal(countConceptAliases(db), before.conceptAliases);
  assert.equal(countConceptOccurrences(db), before.conceptOccurrences + 1);
  const row = db.select().from(schema.conceptOccurrences).all()[0];
  assert.equal(row?.conceptId, HUMAN_ID);
  assert.equal(row?.occurredAt, "2026-07-15");
  assert.equal(row?.occurredAt === "2099-01-01", false);
  assert.equal(row?.sourceRole, "user");
  assert.equal(row?.sourceType, "evidence_unit");
});

test("B. unique alias existing match は正しい Concept へ Occurrence を追加する", () => {
  const db = openMemoryDb();
  seedBase(db);
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20a",
      canonicalLabel: "対人関係",
      surfaceForm: "対人関係",
    }),
  );
  assert.equal(plan.matchReason, "unique_observed_alias");
  const result = applyExistingMatchOccurrences([plan], { db });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.occurrencesCreated, 1);
  const row = db.select().from(schema.conceptOccurrences).all()[0];
  assert.equal(row?.conceptId, HUMAN_ID);
});

test("C. exact rerun は already_present で row を増やさない", () => {
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
  const first = applyExistingMatchOccurrences([plan], { db });
  assert.equal(first.ok, true);
  const afterFirst = countConceptOccurrences(db);
  const second = applyExistingMatchOccurrences([plan], { db });
  assert.equal(second.ok, true);
  if (!second.ok) {
    return;
  }
  assert.equal(second.occurrencesCreated, 0);
  assert.equal(second.alreadyPresent, 1);
  assert.equal(countConceptOccurrences(db), afterFirst);
});

test("D. same batch duplicate は二重 insert せず created=1 / alreadyPresent=1", () => {
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
  const result = applyExistingMatchOccurrences([plan, plan], { db });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.occurrencesCreated, 1);
  assert.equal(result.alreadyPresent, 1);
  assert.equal(countConceptOccurrences(db), 1);
});

test("E. same Evidence / multiple Concepts は両方合法", () => {
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
  const result = applyExistingMatchOccurrences([human, ai], { db });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.occurrencesCreated, 2);
  assert.equal(countConceptOccurrences(db), 2);
  const conceptIds = new Set(
    db.select().from(schema.conceptOccurrences).all().map((item) => item.conceptId),
  );
  assert.deepEqual(conceptIds, new Set([HUMAN_ID, AI_ID]));
});

test("F. missing Concept は rollback し Occurrence = 0", () => {
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
  const missing: ExistingMatchPlan = {
    ...plan,
    conceptId: "missing-concept",
  };
  const result = applyExistingMatchOccurrences([missing], { db });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.transactionCommitted, false);
  assert.equal(result.code, "missing_concept");
  assert.equal(countConceptOccurrences(db), 0);
});

test("G. Concept identity mismatch は rollback", () => {
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
    normalizedKey: "高性能ai",
    canonicalLabel: "高性能AI",
  };
  const result = applyExistingMatchOccurrences([mismatched], { db });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "identity_mismatch");
  }
  assert.equal(countConceptOccurrences(db), 0);
});

test("H. missing Session は rollback", () => {
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
  const missing: ExistingMatchPlan = {
    ...plan,
    provenance: { ...plan.provenance, sessionId: "missing-session" },
  };
  const result = applyExistingMatchOccurrences([missing], { db });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "missing_session");
  }
  assert.equal(countConceptOccurrences(db), 0);
});

test("I. missing Message は rollback", () => {
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
  const missing: ExistingMatchPlan = {
    ...plan,
    provenance: { ...plan.provenance, messageId: "missing-message" },
  };
  const result = applyExistingMatchOccurrences([missing], { db });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "missing_message");
  }
  assert.equal(countConceptOccurrences(db), 0);
});

test("J. non-user provenance は reject / rollback", () => {
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
  const role: ExistingMatchPlan = {
    ...plan,
    provenance: {
      ...plan.provenance,
      sourceRole: "assistant" as ExistingMatchPlan["provenance"]["sourceRole"],
    },
  };
  const roleResult = applyExistingMatchOccurrences([role], { db });
  assert.equal(roleResult.ok, false);
  if (!roleResult.ok) {
    assert.equal(roleResult.code, "non_user_source_role");
  }

  const assistant: ExistingMatchPlan = {
    ...plan,
    provenance: { ...plan.provenance, messageId: `${SESSION_A}-a` },
  };
  const assistantResult = applyExistingMatchOccurrences([assistant], { db });
  assert.equal(assistantResult.ok, false);
  if (!assistantResult.ok) {
    assert.equal(assistantResult.code, "message_not_user");
  }
  assert.equal(countConceptOccurrences(db), 0);
});

test("K. identity 一致で immutable provenance が違う既存 row は conflict / rollback", () => {
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
  const before = countConceptOccurrences(db);
  const result = applyExistingMatchOccurrences([plan], { db });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "occurrence_conflict");
    assert.equal(result.conflicts, 1);
    assert.equal(result.transactionCommitted, false);
  }
  assert.equal(countConceptOccurrences(db), before);
  const row = db.select().from(schema.conceptOccurrences).get();
  assert.equal(row?.occurredAt, "2010-01-01");
});

test("L. mixed success + failure は全体 rollback", () => {
  const db = openMemoryDb();
  seedBase(db);
  const human = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
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
  const missing: ExistingMatchPlan = {
    ...human,
    candidateRef: "C99",
    conceptId: "missing-concept",
  };
  const result = applyExistingMatchOccurrences([human, ai, missing], { db });
  assert.equal(result.ok, false);
  assert.equal(countConceptOccurrences(db), 0);
  assert.equal(countConcepts(db), 2);
});

test("M. Concept / Alias count は append 前後で不変", () => {
  const db = openMemoryDb();
  seedBase(db);
  const before = {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
  };
  const plan = planExisting(
    db,
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
  );
  applyExistingMatchOccurrences([plan], { db });
  assert.equal(countConcepts(db), before.concepts);
  assert.equal(countConceptAliases(db), before.aliases);
});

test("N. 同じ DB state + 同じ input なら result は決定論的", () => {
  const input = candidate({
    candidateRef: "C20",
    canonicalLabel: "人間関係",
    surfaceForm: "人間関係",
  });
  const firstDb = openMemoryDb();
  seedBase(firstDb);
  const firstPlan = planExisting(firstDb, input);
  const first = applyExistingMatchOccurrences([firstPlan], { db: firstDb });

  const secondDb = openMemoryDb();
  seedBase(secondDb);
  const secondPlan = planExisting(secondDb, input);
  const second = applyExistingMatchOccurrences([secondPlan], { db: secondDb });
  assert.deepEqual(first, second);

  const rerun = applyExistingMatchOccurrences([firstPlan], { db: firstDb });
  const rerunAgain = applyExistingMatchOccurrences([firstPlan], { db: firstDb });
  assert.deepEqual(rerun, rerunAgain);
  if (rerun.ok && rerunAgain.ok) {
    assert.equal(rerun.alreadyPresent, 1);
    assert.equal(rerun.occurrencesCreated, 0);
  }
});

test("mixed new/provisional plan は暗黙 skip せず reject", () => {
  const db = openMemoryDb();
  seedBase(db);
  const smuggled = {
    kind: "new",
    candidateRef: "C38",
    canonicalLabel: "寂しさ",
    normalizedKey: "寂しさ",
    matchReason: "exact_canonical",
    conceptId: HUMAN_ID,
    provenance: candidate({
      candidateRef: "C38",
      canonicalLabel: "寂しさ",
      surfaceForm: "寂しさ",
    }),
  } as unknown as ExistingMatchPlan;
  const result = applyExistingMatchOccurrences([smuggled], { db });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "unsupported_plan_kind");
  }
  assert.equal(countConceptOccurrences(db), 0);
});

test("append は getDb / insertConcept / alias / Initial Apply / LLM に依存しない", () => {
  const source = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/append.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /getDb\(/);
  assert.doesNotMatch(source, /insertConcept\(/);
  assert.doesNotMatch(source, /insertConceptAlias/);
  assert.doesNotMatch(source, /applyInitialAdmissionManifest/);
  assert.doesNotMatch(source, /evaluateInitialRegistryGate/);
  assert.doesNotMatch(source, /openai/);
  assert.doesNotMatch(source, /from "\.\.\/admission\/calibration"/);
  assert.doesNotMatch(source, /負の連鎖/);
  assert.doesNotMatch(source, /app\.db/);
  assert.match(source, /insertConceptOccurrence/);
});
