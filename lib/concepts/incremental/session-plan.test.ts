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
} from "@/lib/db/concept-queries";
import * as schema from "@/lib/db/schema";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { stableIncrementalPlan } from "./plan";
import type { ConceptExtractUnit } from "@/lib/concepts/user-units";
import {
  ALL_ACTIONS_GROUNDING_REJECTED,
  planIncrementalSession,
  type IncrementalExtractedAction,
} from "./session-plan";

const HUMAN_ID = "concept-human-relations";
const AI_ID = "concept-high-perf-ai";
const SESSION_A = "session-a";
const SESSION_B = "session-b";
const USER_A =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const USER_B =
  "人間関係を最小限にする道を選びました。高性能AIについても触れます。";
const USER_MIXED =
  "人間関係と寂しさと統合支援ツールについて同じ文で考えています。";
const ASSISTANT = "了解しました。人間関係と高性能AIの両方を整理します。";

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
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
    sourceCreatedAt?: string | null;
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
      sourceCreatedAt: input.sourceCreatedAt ?? "2019-01-01T00:00:00.000Z",
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

function seedRegistry(db: ReturnType<typeof openMemoryDb>) {
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
}

function seedSessionA(
  db: ReturnType<typeof openMemoryDb>,
  content = USER_A,
  sourceCreatedAt = "2026-07-15T12:00:00.000Z",
) {
  seedSession(db, SESSION_A, "2099-01-01");
  seedMessage(db, {
    id: `${SESSION_A}-u`,
    sessionId: SESSION_A,
    content,
    index: 0,
    sourceCreatedAt,
  });
  seedMessage(db, {
    id: `${SESSION_A}-a`,
    sessionId: SESSION_A,
    role: "assistant",
    content: ASSISTANT,
    index: 1,
  });
}

function extract(
  actions: IncrementalExtractedAction[] | ((units: ConceptExtractUnit[]) => IncrementalExtractedAction[]),
) {
  return async (units: ConceptExtractUnit[]) =>
    typeof actions === "function" ? actions(units) : actions;
}

function counts(db: ReturnType<typeof openMemoryDb>) {
  return {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
    sessions: db.select().from(schema.sessions).all().length,
    messages: db.select().from(schema.messages).all().length,
  };
}

test("A. Session → exact existing match、write 0", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db);
  const before = counts(db);
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) => [
      {
        action: "new",
        evidenceRef: units[0]!.evidenceRef,
        surfaceForm: "人間関係",
      },
    ]),
  });
  assert.equal(result.status, "planned");
  if (result.status !== "planned") {
    return;
  }
  assert.equal(result.existingMatches, 1);
  assert.equal(result.newCandidates, 0);
  assert.equal(result.provisionalNewCandidates, 0);
  assert.equal(result.plans[0]?.kind, "existing_match");
  if (result.plans[0]?.kind === "existing_match") {
    assert.equal(result.plans[0].conceptId, HUMAN_ID);
    assert.equal(result.plans[0].provenance.sessionId, SESSION_A);
    assert.equal(result.plans[0].provenance.messageId, `${SESSION_A}-u`);
    assert.equal(result.plans[0].provenance.evidenceRef, "M001:E01");
    assert.equal(result.plans[0].provenance.sourceRole, "user");
    assert.equal(result.plans[0].provenance.sourceType, "evidence_unit");
    assert.equal(
      result.plans[0].provenance.extractionVersion,
      CONCEPT_EXTRACTION_VERSION,
    );
  }
  assert.deepEqual(counts(db), before);
});

test("B. Session → NEW は blocked にしない", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db);
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) => [
      {
        action: "new",
        evidenceRef: units[0]!.evidenceRef,
        surfaceForm: "理解できない",
      },
    ]),
  });
  assert.equal(result.status, "planned");
  if (result.status !== "planned") {
    return;
  }
  assert.equal(result.newCandidates, 1);
  assert.equal(result.existingMatches, 0);
  assert.equal(result.plans[0]?.kind, "new");
});

