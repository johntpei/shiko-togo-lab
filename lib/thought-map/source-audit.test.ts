import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { applySqlMigrations } from "@/lib/db/client";
import {
  countConceptOccurrences,
  countConcepts,
  insertConcept,
  insertConceptOccurrence,
} from "@/lib/db/concept-queries";
import { countObservations } from "@/lib/db/observation-queries";
import * as schema from "@/lib/db/schema";
import { REVIEW_OBSERVATION_VERSION } from "@/lib/observations/types";
import {
  THOUGHT_MAP_EDGE_REASONS,
  THOUGHT_MAP_SOURCE_AUDIT_VERSION,
  buildThoughtMapSourceAudit,
  formatThoughtMapSourceAudit,
  type ThoughtMapSourceAuditInput,
} from "./source-audit";
import { loadThoughtMapSourceAudit } from "./source-audit-load";

const USER =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";

function emptyInput(): ThoughtMapSourceAuditInput {
  return {
    concepts: [],
    observations: [],
    sessions: [],
    conceptSessionLinks: [],
    observationSessionLinks: [],
  };
}

function connectionPayload(text: string) {
  return JSON.stringify({
    text,
    evidence: [],
    semanticValid: true,
    relationType: "complement",
  });
}

function connectionTextPairPayload() {
  return JSON.stringify({
    text: USER,
    evidence: [],
    semanticValid: true,
    relationType: "complement",
    sideA: { text: "statement A", evidence: [] },
    sideB: { text: "statement B", evidence: [] },
  });
}

function tensionPayload() {
  return JSON.stringify({
    text: USER,
    evidence: [],
    semanticValid: true,
    sideA: { text: "side A", evidence: [] },
    sideB: { text: "side B", evidence: [] },
  });
}

