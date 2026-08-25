import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { toSessionRef } from "@/lib/ai/evidence-units";
import { applySqlMigrations } from "@/lib/db/client";
import {
  insertConcept,
  insertConceptOccurrence,
} from "@/lib/db/concept-queries";
import { listObservationConceptRelations } from "@/lib/db/observation-concept-support-queries";
import * as schema from "@/lib/db/schema";
import {
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V1,
  buildObservationConceptEvidenceSupports,
  buildObservationConceptEvidenceSupportsV2,
  toObservationConceptRelationPairs,
} from "./concept-evidence-supports";
import {
  planObservationConceptEvidenceSupports,
  reconcileObservationConceptEvidenceSupports,
} from "./reconcile-concept-evidence-supports";
import {
  canonicalEvidenceIdentityEquals,
  resolveConceptOccurrenceEvidenceIdentity,
  resolveObservationEvidenceIdentity,
  serializeCanonicalEvidenceLocalRef,
  type CanonicalEvidenceResolutionContext,
} from "./canonical-evidence-identity";
import { REVIEW_OBSERVATION_VERSION } from "./types";

const USER_QUOTE = "SECRET_USER_QUOTE_observation_concept_support";
const MULTI_UNIT_CONTENT =
  "First exact evidence unit has enough content.\nSecond exact evidence unit has enough content.\nThird exact evidence unit has enough content.";

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
  input: { id: string; sessionId: string; index?: number; content?: string },
) {
  const content =
    input.content ?? MULTI_UNIT_CONTENT;
  db.insert(schema.messages)
    .values({
      id: input.id,
      sessionId: input.sessionId,
      index: input.index ?? 0,
      role: "user",
      content,
      charStart: 0,
      charEnd: content.length,
      sourceMessageId: null,
      sourceCreatedAt: null,
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

function syntheticCanonicalContext(): CanonicalEvidenceResolutionContext {
  const session = (
    id: string,
    occurredAt: string,
    messages: Array<{ id: string; index: number }>,
  ) => ({
    session: {
      id,
      title: id,
      occurredAt,
      source: "chatgpt",
      category: "test",
      createdAt: `${occurredAt}T00:00:00.000Z`,
    },
    messages: messages.map((message) => ({
      ...message,
      role: "user",
      content: MULTI_UNIT_CONTENT,
      attachmentsJson: null,
    })),
    analysis: null,
  });
  const reviewSources = [
    session("s-1", "2026-08-01", [
      { id: "m-1", index: 0 },
      { id: "m-2", index: 1 },
    ]),
    session("s-2", "2026-08-02", [{ id: "m-3", index: 0 }]),
  ];
  return {
    reviewSourcesByReviewId: new Map([["review-1", reviewSources]]),
    conceptSessionsById: new Map(
      reviewSources.map((source) => [
        source.session.id,
        {
          sessionId: source.session.id,
          occurredAt: source.session.occurredAt,
          messages: source.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            sourceCreatedAt: null,
          })),
        },
      ]),
    ),
  };
}

function scopeReviewEvidenceRefs(
  payload: string,
  sessionIndexById: Map<string, number>,
) {
  const parsed: unknown = JSON.parse(payload);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.evidenceRef === "string" &&
      /^M\d+:E\d+$/.test(record.evidenceRef) &&
      typeof record.sessionId === "string"
    ) {
      const sessionIndex = sessionIndexById.get(record.sessionId);
      if (sessionIndex != null) {
        record.evidenceRef = `${toSessionRef(sessionIndex)}:${record.evidenceRef}`;
      }
    }
    Object.values(record).forEach(visit);
  };
  visit(parsed);
  return JSON.stringify(parsed);
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
  for (const sessionId of input.sessionIds) {
    db.insert(schema.reviewSessions)
      .values({ reviewId: "review-1", sessionId })
      .onConflictDoNothing()
      .run();
  }
  const orderedReviewSessions = db
    .select({
      reviewId: schema.reviewSessions.reviewId,
      sessionId: schema.sessions.id,
      occurredAt: schema.sessions.occurredAt,
      createdAt: schema.sessions.createdAt,
    })
    .from(schema.reviewSessions)
    .innerJoin(
      schema.sessions,
      eq(schema.reviewSessions.sessionId, schema.sessions.id),
    )
    .all()
    .filter((row) => row.reviewId === "review-1")
    .sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.sessionId.localeCompare(right.sessionId),
    );
  const sessionIndexById = new Map(
    orderedReviewSessions.map((row, index) => [row.sessionId, index]),
  );
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
      payload: scopeReviewEvidenceRefs(input.payload, sessionIndexById),
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

test("v2 strict resolvers canonicalize exact cross-format producer refs", () => {
  const context = syntheticCanonicalContext();
  const observation = resolveObservationEvidenceIdentity({
    sourceReviewId: "review-1",
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "S01:M001:E01",
    reviewSources: context.reviewSourcesByReviewId.get("review-1"),
  });
  const occurrence = resolveConceptOccurrenceEvidenceIdentity({
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "M001:E01",
    session: context.conceptSessionsById.get("s-1"),
  });
  assert.equal(observation.ok, true);
  assert.equal(occurrence.ok, true);
  if (observation.ok && occurrence.ok) {
    assert.equal(
      canonicalEvidenceIdentityEquals(
        observation.identity,
        occurrence.identity,
      ),
      true,
    );
    assert.deepEqual(observation.identity, {
      sessionId: "s-1",
      messageId: "m-1",
      evidenceOrdinal: 1,
    });
  }
});