test("C. Session → semantic provisional は既存 Concept へ attach しない", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db, USER_MIXED);
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) => [
      {
        action: "match",
        evidenceRef: units[0]!.evidenceRef,
        surfaceForm: "寂しさ",
        existingConceptRef: HUMAN_ID,
      },
    ]),
  });
  assert.equal(result.status, "planned");
  if (result.status !== "planned") {
    return;
  }
  assert.equal(result.provisionalNewCandidates, 1);
  assert.equal(result.existingMatches, 0);
  assert.equal(result.plans[0]?.kind, "provisional_new");
  if (result.plans[0]?.kind === "provisional_new") {
    assert.equal(result.plans[0].canonicalLabel, "寂しさ");
    assert.equal(result.plans[0].provisionalConceptId, HUMAN_ID);
  }
});

test("D. mixed: existing_match + new + provisional_new", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db, USER_MIXED);
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) => {
      const evidenceRef = units[0]!.evidenceRef;
      return [
        { action: "new", evidenceRef, surfaceForm: "人間関係" },
        { action: "new", evidenceRef, surfaceForm: "統合支援ツール" },
        {
          action: "match",
          evidenceRef,
          surfaceForm: "寂しさ",
          existingConceptRef: HUMAN_ID,
        },
      ];
    }),
  });
  assert.equal(result.status, "planned");
  if (result.status !== "planned") {
    return;
  }
  assert.equal(result.existingMatches, 1);
  assert.equal(result.newCandidates, 1);
  assert.equal(result.provisionalNewCandidates, 1);
  assert.equal(result.groundedCandidates, 3);
  assert.equal(result.groundedActions, 3);
  assert.equal(result.groundingRejectedCount, 0);
  assert.equal(result.groundingRejections.length, 0);
  assert.equal(result.adapterActions, 3);
  assert.equal(result.actionsEnteringGrounding, 3);
  assert.equal("groundingFailure" in result, false);
  assert.deepEqual(
    result.plans.map((item) => item.kind).sort(),
    ["existing_match", "new", "provisional_new"],
  );
});

test("E. 同一 Evidence の複数 Candidate は collapse しない", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db, USER_B);
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) => {
      const evidenceRef = units[0]!.evidenceRef;
      return [
        { action: "new", evidenceRef, surfaceForm: "人間関係" },
        { action: "new", evidenceRef, surfaceForm: "高性能AI" },
      ];
    }),
  });
  assert.equal(result.status, "planned");
  if (result.status !== "planned") {
    return;
  }
  assert.equal(result.plans.length, 2);
  assert.equal(
    result.plans[0]?.provenance.evidenceRef,
    result.plans[1]?.provenance.evidenceRef,
  );
  assert.equal(result.plans[0]?.kind, "existing_match");
  assert.equal(result.plans[1]?.kind, "existing_match");
  if (
    result.plans[0]?.kind === "existing_match" &&
    result.plans[1]?.kind === "existing_match"
  ) {
    assert.notEqual(result.plans[0].conceptId, result.plans[1].conceptId);
  }
});

test("F. 複数 USER Evidence を順序どおり Extractor へ渡す", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSession(db, SESSION_A, "2099-01-01");
  seedMessage(db, {
    id: `${SESSION_A}-u1`,
    sessionId: SESSION_A,
    content: USER_A,
    index: 0,
  });
  seedMessage(db, {
    id: `${SESSION_A}-u2`,
    sessionId: SESSION_A,
    content: USER_B,
    index: 1,
  });
  let seen: string[] = [];
  await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: async (units) => {
      seen = units.map((item) => item.evidenceRef);
      return [
        {
          action: "new",
          evidenceRef: units[0]!.evidenceRef,
          surfaceForm: "人間関係",
        },
      ];
    },
  });
  assert.deepEqual(seen, ["M001:E01", "M002:E01"]);
});

