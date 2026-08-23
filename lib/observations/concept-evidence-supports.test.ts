import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { applySqlMigrations } from "@/lib/db/client";
import {
  insertConcept,
  insertConceptOccurrence,
} from "@/lib/db/concept-queries";
import { listObservationConceptRelations } from "@/lib/db/observation-concept-support-queries";
import * as schema from "@/lib/db/schema";
import {
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
  buildObservationConceptEvidenceSupports,
  toObservationConceptRelationPairs,
} from "./concept-evidence-supports";
import { reconcileObservationConceptEvidenceSupports } from "./reconcile-concept-evidence-supports";
import { REVIEW_OBSERVATION_VERSION } from "./types";

const USER_QUOTE = "SECRET_USER_QUOTE_observation_concept_support";

function evidence(input: {
  sessionId?: string | null;
  messageId?: string | null;
  evidenceRef?: string;
  quote?: string;
}) {
  return {
    messageRef: "M001",
    quote: input.quote ?? "x",
    validated: true,
    messageId: input.messageId ?? null,
    sessionId: input.sessionId ?? null,
    evidenceRef: input.evidenceRef,
  };
}

function connectionPayload(
  items: Array<ReturnType<typeof evidence>>,
) {
  return JSON.stringify({
    text: USER_QUOTE,
    evidence: items,
    semanticValid: true,
    relationType: "complement",
  });
}

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function seedReview(db: ReturnType<typeof openMemoryDb>, id = "review-1") {
  db.insert(schema.reviews)
    .values({
      id,
      title: id,
      model: "test",
      promptVersion: "integrated-review-v5",
      payload: "{}",
      createdAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
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
  input: { id: string; sessionId: string; index?: number },
) {
  db.insert(schema.messages)
    .values({
      id: input.id,
      sessionId: input.sessionId,
      index: input.index ?? 0,
      role: "user",
      content: "x",
      charStart: 0,
      charEnd: 1,
      sourceMessageId: null,
      sourceCreatedAt: null,
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

function seedObservation(
  db: ReturnType<typeof openMemoryDb>,
  input: {
    id: string;
    kind?: string;
    payload: string;
    sessionIds: string[];
    sourceRef?: string;
  },
) {
  db.insert(schema.observations)
    .values({
      id: input.id,
      kind: input.kind ?? "connection",
      projectionVersion: REVIEW_OBSERVATION_VERSION,
      sourceReviewId: "review-1",
      sourceRef: input.sourceRef ?? input.id,
      title: input.id,
      body: input.id,
      supportType: null,
      payload: input.payload,
      firstSeenAt: "2026-08-02",
      lastSeenAt: "2026-08-02",
      detectedAt: "2026-08-18T00:00:00.000Z",
      distinctSessionCount: new Set(input.sessionIds).size,
      createdAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
  for (const sessionId of input.sessionIds) {
    db.insert(schema.observationSessions)
      .values({ observationId: input.id, sessionId })
      .run();
  }
}

function seedConcept(
  db: ReturnType<typeof openMemoryDb>,
  id: string,
  label: string,
) {
  const inserted = insertConcept(
    {
      id,
      canonicalLabel: label,
      createdAt: "2026-07-01T00:00:00.000Z",
    },
    db,
  );
  assert.equal(inserted.status, "inserted");
}

function seedOccurrence(
  db: ReturnType<typeof openMemoryDb>,
  input: {
    id: string;
    conceptId: string;
    sessionId: string;
    messageId: string;
    evidenceRef: string;
  },
) {
  const inserted = insertConceptOccurrence(
    {
      id: input.id,
      conceptId: input.conceptId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      evidenceRef: input.evidenceRef,
      occurredAt: "2026-08-02T00:00:00.000Z",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  assert.equal(inserted.status, "inserted", JSON.stringify(inserted));
}

function seedExactPair(
  db: ReturnType<typeof openMemoryDb>,
  input?: {
    observationId?: string;
    conceptId?: string;
    sessionId?: string;
    messageId?: string;
    evidenceRef?: string;
    conceptLabel?: string;
  },
) {
  const observationId = input?.observationId ?? "obs-1";
  const conceptId = input?.conceptId ?? "c-1";
  const sessionId = input?.sessionId ?? "s-1";
  const messageId = input?.messageId ?? "m-1";
  const evidenceRef = input?.evidenceRef ?? "M001:E01";
  seedReview(db);
  seedSession(db, sessionId);
  seedMessage(db, { id: messageId, sessionId });
  seedObservation(db, {
    id: observationId,
    payload: connectionPayload([
      evidence({ sessionId, messageId, evidenceRef }),
    ]),
    sessionIds: [sessionId],
  });
  seedConcept(db, conceptId, input?.conceptLabel ?? "ThemeA");
  seedOccurrence(db, {
    id: `${conceptId}-occ`,
    conceptId,
    sessionId,
    messageId,
    evidenceRef,
  });
}

test("A. empty → support 0", () => {
  const supports = buildObservationConceptEvidenceSupports({
    observations: [],
    conceptOccurrences: [],
  });
  assert.equal(supports.length, 0);
  const db = openMemoryDb();
  const result = reconcileObservationConceptEvidenceSupports(
    { sessionIds: [] },
    { db },
  );
  assert.equal(result.created, 0);
  assert.equal(result.desiredSupportCount, 0);
});

test("B. exact triple → support 1", () => {
  const db = openMemoryDb();
  seedExactPair(db);
  const result = reconcileObservationConceptEvidenceSupports(
    { sessionIds: ["s-1"] },
    { db, now: () => "2026-08-23T00:00:00.000Z" },
  );
  assert.equal(result.created, 1);
  assert.equal(result.desiredSupportCount, 1);
  assert.equal(result.uniqueObservationConceptPairs, 1);
  const pairs = listObservationConceptRelations(db);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]?.observationId, "obs-1");
  assert.equal(pairs[0]?.conceptId, "c-1");
  assert.equal(pairs[0]?.supportCount, 1);
  assert.equal(
    pairs[0]?.relationVersion,
    OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
  );
});

test("C. same message / different evidenceRef → 0", () => {
  const supports = buildObservationConceptEvidenceSupports({
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload([
          evidence({
            sessionId: "s-1",
            messageId: "m-1",
            evidenceRef: "M001:E01",
          }),
        ]),
      },
    ],
    conceptOccurrences: [
      {
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E02",
      },
    ],
  });
  assert.equal(supports.length, 0);

  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedObservation(db, {
    id: "obs-1",
    payload: connectionPayload([
      evidence({
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      }),
    ]),
    sessionIds: ["s-1"],
  });
  seedConcept(db, "c-1", "ThemeA");
  seedOccurrence(db, {
    id: "occ-1",
    conceptId: "c-1",
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "M001:E02",
  });
  const result = reconcileObservationConceptEvidenceSupports(
    { sessionIds: ["s-1"] },
    { db },
  );
  assert.equal(result.created, 0);
  assert.equal(result.desiredSupportCount, 0);
  assert.equal(listObservationConceptRelations(db).length, 0);
});

test("D. same Session only → 0", () => {
  const supports = buildObservationConceptEvidenceSupports({
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload([
          evidence({
            sessionId: "s-1",
            messageId: "m-obs",
            evidenceRef: "M001:E01",
          }),
        ]),
      },
    ],
    conceptOccurrences: [
      {
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-concept",
        evidenceRef: "M002:E01",
      },
    ],
  });
  assert.equal(supports.length, 0);
});

test("E. same date only → 0", () => {
  const supports = buildObservationConceptEvidenceSupports({
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload([
          evidence({
            sessionId: "s-obs",
            messageId: "m-obs",
            evidenceRef: "M001:E01",
          }),
        ]),
      },
    ],
    conceptOccurrences: [
      {
        conceptId: "c-1",
        sessionId: "s-concept",
        messageId: "m-concept",
        evidenceRef: "M001:E01",
      },
    ],
  });
  assert.equal(supports.length, 0);
});

test("F. text equality only → 0", () => {
  const supports = buildObservationConceptEvidenceSupports({
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload([
          evidence({
            sessionId: "s-obs",
            messageId: "m-obs",
            evidenceRef: "M001:E01",
            quote: USER_QUOTE,
          }),
        ]),
      },
    ],
    conceptOccurrences: [
      {
        conceptId: "c-1",
        sessionId: "s-concept",
        messageId: "m-concept",
        evidenceRef: "M009:E09",
      },
    ],
  });
  assert.equal(supports.length, 0);
});