function shiftPayload() {
  return JSON.stringify({
    text: USER,
    evidence: [],
    semanticValid: true,
    before: "以前の考え",
    after: "いまの考え",
    interpretation: USER,
    beforeEvidence: [],
    afterEvidence: [],
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
    kind: string;
    payload: string;
    sessionIds: string[];
  },
) {
  db.insert(schema.observations)
    .values({
      id: input.id,
      kind: input.kind,
      projectionVersion: REVIEW_OBSERVATION_VERSION,
      sourceReviewId: "review-1",
      sourceRef: input.id,
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

function dbSnapshot(db: ReturnType<typeof openMemoryDb>) {
  return {
    observations: countObservations(db),
    concepts: countConcepts(db),
    occurrences: countConceptOccurrences(db),
    sessions: db.select({ id: schema.sessions.id }).from(schema.sessions).all()
      .length,
    observationSessions: db
      .select()
      .from(schema.observationSessions)
      .all().length,
  };
}

test("A. empty → node / edge 0", () => {
  const audit = buildThoughtMapSourceAudit(emptyInput());
  assert.equal(audit.version, THOUGHT_MAP_SOURCE_AUDIT_VERSION);
  assert.deepEqual(audit.nodes, {
    conceptCount: 0,
    observationCount: 0,
    sessionCount: 0,
  });
  assert.deepEqual(audit.explicitEdges, {
    conceptSessionCount: 0,
    observationSessionCount: 0,
    observationObservationCount: 0,
    conceptConceptCount: 0,
    observationConceptCount: 0,
  });
  assert.equal(audit.projectionA.nodeCount, 0);
  assert.equal(audit.projectionA.edgeCount, 0);
  assert.equal(audit.projectionB.nodeCount, 0);
  assert.equal(audit.projectionB.edgeCount, 0);
  assert.equal(audit.schema.hasObservationConceptsTable, false);
  assert.equal(audit.schema.conceptOccurrenceIsNode, false);
});

test("B. Concept + Session via Occurrence → Concept-Session edge 1", () => {
  const audit = buildThoughtMapSourceAudit({
    ...emptyInput(),
    concepts: [{ conceptId: "c-1" }],
    sessions: [{ sessionId: "s-1" }],
    conceptSessionLinks: [{ conceptId: "c-1", sessionId: "s-1" }],
  });
  assert.equal(audit.explicitEdges.conceptSessionCount, 1);
  assert.deepEqual(audit.conceptSession, [
    {
      conceptId: "c-1",
      sessionId: "s-1",
      reason: THOUGHT_MAP_EDGE_REASONS.conceptSession,
      supportCount: 1,
    },
  ]);
  assert.equal(audit.explicitEdges.conceptConceptCount, 0);
  assert.equal(audit.explicitEdges.observationConceptCount, 0);
});

test("C. same Concept same Session multiple Occurrences → 1 edge + supportCount > 1", () => {
  const audit = buildThoughtMapSourceAudit({
    ...emptyInput(),
    concepts: [{ conceptId: "c-1" }],
    sessions: [{ sessionId: "s-1" }],
    conceptSessionLinks: [
      { conceptId: "c-1", sessionId: "s-1" },
      { conceptId: "c-1", sessionId: "s-1" },
      { conceptId: "c-1", sessionId: "s-1" },
    ],
  });
  assert.equal(audit.explicitEdges.conceptSessionCount, 1);
  assert.equal(audit.conceptSession[0]?.supportCount, 3);
});

test("D. same Concept multiple Sessions → multiple edges", () => {
  const audit = buildThoughtMapSourceAudit({
    ...emptyInput(),
    concepts: [{ conceptId: "c-1" }],
    sessions: [{ sessionId: "s-b" }, { sessionId: "s-a" }],
    conceptSessionLinks: [
      { conceptId: "c-1", sessionId: "s-b" },
      { conceptId: "c-1", sessionId: "s-a" },
    ],
  });
  assert.equal(audit.explicitEdges.conceptSessionCount, 2);
  assert.deepEqual(
    audit.conceptSession.map((edge) => [edge.conceptId, edge.sessionId]),
    [
      ["c-1", "s-a"],
      ["c-1", "s-b"],
    ],
  );
});

test("E. Observation-Session uses explicit join only", () => {
  const audit = buildThoughtMapSourceAudit({
    ...emptyInput(),
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload("ThemeA"),
      },
    ],
    sessions: [{ sessionId: "s-1" }, { sessionId: "s-orphan" }],
    observationSessionLinks: [{ observationId: "obs-1", sessionId: "s-1" }],
  });
  assert.equal(audit.explicitEdges.observationSessionCount, 1);
  assert.deepEqual(audit.observationSession, [
    {
      observationId: "obs-1",
      sessionId: "s-1",
      reason: THOUGHT_MAP_EDGE_REASONS.observationSession,
      supportCount: 1,
    },
  ]);
  assert.equal(audit.projectionA.isolatedSessions, 1);
});

test("F. multiple Sessions per Observation → multiple edges", () => {
  const audit = buildThoughtMapSourceAudit({
    ...emptyInput(),
    observations: [
      {
        observationId: "obs-1",
        kind: "tension",
        payload: tensionPayload(),
      },
    ],
    sessions: [{ sessionId: "s-2" }, { sessionId: "s-1" }],
    observationSessionLinks: [
      { observationId: "obs-1", sessionId: "s-2" },
      { observationId: "obs-1", sessionId: "s-1" },
    ],
  });
  assert.equal(audit.explicitEdges.observationSessionCount, 2);
  assert.deepEqual(
    audit.observationSession.map((edge) => edge.sessionId),
    ["s-1", "s-2"],
  );
});

test("G. no Observation-Concept inferred from same date / matching text", () => {
  const audit = buildThoughtMapSourceAudit({
    ...emptyInput(),
    concepts: [{ conceptId: "c-1" }],
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload("ThemeA"),
      },
    ],
    sessions: [{ sessionId: "s-1" }],
    conceptSessionLinks: [{ conceptId: "c-1", sessionId: "s-1" }],
    observationSessionLinks: [{ observationId: "obs-1", sessionId: "s-1" }],
  });
  assert.equal(audit.explicitEdges.observationConceptCount, 0);
  assert.equal(audit.explicitEdges.observationObservationCount, 0);
});

test("H. no Concept-Concept inferred from same Session", () => {
  const audit = buildThoughtMapSourceAudit({
    ...emptyInput(),
    concepts: [{ conceptId: "c-1" }, { conceptId: "c-2" }],
    sessions: [{ sessionId: "s-1" }],
    conceptSessionLinks: [
      { conceptId: "c-1", sessionId: "s-1" },
      { conceptId: "c-2", sessionId: "s-1" },
    ],
  });
  assert.equal(audit.explicitEdges.conceptConceptCount, 0);
  assert.equal(audit.explicitEdges.conceptSessionCount, 2);
});

test("I. no Session-Session inferred from shared Observation", () => {
  const audit = buildThoughtMapSourceAudit({
    ...emptyInput(),
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload("x"),
      },
    ],
    sessions: [{ sessionId: "s-1" }, { sessionId: "s-2" }],
    observationSessionLinks: [
      { observationId: "obs-1", sessionId: "s-1" },
      { observationId: "obs-1", sessionId: "s-2" },
    ],
  });
  const serialized = JSON.stringify(audit);
  assert.equal(serialized.includes("sessionSession"), false);
  assert.equal(audit.explicitEdges.observationSessionCount, 2);
  assert.equal(audit.explicitEdges.observationObservationCount, 0);
});