test("G. assistant Evidence は Extractor input に入らない", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db);
  let received: ConceptExtractUnit[] = [];
  await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: async (units) => {
      received = units;
      return [
        {
          action: "new",
          evidenceRef: units[0]!.evidenceRef,
          surfaceForm: "人間関係",
        },
      ];
    },
  });
  assert.equal(received.length > 0, true);
  assert.equal(
    received.every((item) => item.messageId === `${SESSION_A}-u`),
    true,
  );
  assert.equal(
    received.some((item) => item.text.includes("了解しました")),
    false,
  );
});

test("H. invalid grounding は blocked", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db);
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) => [
      {
        action: "new",
        evidenceRef: units[0]!.evidenceRef,
        surfaceForm: "存在しない表層",
      },
    ]),
  });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.code, ALL_ACTIONS_GROUNDING_REJECTED);
    assert.equal(result.adapterActions, 1);
    assert.equal(result.actionsEnteringGrounding, 1);
    assert.equal(result.groundedActions, 0);
    assert.equal(result.groundedCandidates, 0);
    assert.equal(result.groundingRejectedCount, 1);
    assert.equal(result.groundingRejections.length, 1);
    assert.equal(result.groundingFailure?.code, "surface_not_in_unit");
    assert.equal(result.groundingFailure?.exactMatch, false);
    assert.equal(result.detail.includes("存在しない"), false);
    assert.equal(
      JSON.stringify(result.groundingFailure ?? {}).includes("存在しない表層"),
      false,
    );
  }
});

test("I. cross-session provenance は blocked", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db);
  seedSession(db, SESSION_B, "2099-01-02");
  seedMessage(db, {
    id: `${SESSION_B}-u`,
    sessionId: SESSION_B,
    content: USER_B,
    index: 0,
  });
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) => [
      {
        action: "new",
        evidenceRef: units[0]!.evidenceRef,
        surfaceForm: "人間関係",
        sessionId: SESSION_B,
      },
    ]),
  });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.code, "cross_session_provenance");
  }
});

test("J. invalid messageId / evidenceRef は blocked", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db);
  const badRef = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract([
      {
        action: "new",
        evidenceRef: "M999:E01",
        surfaceForm: "人間関係",
      },
    ]),
  });
  assert.equal(badRef.status, "blocked");
  if (badRef.status === "blocked") {
    assert.equal(badRef.code, "ref_not_in_batch");
  }

  const badMessage = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) => [
      {
        action: "new",
        evidenceRef: units[0]!.evidenceRef,
        surfaceForm: "人間関係",
        messageId: "not-this-message",
      },
    ]),
  });
  assert.equal(badMessage.status, "blocked");
  if (badMessage.status === "blocked") {
    assert.equal(badMessage.code, "evidence_message_mismatch");
  }
});

test("K. occurredAt は Evidence 由来を保持し Session.occurredAt へ置換しない", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db, USER_A, "2026-07-15T12:00:00.000Z");
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) => [
      {
        action: "new",
        evidenceRef: units[0]!.evidenceRef,
        surfaceForm: "人間関係",
      },
    ]),
  });
  assert.equal(result.status, "planned");
  if (result.status !== "planned") {
    return;
  }
  assert.equal(result.plans[0]?.provenance.occurredAt, "2026-07-15T12:00:00.000Z");
  assert.equal(result.plans[0]?.provenance.occurredAt === "2099-01-01", false);
});

test("L. empty USER Evidence は no_op", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSession(db, SESSION_A, "2099-01-01");
  seedMessage(db, {
    id: `${SESSION_A}-a`,
    sessionId: SESSION_A,
    role: "assistant",
    content: ASSISTANT,
    index: 0,
  });
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: async () => {
      throw new Error("extractor should not run");
    },
  });
  assert.equal(result.status, "no_op");
  if (result.status === "no_op") {
    assert.equal(result.userEvidenceUnits, 0);
    assert.equal(result.plans.length, 0);
  }
});