test("G. multiple Concepts same Evidence → 2 supports", () => {
  const supports = buildObservationConceptEvidenceSupports({
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload([
          evidence({
            sessionId: "s-1",
            messageId: "m-1",
            evidenceRef: "M001:E01",
          }),
        ]),
      },
    ],
    conceptOccurrences: [
      {
        conceptId: "c-2",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      },
      {
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      },
    ],
  });
  assert.equal(supports.length, 2);
  assert.deepEqual(
    supports.map((row) => row.conceptId),
    ["c-1", "c-2"],
  );

  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedObservation(db, {
    id: "obs-1",
    payload: connectionPayload([
      evidence({
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      }),
    ]),
    sessionIds: ["s-1"],
  });
  seedConcept(db, "c-1", "ThemeA");
  seedConcept(db, "c-2", "ThemeB");
  seedOccurrence(db, {
    id: "occ-1",
    conceptId: "c-1",
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "M001:E01",
  });
  seedOccurrence(db, {
    id: "occ-2",
    conceptId: "c-2",
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "M001:E01",
  });
  const result = reconcileObservationConceptEvidenceSupports(
    { sessionIds: ["s-1"] },
    { db },
  );
  assert.equal(result.created, 2);
  assert.equal(result.uniqueObservationConceptPairs, 2);
});

