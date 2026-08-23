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
import { REVIEW_OBSERVATION_VERSION } from "./types";
import {
  RELATION_RECONCILIATION_FAILED_CODE,
  afterConceptOccurrenceSessionsCommitted,
  afterReviewObservationsCommitted,
  runObservationConceptRelationReconciliationAfterCommit,
} from "./observation-concept-relation-lifecycle";
import { runObservationConceptRelationCli } from "./observation-concept-relation-cli";
import { reconcileObservationConceptEvidenceSupports } from "./reconcile-concept-evidence-supports";

const USER_QUOTE = "SECRET_USER_QUOTE_relation_lifecycle";

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

function connectionPayload(items: Array<ReturnType<typeof evidence>>) {
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
    payload: string;
    sessionIds: string[];
    sourceReviewId?: string;
    sourceRef?: string;
  },
) {
  db.insert(schema.observations)
    .values({
      id: input.id,
      kind: "connection",
      projectionVersion: REVIEW_OBSERVATION_VERSION,
      sourceReviewId: input.sourceReviewId ?? "review-1",
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
  assert.equal(
    insertConcept({ id, canonicalLabel: label, createdAt: "2026-07-01T00:00:00.000Z" }, db)
      .status,
    "inserted",
  );
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
  assert.equal(
    insertConceptOccurrence(
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
    ).status,
    "inserted",
  );
}

function supportCount(db: ReturnType<typeof openMemoryDb>) {
  return db.select().from(schema.observationConceptEvidenceSupports).all().length;
}

test("A. Review-first: later Concept hook completes support", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedObservation(db, {
    id: "obs-1",
    payload: connectionPayload([
      evidence({ sessionId: "s-1", messageId: "m-1", evidenceRef: "M001:E01" }),
    ]),
    sessionIds: ["s-1"],
  });
  const afterReview = afterReviewObservationsCommitted({ reviewId: "review-1" }, { db });
  assert.equal(afterReview.status, "ready");
  if (afterReview.status === "ready") {
    assert.equal(afterReview.created, 0);
  }
  assert.equal(supportCount(db), 0);

  seedConcept(db, "c-1", "ThemeA");
  seedOccurrence(db, {
    id: "occ-1",
    conceptId: "c-1",
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "M001:E01",
  });
  const afterConcept = afterConceptOccurrenceSessionsCommitted(
    { sessionIds: ["s-1"] },
    { db },
  );
  assert.equal(afterConcept.status, "ready");
  if (afterConcept.status === "ready") {
    assert.equal(afterConcept.created, 1);
  }
  assert.equal(supportCount(db), 1);
});

test("B. Concept-first: later Review hook completes support", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedConcept(db, "c-1", "ThemeA");
  seedOccurrence(db, {
    id: "occ-1",
    conceptId: "c-1",
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "M001:E01",
  });
  const afterConcept = afterConceptOccurrenceSessionsCommitted(
    { sessionIds: ["s-1"] },
    { db },
  );
  assert.equal(afterConcept.status, "ready");
  if (afterConcept.status === "ready") {
    assert.equal(afterConcept.created, 0);
  }
  seedObservation(db, {
    id: "obs-1",
    payload: connectionPayload([
      evidence({ sessionId: "s-1", messageId: "m-1", evidenceRef: "M001:E01" }),
    ]),
    sessionIds: ["s-1"],
  });
  const afterReview = afterReviewObservationsCommitted({ reviewId: "review-1" }, { db });
  assert.equal(afterReview.status, "ready");
  if (afterReview.status === "ready") {
    assert.equal(afterReview.created, 1);
  }
  assert.equal(supportCount(db), 1);
});