test("M. USER Evidence あり Extractor 0件 は no_op", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db);
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract([]),
  });
  assert.equal(result.status, "no_op");
});

test("N. 同じ fixture + fake extractor なら Plan は決定論的", async () => {
  const extractor = extract((units) => [
    {
      action: "new",
      evidenceRef: units[0]!.evidenceRef,
      surfaceForm: "人間関係",
    },
    {
      action: "new",
      evidenceRef: units[0]!.evidenceRef,
      surfaceForm: "理解できない",
    },
  ]);
  const firstDb = openMemoryDb();
  seedRegistry(firstDb);
  seedSessionA(firstDb);
  const first = await planIncrementalSession({
    sessionId: SESSION_A,
    db: firstDb,
    extractCandidates: extractor,
  });
  const secondDb = openMemoryDb();
  seedRegistry(secondDb);
  seedSessionA(secondDb);
  const second = await planIncrementalSession({
    sessionId: SESSION_A,
    db: secondDb,
    extractCandidates: extractor,
  });
  assert.equal(first.status, "planned");
  assert.equal(second.status, "planned");
  if (first.status === "planned" && second.status === "planned") {
    assert.equal(stableIncrementalPlan({ plans: first.plans }), stableIncrementalPlan({ plans: second.plans }));
  }
});

test("O. orchestration 前後で DB counts 不変", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db);
  const before = counts(db);
  await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) => [
      {
        action: "new",
        evidenceRef: units[0]!.evidenceRef,
        surfaceForm: "人間関係",
      },
    ]),
  });
  assert.deepEqual(counts(db), before);
});

function mixedSurfaces(
  units: ConceptExtractUnit[],
  surfaces: string[],
): IncrementalExtractedAction[] {
  const evidenceRef = units[0]!.evidenceRef;
  return surfaces.map((surfaceForm) => ({
    action: "new" as const,
    evidenceRef,
    surfaceForm,
  }));
}

test("3C-3b1 A. all 4 valid actions pass grounding", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSession(db, SESSION_A, "2099-01-01");
  seedMessage(db, {
    id: `${SESSION_A}-u1`,
    sessionId: SESSION_A,
    content: USER_A,
    index: 0,
  });
  seedMessage(db, {
    id: `${SESSION_A}-u2`,
    sessionId: SESSION_A,
    content: USER_B,
    index: 1,
  });
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) => [
      {
        action: "new",
        evidenceRef: units[0]!.evidenceRef,
        surfaceForm: "人間関係",
      },
      {
        action: "new",
        evidenceRef: units[0]!.evidenceRef,
        surfaceForm: "理解できない",
      },
      {
        action: "new",
        evidenceRef: units[1]!.evidenceRef,
        surfaceForm: "人間関係",
      },
      {
        action: "new",
        evidenceRef: units[1]!.evidenceRef,
        surfaceForm: "高性能AI",
      },
    ]),
  });
  assert.equal(result.status, "planned");
  if (result.status !== "planned") {
    return;
  }
  assert.equal(result.adapterActions, 4);
  assert.equal(result.actionsEnteringGrounding, 4);
  assert.equal(result.groundedActions, 4);
  assert.equal(result.groundingRejectedCount, 0);
  assert.equal(result.plans.length, 4);
});

test("3C-3b1 B. one invalid among valid is rejected locally", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db, USER_MIXED);
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) =>
      mixedSurfaces(units, [
        "人間関係",
        "存在しない表層XYZ",
        "統合支援ツール",
        "同じ文",
      ]),
    ),
  });
  assert.equal(result.status, "planned");
  if (result.status !== "planned") {
    return;
  }
  assert.equal(result.actionsEnteringGrounding, 4);
  assert.equal(result.groundedActions, 3);
  assert.equal(result.groundingRejectedCount, 1);
  assert.equal(result.groundingRejections[0]?.actionIndex, 1);
  assert.equal(result.groundingRejections[0]?.code, "surface_not_in_unit");
  assert.equal(result.plans.length, 3);
  assert.equal(
    result.plans.some((plan) => plan.provenance.surfaceForm === "存在しない表層XYZ"),
    false,
  );
});