test("H. same pair multiple Evidence → 2 support rows, 1 pair", () => {
  const supports = buildObservationConceptEvidenceSupports({
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload([
          evidence({
            sessionId: "s-1",
            messageId: "m-1",
            evidenceRef: "M001:E01",
          }),
          evidence({
            sessionId: "s-1",
            messageId: "m-1",
            evidenceRef: "M001:E02",
          }),
        ]),
      },
    ],
    conceptOccurrences: [
      {
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      },
      {
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E02",
      },
    ],
  });
  assert.equal(supports.length, 2);
  const pairs = toObservationConceptRelationPairs(supports);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]?.supportCount, 2);
});

test("I. duplicate Observation anchors do not duplicate support rows", () => {
  const supports = buildObservationConceptEvidenceSupports({
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload([
          evidence({
            sessionId: "s-1",
            messageId: "m-1",
            evidenceRef: "M001:E01",
          }),
          evidence({
            sessionId: "s-1",
            messageId: "m-1",
            evidenceRef: "M001:E01",
          }),
        ]),
      },
    ],
    conceptOccurrences: [
      {
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      },
    ],
  });
  assert.equal(supports.length, 1);
});

test("J. idempotent reconciliation", () => {
  const db = openMemoryDb();
  seedExactPair(db);
  const first = reconcileObservationConceptEvidenceSupports(
    { sessionIds: ["s-1"] },
    { db },
  );
  const second = reconcileObservationConceptEvidenceSupports(
    { sessionIds: ["s-1"] },
    { db },
  );
  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(second.alreadyPresent, 1);
  assert.equal(listObservationConceptRelations(db).length, 1);
});

test("K. session scoped — other sessions are untouched", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedSession(db, "s-2");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedMessage(db, { id: "m-2", sessionId: "s-2", index: 1 });
  seedObservation(db, {
    id: "obs-1",
    payload: connectionPayload([
      evidence({
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      }),
    ]),
    sessionIds: ["s-1"],
  });
  seedObservation(db, {
    id: "obs-2",
    payload: connectionPayload([
      evidence({
        sessionId: "s-2",
        messageId: "m-2",
        evidenceRef: "M001:E01",
      }),
    ]),
    sessionIds: ["s-2"],
  });
  seedConcept(db, "c-1", "ThemeA");
  seedConcept(db, "c-2", "ThemeB");
  seedOccurrence(db, {
    id: "occ-1",
    conceptId: "c-1",
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "M001:E01",
  });
  seedOccurrence(db, {
    id: "occ-2",
    conceptId: "c-2",
    sessionId: "s-2",
    messageId: "m-2",
    evidenceRef: "M001:E01",
  });
  const result = reconcileObservationConceptEvidenceSupports(
    { sessionIds: ["s-1"] },
    { db },
  );
  assert.equal(result.created, 1);
  const pairs = listObservationConceptRelations(db);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]?.observationId, "obs-1");
  assert.equal(pairs[0]?.conceptId, "c-1");
});

