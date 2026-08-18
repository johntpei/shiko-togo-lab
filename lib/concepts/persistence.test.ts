import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { applySqlMigrations } from "@/lib/db/client";
import {
  countConceptOccurrences,
  countConcepts,
  insertConcept,
  insertConceptAlias,
  insertConceptOccurrence,
} from "@/lib/db/concept-queries";
import * as schema from "@/lib/db/schema";
import { CONCEPT_EXTRACTION_VERSION, CONCEPT_MATCHING_VERSION } from "./types";

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function seedSession(
  db: ReturnType<typeof openMemoryDb>,
  id: string,
  occurredAt = "2026-08-02",
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
  input: { id: string; sessionId: string; role?: string },
) {
  db.insert(schema.messages)
    .values({
      id: input.id,
      sessionId: input.sessionId,
      index: 0,
      role: input.role ?? "user",
      content: "hello",
      charStart: 0,
      charEnd: 5,
      sourceMessageId: null,
      sourceCreatedAt: "2026-08-02T03:04:05.000Z",
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

test("normalizedKey の重複は insert しない", () => {
  const db = openMemoryDb();
  const first = insertConcept(
    {
      id: "c1",
      canonicalLabel: "AI性能",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  const second = insertConcept(
    {
      id: "c2",
      canonicalLabel: "ai 性能",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  assert.equal(first.status, "inserted");
  assert.equal(second.status, "skipped");
  if (second.status === "skipped") {
    assert.equal(second.reason, "duplicate_normalized_key");
  }
  assert.equal(countConcepts(db), 1);
  if (first.status === "inserted") {
    assert.equal(first.record.matchingVersion, CONCEPT_MATCHING_VERSION);
  }
});

test("同じ alias を同じ Concept へ二度入れない。別 Concept なら許す", () => {
  const db = openMemoryDb();
  insertConcept(
    { id: "c1", canonicalLabel: "思考整理", createdAt: "2026-08-18T00:00:00.000Z" },
    db,
  );
  insertConcept(
    { id: "c2", canonicalLabel: "知識整理", createdAt: "2026-08-18T00:00:00.000Z" },
    db,
  );
  const first = insertConceptAlias(
    { conceptId: "c1", aliasLabel: "知見の管理" },
    db,
  );
  const duplicate = insertConceptAlias(
    { conceptId: "c1", aliasLabel: "知見の管理" },
    db,
  );
  const otherConcept = insertConceptAlias(
    { conceptId: "c2", aliasLabel: "知見の管理" },
    db,
  );
  assert.equal(first.status, "inserted");
  assert.equal(duplicate.status, "skipped");
  assert.equal(otherConcept.status, "inserted");
});

test("alias だけでは Concept を merge しない", () => {
  const db = openMemoryDb();
  insertConcept(
    { id: "c1", canonicalLabel: "AI性能", createdAt: "2026-08-18T00:00:00.000Z" },
    db,
  );
  insertConcept(
    { id: "c2", canonicalLabel: "高性能AI", createdAt: "2026-08-18T00:00:00.000Z" },
    db,
  );
  insertConceptAlias({ conceptId: "c1", aliasLabel: "高性能AI" }, db);
  assert.equal(countConcepts(db), 2);
});

test("USER provenance を満たさない Occurrence は作らない", () => {
  const db = openMemoryDb();
  seedSession(db, "s1");
  seedMessage(db, { id: "m1", sessionId: "s1" });
  insertConcept(
    { id: "c1", canonicalLabel: "距離感", createdAt: "2026-08-18T00:00:00.000Z" },
    db,
  );
  const assistant = insertConceptOccurrence(
    {
      id: "o1",
      conceptId: "c1",
      sessionId: "s1",
      messageId: "m1",
      evidenceRef: "M001:E01",
      occurredAt: "2026-08-02",
      sourceRole: "assistant",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  const missingMessage = insertConceptOccurrence(
    {
      id: "o2",
      conceptId: "c1",
      sessionId: "s1",
      messageId: "   ",
      evidenceRef: "M001:E01",
      occurredAt: "2026-08-02",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  assert.equal(assistant.status, "skipped");
  assert.equal(missingMessage.status, "skipped");
  assert.equal(countConceptOccurrences(db), 0);
});

test("Occurrence identity は再 insert しても増えない", () => {
  const db = openMemoryDb();
  seedSession(db, "s1");
  seedMessage(db, { id: "m1", sessionId: "s1" });
  insertConcept(
    { id: "c1", canonicalLabel: "距離感", createdAt: "2026-08-18T00:00:00.000Z" },
    db,
  );
  const row = {
    conceptId: "c1",
    sessionId: "s1",
    messageId: "m1",
    evidenceRef: "M001:E01",
    occurredAt: "2026-08-02T03:04:05.000Z",
    sourceRole: "user" as const,
    sourceType: "evidence_unit" as const,
    extractionVersion: CONCEPT_EXTRACTION_VERSION,
  };
  const first = insertConceptOccurrence({ id: "o1", ...row }, db);
  const second = insertConceptOccurrence({ id: "o2", ...row }, db);
  assert.equal(first.status, "inserted");
  assert.equal(second.status, "skipped");
  if (second.status === "skipped") {
    assert.equal(second.reason, "duplicate_identity");
  }
  assert.equal(countConceptOccurrences(db), 1);
});

test("migration は追加型で、既存テーブルへ書けて Concept は空のまま", () => {
  const db = openMemoryDb();
  db.insert(schema.reviews)
    .values({
      id: "review-1",
      title: "レビュー",
      model: "test",
      promptVersion: "integrated-review-v5",
      payload: "{}",
      createdAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
  const saved = db.select().from(schema.reviews).all();
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.payload, "{}");
  assert.equal(countConcepts(db), 0);
  assert.equal(countConceptOccurrences(db), 0);
});