test("C/Q. both exist / already_present recovery completes support", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedObservation(db, {
    id: "obs-1",
    payload: connectionPayload([
      evidence({ sessionId: "s-1", messageId: "m-1", evidenceRef: "M001:E01" }),
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
  assert.equal(supportCount(db), 0);
  const recovered = afterConceptOccurrenceSessionsCommitted(
    { sessionIds: ["s-1"] },
    { db },
  );
  assert.equal(recovered.status, "ready");
  if (recovered.status === "ready") {
    assert.equal(recovered.created, 1);
  }
});

test("D. idempotent hooks do not add rows", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedObservation(db, {
    id: "obs-1",
    payload: connectionPayload([
      evidence({ sessionId: "s-1", messageId: "m-1", evidenceRef: "M001:E01" }),
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
  const first = afterReviewObservationsCommitted({ reviewId: "review-1" }, { db });
  const second = afterReviewObservationsCommitted({ reviewId: "review-1" }, { db });
  assert.equal(first.status, "ready");
  assert.equal(second.status, "ready");
  if (first.status === "ready" && second.status === "ready") {
    assert.equal(first.created, 1);
    assert.equal(second.created, 0);
    assert.equal(second.alreadyPresent, 1);
  }
  assert.equal(supportCount(db), 1);
});

test("E. old Observation without evidenceRef → 0 support, no error", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedObservation(db, {
    id: "obs-1",
    payload: connectionPayload([
      evidence({ sessionId: "s-1", messageId: "m-1" }),
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
  const result = afterReviewObservationsCommitted({ reviewId: "review-1" }, { db });
  assert.equal(result.status, "not_needed");
  assert.equal(supportCount(db), 0);
});

test("F/G/H. Tier A only: different evidenceRef / session-only → 0", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedSession(db, "s-2");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedMessage(db, { id: "m-2", sessionId: "s-2", index: 1 });
  seedObservation(db, {
    id: "obs-1",
    payload: connectionPayload([
      evidence({ sessionId: "s-1", messageId: "m-1", evidenceRef: "M001:E01" }),
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
  seedOccurrence(db, {
    id: "occ-2",
    conceptId: "c-1",
    sessionId: "s-2",
    messageId: "m-2",
    evidenceRef: "M001:E01",
  });
  const result = afterConceptOccurrenceSessionsCommitted(
    { sessionIds: ["s-1", "s-2"] },
    { db },
  );
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.created, 0);
  }
});

test("I. multiple Concepts on same Evidence → support 2", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedObservation(db, {
    id: "obs-1",
    payload: connectionPayload([
      evidence({ sessionId: "s-1", messageId: "m-1", evidenceRef: "M001:E01" }),
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
  const result = afterReviewObservationsCommitted({ reviewId: "review-1" }, { db });
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.created, 2);
    assert.equal(result.uniqueObservationConceptPairs, 2);
  }
});

test("J. multiple Evidence for one pair → supportCount 2", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedObservation(db, {
    id: "obs-1",
    payload: connectionPayload([
      evidence({ sessionId: "s-1", messageId: "m-1", evidenceRef: "M001:E01" }),
      evidence({ sessionId: "s-1", messageId: "m-1", evidenceRef: "M001:E02" }),
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
  afterReviewObservationsCommitted({ reviewId: "review-1" }, { db });
  const pairs = listObservationConceptRelations(db);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]?.supportCount, 2);
});

test("K/M/N. Review relation failure keeps Observation and is observable without retry", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedObservation(db, {
    id: "obs-1",
    payload: connectionPayload([
      evidence({ sessionId: "s-1", messageId: "m-1", evidenceRef: "M001:E01" }),
    ]),
    sessionIds: ["s-1"],
  });
  let calls = 0;
  const result = afterReviewObservationsCommitted(
    { reviewId: "review-1" },
    {
      db,
      reconcile: () => {
        calls += 1;
        throw new Error("injected");
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.code, RELATION_RECONCILIATION_FAILED_CODE);
  }
  assert.equal(
    db.select().from(schema.observations).all().length,
    1,
  );
  assert.equal(supportCount(db), 0);
});

test("L. Concept relation failure keeps Occurrence", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedConcept(db, "c-1", "ThemeA");
  seedOccurrence(db, {
    id: "occ-1",
    conceptId: "c-1",
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "M001:E01",
  });
  const result = afterConceptOccurrenceSessionsCommitted(
    { sessionIds: ["s-1"] },
    {
      db,
      reconcile: () => {
        throw new Error("injected");
      },
    },
  );
  assert.equal(result.status, "failed");
  assert.equal(db.select().from(schema.conceptOccurrences).all().length, 1);
  assert.equal(supportCount(db), 0);
});

test("O. affected session scope does not touch unrelated sessions", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedSession(db, "s-2");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedMessage(db, { id: "m-2", sessionId: "s-2", index: 1 });
  seedObservation(db, {
    id: "obs-1",
    payload: connectionPayload([
      evidence({ sessionId: "s-1", messageId: "m-1", evidenceRef: "M001:E01" }),
    ]),
    sessionIds: ["s-1"],
  });
  seedObservation(db, {
    id: "obs-2",
    payload: connectionPayload([
      evidence({ sessionId: "s-2", messageId: "m-2", evidenceRef: "M001:E01" }),
    ]),
    sessionIds: ["s-2"],
    sourceRef: "obs-2",
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
  afterConceptOccurrenceSessionsCommitted({ sessionIds: ["s-1"] }, { db });
  const pairs = listObservationConceptRelations(db);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]?.observationId, "obs-1");
});

test("P. empty scope is not_needed and does not call reconciler", () => {
  let calls = 0;
  const result = runObservationConceptRelationReconciliationAfterCommit(
    { sessionIds: [] },
    {
      db: openMemoryDb(),
      reconcile: () => {
        calls += 1;
        return reconcileObservationConceptEvidenceSupports(
          { sessionIds: [] },
          { db: openMemoryDb() },
        );
      },
    },
  );
  assert.equal(result.status, "not_needed");
  assert.equal(calls, 0);
});

test("V. CLI preview writes 0", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedObservation(db, {
    id: "obs-1",
    payload: connectionPayload([
      evidence({ sessionId: "s-1", messageId: "m-1", evidenceRef: "M001:E01" }),
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
  const preview = runObservationConceptRelationCli(["--session", "s-1"], { db });
  assert.equal(preview.ok, true);
  if (preview.ok) {
    assert.equal(preview.mode, "preview");
    assert.equal(preview.wrote, 0);
    assert.equal(preview.missingSupportCount, 1);
  }
  assert.equal(supportCount(db), 0);
});

test("W. CLI apply creates support on temp DB", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedObservation(db, {
    id: "obs-1",
    payload: connectionPayload([
      evidence({ sessionId: "s-1", messageId: "m-1", evidenceRef: "M001:E01" }),
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
  const applied = runObservationConceptRelationCli(
    ["--session", "s-1", "--apply"],
    { db },
  );
  assert.equal(applied.ok, true);
  if (applied.ok && applied.mode === "apply") {
    assert.equal(applied.created, 1);
    assert.equal(applied.wrote, 1);
  }
  assert.equal(supportCount(db), 1);
});

test("X. lifecycle results contain no USER body", () => {
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
        quote: USER_QUOTE,
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
  const result = afterReviewObservationsCommitted({ reviewId: "review-1" }, { db });
  assert.equal(JSON.stringify(result).includes(USER_QUOTE), false);
});

test("Y/wiring. production hooks live outside core apply/projection transactions", () => {
  const projectReview = readFileSync(
    resolve(process.cwd(), "lib/observations/project-review.ts"),
    "utf8",
  );
  const append = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/append.ts"),
    "utf8",
  );
  const applyTx = readFileSync(
    resolve(process.cwd(), "lib/concepts/admission/apply-transaction.ts"),
    "utf8",
  );
  const newApply = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/new-admission-apply.ts"),
    "utf8",
  );
  const preflight = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/preflight.ts"),
    "utf8",
  );
  assert.doesNotMatch(projectReview, /runObservationConceptRelationReconciliationAfterCommit/);
  assert.doesNotMatch(append, /runObservationConceptRelationReconciliationAfterCommit/);
  assert.doesNotMatch(applyTx, /runObservationConceptRelationReconciliationAfterCommit/);
  assert.doesNotMatch(newApply, /runObservationConceptRelationReconciliationAfterCommit/);
  assert.doesNotMatch(preflight, /runObservationConceptRelationReconciliationAfterCommit/);

  const review = readFileSync(
    resolve(process.cwd(), "lib/ai/tasks/integrated-review.ts"),
    "utf8",
  );
  const applyRun = readFileSync(
    resolve(process.cwd(), "lib/concepts/admission/apply-run.ts"),
    "utf8",
  );
  const existingAppend = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/existing-append.ts"),
    "utf8",
  );
  const newLifecycle = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/new-admission-lifecycle.ts"),
    "utf8",
  );
  assert.match(review, /afterReviewObservationsCommitted/);
  assert.match(applyRun, /afterConceptOccurrenceSessionsCommitted/);
  assert.match(existingAppend, /afterConceptOccurrenceSessionsCommitted/);
  assert.match(newLifecycle, /applyIncrementalNewAdmissionManifestThenReconcile/);
});