test("J. text-only Connection A/B does not create Observation-Observation edges", () => {
  const audit = buildThoughtMapSourceAudit({
    ...emptyInput(),
    observations: [
      {
        observationId: "obs-c",
        kind: "connection",
        payload: connectionTextPairPayload(),
      },
      {
        observationId: "obs-t",
        kind: "tension",
        payload: tensionPayload(),
      },
      {
        observationId: "obs-s",
        kind: "shift",
        payload: shiftPayload(),
      },
    ],
  });
  assert.equal(audit.explicitEdges.observationObservationCount, 0);
  const connection = audit.observationShapes.find(
    (shape) => shape.kind === "connection",
  );
  const tension = audit.observationShapes.find(
    (shape) => shape.kind === "tension",
  );
  const shift = audit.observationShapes.find((shape) => shape.kind === "shift");
  assert.equal(connection?.hasTextSides, true);
  assert.equal(connection?.hasContractedEntityIds, false);
  assert.equal(tension?.hasTextSides, true);
  assert.equal(tension?.hasContractedEntityIds, false);
  assert.equal(shift?.hasBeforeAfterText, true);
  assert.equal(shift?.hasContractedEntityIds, false);
  assert.deepEqual(audit.contract.connection.entityIdFields, []);
  assert.deepEqual(audit.contract.tension.entityIdFields, []);
  assert.deepEqual(audit.contract.shift.entityIdFields, []);
  assert.equal(
    audit.unsupportedStructures.includes("connection_has_text_pair_only"),
    true,
  );
  assert.equal(
    audit.unsupportedStructures.includes("tension_has_text_pair_only"),
    true,
  );
});

test("K. uncontracted Observation ID fields are recorded, not promoted to edges", () => {
  const audit = buildThoughtMapSourceAudit({
    ...emptyInput(),
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: JSON.stringify({
          text: "x",
          evidence: [],
          sourceObservationId: "obs-2",
          relatedObservationIds: ["obs-3"],
        }),
      },
    ],
  });
  assert.equal(audit.explicitEdges.observationObservationCount, 0);
  const connection = audit.observationShapes.find(
    (shape) => shape.kind === "connection",
  );
  assert.deepEqual(connection?.uncontractedIdFieldNames, [
    "relatedObservationIds",
    "sourceObservationId",
  ]);
});

test("L. Projection A counts provenance nodes / edges", () => {
  const audit = buildThoughtMapSourceAudit({
    ...emptyInput(),
    concepts: [{ conceptId: "c-1" }, { conceptId: "c-isolated" }],
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload("x"),
      },
    ],
    sessions: [
      { sessionId: "s-1" },
      { sessionId: "s-2" },
      { sessionId: "s-isolated" },
    ],
    conceptSessionLinks: [{ conceptId: "c-1", sessionId: "s-1" }],
    observationSessionLinks: [
      { observationId: "obs-1", sessionId: "s-1" },
      { observationId: "obs-1", sessionId: "s-2" },
    ],
  });
  assert.equal(audit.projectionA.nodeCount, 6);
  assert.equal(audit.projectionA.edgeCount, 3);
  assert.equal(audit.projectionA.isolatedConcepts, 1);
  assert.equal(audit.projectionA.isolatedObservations, 0);
  assert.equal(audit.projectionA.isolatedSessions, 1);
  assert.equal(audit.projectionA.connectedComponentCount, 3);
});

test("M. Projection B drops Session nodes and session-backed edges", () => {
  const audit = buildThoughtMapSourceAudit({
    ...emptyInput(),
    concepts: [{ conceptId: "c-1" }],
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload("x"),
      },
    ],
    sessions: [{ sessionId: "s-1" }],
    conceptSessionLinks: [{ conceptId: "c-1", sessionId: "s-1" }],
    observationSessionLinks: [{ observationId: "obs-1", sessionId: "s-1" }],
  });
  assert.equal(audit.projectionB.nodeCount, 2);
  assert.equal(audit.projectionB.edgeCount, 0);
  assert.equal(audit.projectionB.isolatedConcepts, 1);
  assert.equal(audit.projectionB.isolatedObservations, 1);
  assert.equal(audit.projectionB.isolatedSessions, 0);
  assert.equal(audit.projectionB.connectedComponentCount, 2);
  assert.equal(audit.projectionB.degreeByNodeType.concept.degree0, 1);
  assert.equal(audit.projectionB.degreeByNodeType.observation.degree0, 1);
});