test("v2 strict resolvers keep Evidence, Message, and Session identities distinct", () => {
  const context = syntheticCanonicalContext();
  const resolveConcept = (
    sessionId: string,
    messageId: string,
    evidenceRef: string,
  ) =>
    resolveConceptOccurrenceEvidenceIdentity({
      sessionId,
      messageId,
      evidenceRef,
      session: context.conceptSessionsById.get(sessionId),
    });
  const e1 = resolveConcept("s-1", "m-1", "M001:E01");
  const e2 = resolveConcept("s-1", "m-1", "M001:E02");
  const otherMessage = resolveConcept("s-1", "m-2", "M002:E01");
  const otherSession = resolveConcept("s-2", "m-3", "M001:E01");
  assert.ok(e1.ok && e2.ok && otherMessage.ok && otherSession.ok);
  if (e1.ok && e2.ok && otherMessage.ok && otherSession.ok) {
    assert.equal(canonicalEvidenceIdentityEquals(e1.identity, e2.identity), false);
    assert.equal(
      canonicalEvidenceIdentityEquals(e1.identity, otherMessage.identity),
      false,
    );
    assert.equal(
      canonicalEvidenceIdentityEquals(e1.identity, otherSession.identity),
      false,
    );
  }
});

test("v2 strict resolvers reject mismatched and out-of-range coordinates", () => {
  const context = syntheticCanonicalContext();
  const reviewSources = context.reviewSourcesByReviewId.get("review-1");
  const badSession = resolveObservationEvidenceIdentity({
    sourceReviewId: "review-1",
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "S02:M001:E01",
    reviewSources,
  });
  const badReviewMessage = resolveObservationEvidenceIdentity({
    sourceReviewId: "review-1",
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "S01:M002:E01",
    reviewSources,
  });
  const badConceptMessage = resolveConceptOccurrenceEvidenceIdentity({
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "M002:E01",
    session: context.conceptSessionsById.get("s-1"),
  });
  const outOfRange = resolveConceptOccurrenceEvidenceIdentity({
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "M001:E99",
    session: context.conceptSessionsById.get("s-1"),
  });
  assert.deepEqual(badSession, { ok: false, reason: "session_mismatch" });
  assert.deepEqual(badReviewMessage, {
    ok: false,
    reason: "message_mismatch",
  });
  assert.deepEqual(badConceptMessage, {
    ok: false,
    reason: "message_mismatch",
  });
  assert.deepEqual(outOfRange, {
    ok: false,
    reason: "evidence_ordinal_out_of_range",
  });
});

test("v2 strict resolvers reject whitespace, case mutation, garbage, and missing refs", () => {
  const context = syntheticCanonicalContext();
  const session = context.conceptSessionsById.get("s-1");
  const resolve = (evidenceRef: string | undefined) =>
    resolveConceptOccurrenceEvidenceIdentity({
      sessionId: "s-1",
      messageId: "m-1",
      evidenceRef,
      session,
    });
  assert.deepEqual(resolve(" M001:E01 "), {
    ok: false,
    reason: "noncanonical_ref",
  });
  assert.deepEqual(resolve("m001:e01"), {
    ok: false,
    reason: "noncanonical_ref",
  });
  assert.deepEqual(resolve("[M001:E01]"), {
    ok: false,
    reason: "malformed_ref",
  });
  assert.deepEqual(resolve(undefined), {
    ok: false,
    reason: "missing_evidence_ref",
  });
  assert.deepEqual(resolve("S01:M001:E01"), {
    ok: false,
    reason: "unsupported_legacy_provenance",
  });
});

test("v2 Evidence-local serialization is deterministic and contains no S/M", () => {
  assert.equal(serializeCanonicalEvidenceLocalRef(1), "E01");
  assert.equal(serializeCanonicalEvidenceLocalRef(99), "E99");
  assert.equal(serializeCanonicalEvidenceLocalRef(100), "E100");
  assert.throws(() => serializeCanonicalEvidenceLocalRef(0));
});

test("central regression: v1 misses producer namespaces; v2 matches exactly", () => {
  const observations = [
    {
      observationId: "obs-1",
      sourceReviewId: "review-1",
      kind: "connection",
      payload: connectionPayload([
        evidence({
          sessionId: "s-1",
          messageId: "m-1",
          evidenceRef: "S01:M001:E01",
        }),
      ]),
    },
  ];
  const conceptOccurrences = [
    {
      conceptId: "c-1",
      sessionId: "s-1",
      messageId: "m-1",
      evidenceRef: "M001:E01",
    },
  ];
  assert.equal(
    buildObservationConceptEvidenceSupports({
      observations,
      conceptOccurrences,
    }).length,
    0,
  );
  const v2 = buildObservationConceptEvidenceSupportsV2({
    observations,
    conceptOccurrences,
    context: syntheticCanonicalContext(),
  });
  assert.equal(v2.supports.length, 1);
  assert.equal(v2.supports[0]?.relationVersion, OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION);
  assert.equal(v2.supports[0]?.evidenceRef, "E01");
  assert.equal(v2.canonicalIdentityCollisions, 0);
});

test("a legacy v1 row does not suppress the missing v2 identity", () => {
  const db = openMemoryDb();
  seedExactPair(db);
  db.insert(schema.observationConceptEvidenceSupports)
    .values({
      observationId: "obs-1",
      conceptId: "c-1",
      sessionId: "s-1",
      messageId: "m-1",
      evidenceRef: "S01:M001:E01",
      relationVersion: OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V1,
      createdAt: "2026-08-23T00:00:00.000Z",
    })
    .run();
  const plan = planObservationConceptEvidenceSupports(["s-1"], db);
  assert.equal(plan.desired.length, 1);
  assert.equal(plan.existingCount, 0);
  assert.equal(plan.missing.length, 1);
});

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
