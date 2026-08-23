import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { applySqlMigrations } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import {
  buildIncrementalConceptSessionPreparedPayload,
  parsePreparedPayload,
  serializePreparedPayload,
} from "./session-run-payload";
import {
  countIncrementalSessionRuns,
  insertPreparedIncrementalSessionRun,
  loadIncrementalSessionRunBySession,
} from "./session-run-store";
import { INCREMENTAL_CONCEPT_SESSION_PREPARED_VERSION } from "./session-run-types";

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function seedSession(db: ReturnType<typeof openMemoryDb>, id: string) {
  db.insert(schema.sessions)
    .values({
      id,
      title: id,
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
}

test("A. prepared run round-trip serialize → DB → parse", () => {
  const db = openMemoryDb();
  seedSession(db, "session-a");
  const payload = buildIncrementalConceptSessionPreparedPayload({
    sessionId: "session-a",
    planning: {
      status: "no_actions",
      existingMatchCount: 0,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    },
    existingAppendIntent: null,
    newAssessmentIntent: null,
    newAdmissionManifest: null,
  });
  const inserted = insertPreparedIncrementalSessionRun({
    sessionId: "session-a",
    payload,
    db,
    now: () => "2026-08-24T00:00:00.000Z",
    createRunId: () => "run-a",
  });
  assert.equal(inserted.ok, true);
  const row = loadIncrementalSessionRunBySession({
    sessionId: "session-a",
    db,
  });
  assert.ok(row);
  const parsed = parsePreparedPayload(row!.preparedPayload);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.payload.sessionId, "session-a");
    assert.equal(parsed.payload.version, INCREMENTAL_CONCEPT_SESSION_PREPARED_VERSION);
  }
  assert.equal(serializePreparedPayload(payload), row!.preparedPayload);
});

test("B. unique session + processingVersion — duplicate durable run blocked", () => {
  const db = openMemoryDb();
  seedSession(db, "session-b");
  const payload = buildIncrementalConceptSessionPreparedPayload({
    sessionId: "session-b",
    planning: {
      status: "no_actions",
      existingMatchCount: 0,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    },
    existingAppendIntent: null,
    newAssessmentIntent: null,
    newAdmissionManifest: null,
  });
  const first = insertPreparedIncrementalSessionRun({
    sessionId: "session-b",
    payload,
    db,
    createRunId: () => "run-b-1",
  });
  const second = insertPreparedIncrementalSessionRun({
    sessionId: "session-b",
    payload,
    db,
    createRunId: () => "run-b-2",
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.code, "unique_conflict");
  }
  assert.equal(countIncrementalSessionRuns(db), 1);
});

test("C. corrupt payload → blocked parse / no LLM fallback path", () => {
  const parsed = parsePreparedPayload("{not-json");
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.code, "malformed_prepared_payload");
  }
});

test("D. unsupported run / prepared version → blocked", () => {
  const parsed = parsePreparedPayload(
    JSON.stringify({
      version: "incremental-concept-session-prepared-v99",
      sessionId: "x",
      processingVersion: "concept-incremental-processing-v1",
      planning: {
        status: "no_actions",
        existingMatchCount: 0,
        newCandidateCount: 0,
        provisionalNewCount: 0,
        groundingRejectedCount: 0,
      },
      existingAppendIntent: null,
      newAssessmentIntent: null,
      newAdmissionManifest: null,
    }),
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.code, "unsupported_prepared_version");
  }
});