test("N. deterministic vs input order", () => {
  const base: ThoughtMapSourceAuditInput = {
    concepts: [{ conceptId: "c-b" }, { conceptId: "c-a" }],
    observations: [
      {
        observationId: "obs-b",
        kind: "tension",
        payload: tensionPayload(),
      },
      {
        observationId: "obs-a",
        kind: "connection",
        payload: connectionPayload("x"),
      },
    ],
    sessions: [{ sessionId: "s-b" }, { sessionId: "s-a" }],
    conceptSessionLinks: [
      { conceptId: "c-b", sessionId: "s-b" },
      { conceptId: "c-a", sessionId: "s-a" },
      { conceptId: "c-a", sessionId: "s-b" },
    ],
    observationSessionLinks: [
      { observationId: "obs-b", sessionId: "s-b" },
      { observationId: "obs-a", sessionId: "s-a" },
    ],
  };
  const reversed: ThoughtMapSourceAuditInput = {
    concepts: [...base.concepts].reverse(),
    observations: [...base.observations].reverse(),
    sessions: [...base.sessions].reverse(),
    conceptSessionLinks: [...base.conceptSessionLinks].reverse(),
    observationSessionLinks: [...base.observationSessionLinks].reverse(),
  };
  assert.deepEqual(
    buildThoughtMapSourceAudit(base),
    buildThoughtMapSourceAudit(reversed),
  );
});

test("O. USER本文なし", () => {
  const audit = buildThoughtMapSourceAudit({
    ...emptyInput(),
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionTextPairPayload(),
      },
      {
        observationId: "obs-2",
        kind: "tension",
        payload: tensionPayload(),
      },
      {
        observationId: "obs-3",
        kind: "shift",
        payload: shiftPayload(),
      },
    ],
  });
  const serialized = `${JSON.stringify(audit)}\n${formatThoughtMapSourceAudit(audit)}`;
  assert.equal(serialized.includes(USER), false);
  assert.equal(serialized.includes("statement A"), false);
  assert.equal(serialized.includes("以前の考え"), false);
  assert.equal(serialized.includes("surfaceForm"), false);
});

test("P. LLM 0", () => {
  const files = [
    "lib/thought-map/source-audit.ts",
    "lib/thought-map/source-audit-load.ts",
  ];
  for (const file of files) {
    const sourceText = readFileSync(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(sourceText, /from "openai"/);
    assert.doesNotMatch(sourceText, /embedding/);
    assert.doesNotMatch(sourceText, /similarity/);
    assert.doesNotMatch(sourceText, /recently_observed/);
    assert.doesNotMatch(sourceText, /cross_session_recurrence/);
    assert.doesNotMatch(sourceText, /buildTopicSignals/);
  }
});

test("Q. loader is SELECT-only and does not mutate the DB", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "session-a");
  seedSession(db, "session-b");
  seedMessage(db, { id: "m-a", sessionId: "session-a" });
  seedMessage(db, { id: "m-b", sessionId: "session-b" });
  seedObservation(db, {
    id: "obs-1",
    kind: "connection",
    payload: connectionPayload(USER),
    sessionIds: ["session-a", "session-b"],
  });
  const concept = insertConcept(
    {
      id: "c-1",
      canonicalLabel: "ThemeA",
      createdAt: "2026-07-01T00:00:00.000Z",
    },
    db,
  );
  assert.equal(concept.status, "inserted");
  const firstOccurrence = insertConceptOccurrence(
    {
      id: "occ-1",
      conceptId: "c-1",
      sessionId: "session-a",
      messageId: "m-a",
      evidenceRef: "M001:E01",
      occurredAt: "2026-07-15",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  const secondOccurrence = insertConceptOccurrence(
    {
      id: "occ-2",
      conceptId: "c-1",
      sessionId: "session-a",
      messageId: "m-a",
      evidenceRef: "M001:E02",
      occurredAt: "2026-07-15",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  assert.equal(firstOccurrence.status, "inserted");
  assert.equal(secondOccurrence.status, "inserted");
  const before = dbSnapshot(db);
  const audit = loadThoughtMapSourceAudit({ db });
  const after = dbSnapshot(db);
  assert.deepEqual(after, before);
  assert.equal(audit.nodes.conceptCount, 1);
  assert.equal(audit.nodes.observationCount, 1);
  assert.equal(audit.nodes.sessionCount, 2);
  assert.equal(audit.explicitEdges.conceptSessionCount, 1);
  assert.equal(audit.conceptSession[0]?.supportCount, 2);
  assert.equal(audit.explicitEdges.observationSessionCount, 2);
  assert.equal(audit.explicitEdges.observationObservationCount, 0);
  assert.equal(audit.explicitEdges.conceptConceptCount, 0);
  assert.equal(audit.explicitEdges.observationConceptCount, 0);
  assert.equal(audit.projectionB.edgeCount, 0);
  const serialized = `${JSON.stringify(audit)}\n${formatThoughtMapSourceAudit(audit)}`;
  assert.equal(serialized.includes(USER), false);
  const loadSource = readFileSync(
    resolve(process.cwd(), "lib/thought-map/source-audit-load.ts"),
    "utf8",
  );
  assert.doesNotMatch(loadSource, /\.insert\(/);
  assert.doesNotMatch(loadSource, /\.update\(/);
  assert.doesNotMatch(loadSource, /\.delete\(/);
  assert.doesNotMatch(loadSource, /getDb\(/);
});