test("3C-3b1 C. first invalid still processes later valid actions", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db, USER_MIXED);
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) =>
      mixedSurfaces(units, ["存在しない先頭", "人間関係", "統合支援ツール"]),
    ),
  });
  assert.equal(result.status, "planned");
  if (result.status !== "planned") {
    return;
  }
  assert.equal(result.groundedActions, 2);
  assert.equal(result.groundingRejectedCount, 1);
  assert.equal(result.groundingRejections[0]?.actionIndex, 0);
  assert.equal(result.plans.length, 2);
});

test("3C-3b1 D. last invalid still keeps earlier valid actions", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db, USER_MIXED);
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) =>
      mixedSurfaces(units, ["人間関係", "統合支援ツール", "存在しない末尾"]),
    ),
  });
  assert.equal(result.status, "planned");
  if (result.status !== "planned") {
    return;
  }
  assert.equal(result.groundedActions, 2);
  assert.equal(result.groundingRejectedCount, 1);
  assert.equal(result.groundingRejections[0]?.actionIndex, 2);
});

test("3C-3b1 E. multiple invalids are rejected locally", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db, USER_MIXED);
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) =>
      mixedSurfaces(units, [
        "人間関係",
        "存在しないA",
        "統合支援ツール",
        "存在しないB",
      ]),
    ),
  });
  assert.equal(result.status, "planned");
  if (result.status !== "planned") {
    return;
  }
  assert.equal(result.groundedActions, 2);
  assert.equal(result.groundingRejectedCount, 2);
  assert.deepEqual(
    result.groundingRejections.map((item) => item.actionIndex),
    [1, 3],
  );
});

test("3C-3b1 F. all invalid → all_actions_grounding_rejected", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db, USER_MIXED);
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) =>
      mixedSurfaces(units, [
        "存在しない1",
        "存在しない2",
        "存在しない3",
        "存在しない4",
      ]),
    ),
  });
  assert.equal(result.status, "blocked");
  if (result.status !== "blocked") {
    return;
  }
  assert.equal(result.code, ALL_ACTIONS_GROUNDING_REJECTED);
  assert.equal(result.actionsEnteringGrounding, 4);
  assert.equal(result.groundedActions, 0);
  assert.equal(result.groundingRejectedCount, 4);
  assert.equal(result.groundingFailure?.code, "surface_not_in_unit");
});

test("3C-3b1 G. true zero extraction is no_op, not all grounding rejected", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db);
  const zero = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract([]),
  });
  assert.equal(zero.status, "no_op");
  if (zero.status === "no_op") {
    assert.equal(zero.actionsEnteringGrounding, 0);
    assert.equal(zero.groundedActions, 0);
    assert.equal(zero.groundingRejectedCount, 0);
  }

  const allRejected = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) =>
      mixedSurfaces(units, ["存在しない表層"]),
    ),
  });
  assert.equal(allRejected.status, "blocked");
  if (allRejected.status === "blocked") {
    assert.equal(allRejected.code, ALL_ACTIONS_GROUNDING_REJECTED);
    assert.equal(allRejected.actionsEnteringGrounding, 1);
  }
});

test("3C-3b1 H. transformation diagnostic true still rejects that action", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db, USER_MIXED);
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) =>
      mixedSurfaces(units, ["人間関係", "「寂しさ」", "統合支援ツール"]),
    ),
  });
  assert.equal(result.status, "planned");
  if (result.status !== "planned") {
    return;
  }
  assert.equal(result.groundedActions, 2);
  assert.equal(result.groundingRejectedCount, 1);
  assert.equal(
    result.groundingRejections[0]?.diagnosticMatches.outerQuoteStripped,
    true,
  );
  assert.equal(
    result.plans.some((plan) => plan.provenance.surfaceForm === "「寂しさ」"),
    false,
  );
  assert.equal(
    result.plans.some((plan) => plan.provenance.surfaceForm === "寂しさ"),
    false,
  );
});