test("L. old Observation without evidenceRef → no relation", () => {
  const supports = buildObservationConceptEvidenceSupports({
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload([
          evidence({ sessionId: "s-1", messageId: "m-1" }),
        ]),
      },
    ],
    conceptOccurrences: [
      {
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      },
    ],
  });
  assert.equal(supports.length, 0);
});

test("M. unresolved / partial locator → no relation", () => {
  const supports = buildObservationConceptEvidenceSupports({
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload([
          evidence({
            sessionId: "s-1",
            messageId: null,
            evidenceRef: "M001:E01",
          }),
        ]),
      },
    ],
    conceptOccurrences: [
      {
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      },
    ],
  });
  assert.equal(supports.length, 0);
});

test("N/O. no Tier B or Tier C fallback", () => {
  const source = readFileSync(
    resolve(process.cwd(), "lib/observations/concept-evidence-supports.ts"),
    "utf8",
  );
  assert.match(source, /sessionId/);
  assert.match(source, /messageId/);
  assert.match(source, /evidenceRef/);
  assert.doesNotMatch(source, /tierB|Tier B|exact_message_anchor/);
  assert.doesNotMatch(source, /same-date|occurredAt ===/);
});

test("P/Q. relation read aggregates supportCount and unique pairs", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedObservation(db, {
    id: "obs-1",
    payload: connectionPayload([
      evidence({
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      }),
      evidence({
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E02",
      }),
    ]),
    sessionIds: ["s-1"],
  });
  seedConcept(db, "c-1", "ThemeA");
  seedOccurrence(db, {
    id: "occ-1",
    conceptId: "c-1",
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "M001:E01",
  });
  seedOccurrence(db, {
    id: "occ-2",
    conceptId: "c-1",
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "M001:E02",
  });
  reconcileObservationConceptEvidenceSupports({ sessionIds: ["s-1"] }, { db });
  const pairs = listObservationConceptRelations(db, { sessionIds: ["s-1"] });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]?.supportCount, 2);
});

test("R. invalid Observation / Concept IDs are rejected by FK", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  assert.throws(() => {
    db.insert(schema.observationConceptEvidenceSupports)
      .values({
        observationId: "missing-obs",
        conceptId: "missing-concept",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
        relationVersion: OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
        createdAt: "2026-08-23T00:00:00.000Z",
      })
      .run();
  });
});

test("S. serialized rows/results contain no USER body", () => {
  const db = openMemoryDb();
  seedExactPair(db);
  const result = reconcileObservationConceptEvidenceSupports(
    { sessionIds: ["s-1"] },
    { db },
  );
  const supportRows = db
    .select()
    .from(schema.observationConceptEvidenceSupports)
    .all();
  const serialized = JSON.stringify({
    result,
    pairs: listObservationConceptRelations(db),
    supportRows,
  });
  assert.equal(serialized.includes(USER_QUOTE), false);
  assert.equal(
    Object.keys(supportRows[0] ?? {}).sort().join(","),
    "conceptId,createdAt,evidenceRef,messageId,observationId,relationVersion,sessionId",
  );
});

test("T. no LLM in relation store", () => {
  for (const file of [
    "lib/observations/concept-evidence-supports.ts",
    "lib/observations/reconcile-concept-evidence-supports.ts",
    "lib/db/observation-concept-support-queries.ts",
  ]) {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(source, /from "openai"/);
    assert.doesNotMatch(source, /embedding/);
    assert.doesNotMatch(source, /generateStructured/);
  }
});

test("U. no production pipeline hook", () => {
  const projectReview = readFileSync(
    resolve(process.cwd(), "lib/observations/project-review.ts"),
    "utf8",
  );
  const append = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/append.ts"),
    "utf8",
  );
  assert.doesNotMatch(projectReview, /reconcileObservationConceptEvidenceSupports/);
  assert.doesNotMatch(append, /reconcileObservationConceptEvidenceSupports/);
});