test("3C-3b1 I. provenance failure still blocks the whole run", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db, USER_MIXED);
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) => [
      {
        action: "new",
        evidenceRef: units[0]!.evidenceRef,
        surfaceForm: "人間関係",
      },
      {
        action: "new",
        evidenceRef: "M999:E01",
        surfaceForm: "統合支援ツール",
      },
    ]),
  });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.code, "ref_not_in_batch");
    assert.equal(result.code === ALL_ACTIONS_GROUNDING_REJECTED, false);
  }
});

test("3C-3b1 J. semantic provisional stays provisional after selective reject", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db, USER_MIXED);
  const result = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) => {
      const evidenceRef = units[0]!.evidenceRef;
      return [
        { action: "new", evidenceRef, surfaceForm: "存在しない表層" },
        {
          action: "match",
          evidenceRef,
          surfaceForm: "寂しさ",
          existingConceptRef: HUMAN_ID,
        },
      ];
    }),
  });
  assert.equal(result.status, "planned");
  if (result.status !== "planned") {
    return;
  }
  assert.equal(result.groundingRejectedCount, 1);
  assert.equal(result.provisionalNewCandidates, 1);
  assert.equal(result.newCandidates, 0);
  assert.equal(result.plans[0]?.kind, "provisional_new");
});

test("invalid extractionVersion / sourceRole は blocked", async () => {
  const db = openMemoryDb();
  seedRegistry(db);
  seedSessionA(db);
  const badVersion = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) => [
      {
        action: "new",
        evidenceRef: units[0]!.evidenceRef,
        surfaceForm: "人間関係",
        extractionVersion: "concept-extraction-v0",
      },
    ]),
  });
  assert.equal(badVersion.status, "blocked");
  if (badVersion.status === "blocked") {
    assert.equal(badVersion.code, "invalid_extraction_version");
  }

  const badRole = await planIncrementalSession({
    sessionId: SESSION_A,
    db,
    extractCandidates: extract((units) => [
      {
        action: "new",
        evidenceRef: units[0]!.evidenceRef,
        surfaceForm: "人間関係",
        sourceRole: "assistant",
      },
    ]),
  });
  assert.equal(badRole.status, "blocked");
  if (badRole.status === "blocked") {
    assert.equal(badRole.code, "provenance_mismatch");
  }
});

test("missing Session は blocked", async () => {
  const db = openMemoryDb();
  const result = await planIncrementalSession({
    sessionId: "missing",
    db,
    extractCandidates: extract([]),
  });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.code, "missing_session");
  }
});

test("orchestrator は write / OpenAI / Initial Apply / append に接続しない", () => {
  const source = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/session-plan.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /applyExistingMatchOccurrences/);
  assert.doesNotMatch(source, /runExistingMatchOccurrenceAppend/);
  assert.doesNotMatch(source, /insertConcept/);
  assert.doesNotMatch(source, /getDb\(/);
  assert.doesNotMatch(source, /getAiProvider/);
  assert.doesNotMatch(source, /openai/);
  assert.doesNotMatch(source, /app\.db/);
  assert.doesNotMatch(source, /applyInitialAdmissionManifest/);
  assert.doesNotMatch(source, /負の連鎖/);
  assert.match(source, /resolveConceptActions/);
  assert.match(source, /planIncrementalConceptCandidates/);
    assert.match(source, /groundSurfaceForm/);
    assert.match(source, /ALL_ACTIONS_GROUNDING_REJECTED/);
    assert.doesNotMatch(source, /quoteExistsInContent/);
});
