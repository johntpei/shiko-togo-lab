import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { toSessionRef } from "@/lib/ai/evidence-units";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { applySqlMigrations } from "@/lib/db/client";
import {
  countConceptOccurrences,
  countConcepts,
  insertConcept,
  insertConceptOccurrence,
} from "@/lib/db/concept-queries";
import { listObservationConceptRelations } from "@/lib/db/observation-concept-support-queries";
import { countObservations } from "@/lib/db/observation-queries";
import * as schema from "@/lib/db/schema";
import {
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_KIND,
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V1,
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V2,
} from "@/lib/observations/concept-evidence-supports";
import { reconcileObservationConceptEvidenceSupports } from "@/lib/observations/reconcile-concept-evidence-supports";
import { REVIEW_OBSERVATION_VERSION } from "@/lib/observations/types";
import { loadThoughtMap } from "./load";
import { buildThoughtMap } from "./map";
import {
  THOUGHT_MAP_EDGE_KIND,
  THOUGHT_MAP_VERSION,
  type ThoughtMap,
  type ThoughtMapConceptInput,
  type ThoughtMapObservationInput,
  type ThoughtMapRelationInput,
} from "./types";

const USER_QUOTE = "SECRET_USER_QUOTE_thought_map_v0";
const USER_SURFACE = "SECRET_SURFACE_FORM_thought_map_v0";
const LAYOUT_KEYS = [
  "x",
  "y",
  "vx",
  "vy",
  "radius",
  "color",
  "badgeColor",
  "chipClass",
  "nodeSize",
];
const SCORE_KEYS = [
  "density",
  "importance",
  "connectivity",
  "maturity",
  "weight",
  "strength",
  "confidence",
];

function concept(
  conceptId: string,
  canonicalLabel: string,
): ThoughtMapConceptInput {
  return { conceptId, canonicalLabel };
}

function observation(
  observationId: string,
  overrides?: Partial<ThoughtMapObservationInput>,
): ThoughtMapObservationInput {
  return {
    observationId,
    observationKind: "connection",
    title: observationId,
    summary: observationId,
    lastSeenAt: "2026-08-02",
    firstSeenAt: "2026-08-02",
    detectedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

function relation(
  observationId: string,
  conceptId: string,
  supportCount = 1,
  relationVersion = OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
): ThoughtMapRelationInput {
  return {
    observationId,
    conceptId,
    relationVersion,
    supportCount,
  };
}

function nodeKinds(map: ThoughtMap) {
  return map.nodes.map((node) => node.kind);
}

function emptyStats() {
  return {
    conceptNodeCount: 0,
    observationNodeCount: 0,
    edgeCount: 0,
    isolatedConceptCount: 0,
    isolatedObservationCount: 0,
  };
}

function assertNoLayout(value: unknown) {
  const json = JSON.stringify(value);
  for (const key of LAYOUT_KEYS) {
    assert.doesNotMatch(json, new RegExp(`"${key}"`));
  }
}

function assertNoScores(map: ThoughtMap) {
  assert.deepEqual(Object.keys(map.stats).sort(), [
    "conceptNodeCount",
    "edgeCount",
    "isolatedConceptCount",
    "isolatedObservationCount",
    "observationNodeCount",
  ]);
  const json = JSON.stringify(map);
  for (const key of SCORE_KEYS) {
    assert.doesNotMatch(json, new RegExp(`"${key}"`));
  }
}

function assertBipartite(map: ThoughtMap) {
  const conceptIds = new Set(
    map.nodes.filter((node) => node.kind === "concept").map((node) => node.conceptId),
  );
  const observationIds = new Set(
    map.nodes
      .filter((node) => node.kind === "observation")
      .map((node) => node.observationId),
  );
  for (const edge of map.edges) {
    assert.equal(edge.kind, THOUGHT_MAP_EDGE_KIND);
    assert.equal(edge.kind, OBSERVATION_CONCEPT_EVIDENCE_RELATION_KIND);
    assert.ok(observationIds.has(edge.observationId));
    assert.ok(conceptIds.has(edge.conceptId));
    assert.ok(!("source" in edge));
    assert.ok(!("target" in edge));
  }
}

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
      rawContent: USER_QUOTE,
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
    input.content ??
    "First exact evidence unit has enough content.\nSecond exact evidence unit has enough content.\nThird exact evidence unit has enough content.";
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
    title?: string;
    body?: string;
    lastSeenAt?: string;
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
      title: input.title ?? input.id,
      body: input.body ?? input.id,
      supportType: null,
      payload: scopeReviewEvidenceRefs(input.payload, sessionIndexById),
      firstSeenAt: "2026-08-02",
      lastSeenAt: input.lastSeenAt ?? "2026-08-02",
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

test("A. empty graph is valid", () => {
  const map = buildThoughtMap({
    concepts: [],
    observations: [],
    relations: [],
  });
  assert.equal(map.version, THOUGHT_MAP_VERSION);
  assert.deepEqual(map.nodes, []);
  assert.deepEqual(map.edges, []);
  assert.deepEqual(map.stats, emptyStats());
});

test("B. Concepts only → edges 0 / all isolated", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-2", "Beta"), concept("c-1", "Alpha")],
    observations: [],
    relations: [],
  });
  assert.equal(map.stats.conceptNodeCount, 2);
  assert.equal(map.stats.observationNodeCount, 0);
  assert.equal(map.stats.edgeCount, 0);
  assert.equal(map.stats.isolatedConceptCount, 2);
  assert.equal(map.stats.isolatedObservationCount, 0);
  assert.deepEqual(
    map.nodes.map((node) => node.kind === "concept" && node.conceptId),
    ["c-1", "c-2"],
  );
});

test("C. Observations only → edges 0 / all isolated", () => {
  const map = buildThoughtMap({
    concepts: [],
    observations: [
      observation("o-1", { lastSeenAt: "2026-08-01" }),
      observation("o-2", { lastSeenAt: "2026-08-10" }),
    ],
    relations: [],
  });
  assert.equal(map.stats.observationNodeCount, 2);
  assert.equal(map.stats.conceptNodeCount, 0);
  assert.equal(map.stats.edgeCount, 0);
  assert.equal(map.stats.isolatedObservationCount, 2);
  assert.deepEqual(
    map.nodes.map((node) => node.kind === "observation" && node.observationId),
    ["o-2", "o-1"],
  );
});

test("D. Concepts + Observations / no relation → all isolated", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha")],
    observations: [observation("o-1")],
    relations: [],
  });
  assert.equal(map.nodes.length, 2);
  assert.equal(map.edges.length, 0);
  assert.equal(map.stats.isolatedConceptCount, 1);
  assert.equal(map.stats.isolatedObservationCount, 1);
});

test("E. exact relation → 1 edge", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha")],
    observations: [observation("o-1")],
    relations: [relation("o-1", "c-1")],
  });
  assert.equal(map.nodes.length, 2);
  assert.equal(map.edges.length, 1);
  assert.equal(map.stats.isolatedConceptCount, 0);
  assert.equal(map.stats.isolatedObservationCount, 0);
  assert.deepEqual(map.edges[0], {
    kind: THOUGHT_MAP_EDGE_KIND,
    observationId: "o-1",
    conceptId: "c-1",
    relationVersion: OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
    supportCount: 1,
  });
});

test("F. one Observation multiple Concepts", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha"), concept("c-2", "Beta")],
    observations: [observation("o-1")],
    relations: [relation("o-1", "c-2"), relation("o-1", "c-1")],
  });
  assert.equal(map.nodes.length, 3);
  assert.equal(map.edges.length, 2);
  assert.deepEqual(
    map.edges.map((edge) => `${edge.observationId}:${edge.conceptId}`),
    ["o-1:c-1", "o-1:c-2"],
  );
});

test("G. one Concept multiple Observations", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha")],
    observations: [observation("o-1"), observation("o-2")],
    relations: [relation("o-2", "c-1"), relation("o-1", "c-1")],
  });
  assert.equal(map.nodes.length, 3);
  assert.equal(map.edges.length, 2);
  assert.deepEqual(
    map.edges.map((edge) => `${edge.observationId}:${edge.conceptId}`),
    ["o-1:c-1", "o-2:c-1"],
  );
});

test("H. multiple Evidence same pair → 1 edge / supportCount 2", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha")],
    observations: [observation("o-1")],
    relations: [relation("o-1", "c-1", 2)],
  });
  assert.equal(map.edges.length, 1);
  assert.equal(map.edges[0]?.supportCount, 2);
});

test("I. no Concept↔Concept edges", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha"), concept("c-2", "Beta")],
    observations: [observation("o-1")],
    relations: [relation("o-1", "c-1")],
  });
  assertBipartite(map);
  for (const edge of map.edges) {
    assert.notEqual(edge.observationId, edge.conceptId);
  }
});

test("J. no Observation↔Observation edges", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha")],
    observations: [observation("o-1"), observation("o-2")],
    relations: [relation("o-1", "c-1")],
  });
  assertBipartite(map);
  assert.equal(map.edges.length, 1);
});

test("K. no Session nodes", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha")],
    observations: [observation("o-1")],
    relations: [relation("o-1", "c-1")],
  });
  assert.deepEqual([...new Set(nodeKinds(map))].sort(), [
    "concept",
    "observation",
  ]);
  assert.doesNotMatch(JSON.stringify(map), /"session"/);
});

test("L. no ConceptOccurrence / Alias nodes", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha")],
    observations: [observation("o-1")],
    relations: [relation("o-1", "c-1")],
  });
  const json = JSON.stringify(map);
  assert.doesNotMatch(json, /conceptOccurrence/i);
  assert.doesNotMatch(json, /"alias"/i);
  assert.equal(map.nodes.filter((node) => node.kind === "concept").length, 1);
});

test("M. Tier B / shared session data alone does not create edges", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha")],
    observations: [observation("o-1")],
    relations: [],
  });
  assert.equal(map.edges.length, 0);
  assert.equal(map.stats.isolatedConceptCount, 1);
  assert.equal(map.stats.isolatedObservationCount, 1);
});

test("N. Tier C / same-message data alone does not create edges", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha")],
    observations: [observation("o-1")],
    relations: [],
  });
  assert.equal(map.edges.length, 0);
});

test("O. same-date alone does not create edges", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha")],
    observations: [
      observation("o-1", {
        lastSeenAt: "2026-08-02",
        firstSeenAt: "2026-08-02",
      }),
    ],
    relations: [],
  });
  assert.equal(map.edges.length, 0);
});

test("P. text equality alone does not create edges", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "ThemeA")],
    observations: [
      observation("o-1", { title: "ThemeA", summary: "ThemeA" }),
    ],
    relations: [],
  });
  assert.equal(map.edges.length, 0);
});

test("Q. deterministic node order ignores input order", () => {
  const forward = buildThoughtMap({
    concepts: [concept("c-2", "Beta"), concept("c-1", "Alpha")],
    observations: [
      observation("o-1", { lastSeenAt: "2026-08-01" }),
      observation("o-2", { lastSeenAt: "2026-08-10" }),
    ],
    relations: [],
  });
  const reverse = buildThoughtMap({
    concepts: [concept("c-1", "Alpha"), concept("c-2", "Beta")],
    observations: [
      observation("o-2", { lastSeenAt: "2026-08-10" }),
      observation("o-1", { lastSeenAt: "2026-08-01" }),
    ],
    relations: [],
  });
  assert.deepEqual(forward.nodes, reverse.nodes);
  assert.deepEqual(
    forward.nodes.map((node) =>
      node.kind === "concept" ? node.conceptId : node.observationId,
    ),
    ["c-1", "c-2", "o-2", "o-1"],
  );
});

test("R. deterministic edge order ignores input order", () => {
  const forward = buildThoughtMap({
    concepts: [concept("c-1", "Alpha"), concept("c-2", "Beta")],
    observations: [observation("o-1"), observation("o-2")],
    relations: [relation("o-2", "c-2"), relation("o-1", "c-1")],
  });
  const reverse = buildThoughtMap({
    concepts: [concept("c-2", "Beta"), concept("c-1", "Alpha")],
    observations: [observation("o-2"), observation("o-1")],
    relations: [relation("o-1", "c-1"), relation("o-2", "c-2")],
  });
  assert.deepEqual(forward.edges, reverse.edges);
  assert.deepEqual(
    forward.edges.map((edge) => `${edge.observationId}:${edge.conceptId}`),
    ["o-1:c-1", "o-2:c-2"],
  );
});

test("S. duplicate relation pair → 1 edge", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha")],
    observations: [observation("o-1")],
    relations: [relation("o-1", "c-1", 2), relation("o-1", "c-1", 9)],
  });
  assert.equal(map.edges.length, 1);
  assert.equal(map.edges[0]?.supportCount, 2);
});

test("T. supportCount < 1 is not an edge", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha")],
    observations: [observation("o-1")],
    relations: [relation("o-1", "c-1", 0), relation("o-1", "c-1", -1)],
  });
  assert.equal(map.edges.length, 0);
  assert.equal(map.stats.isolatedConceptCount, 1);
});

test("U. v1/v2 are supported; unrelated relationVersion is not absorbed", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha")],
    observations: [observation("o-1")],
    relations: [
      relation("o-1", "c-1", 1, "semantic-related-v1"),
      relation(
        "o-1",
        "c-1",
        1,
        OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V1,
      ),
      relation(
        "o-1",
        "c-1",
        1,
        OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V2,
      ),
    ],
  });
  assert.deepEqual(
    map.edges.map((edge) => edge.relationVersion),
    [
      OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V1,
      OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V2,
    ],
  );
});

test("V. missing endpoint does not invent nodes", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha")],
    observations: [observation("o-1")],
    relations: [relation("o-missing", "c-1"), relation("o-1", "c-missing")],
  });
  assert.equal(map.nodes.length, 2);
  assert.equal(map.edges.length, 0);
  assert.ok(!map.nodes.some((node) => JSON.stringify(node).includes("missing")));
});

test("W. USER text / quote / surfaceForm are not in the map model", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha")],
    observations: [
      observation("o-1", { title: "saved title", summary: "saved body" }),
    ],
    relations: [relation("o-1", "c-1")],
  });
  const json = JSON.stringify(map);
  assert.doesNotMatch(json, new RegExp(USER_QUOTE));
  assert.doesNotMatch(json, new RegExp(USER_SURFACE));
  assert.doesNotMatch(json, /"quote"/);
  assert.doesNotMatch(json, /surfaceForm/);
  assert.doesNotMatch(json, /"rawContent"/);
  const obs = map.nodes.find((node) => node.kind === "observation");
  assert.ok(obs && obs.kind === "observation");
  assert.equal(obs.summary, "saved body");
});

test("X. no layout fields", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha")],
    observations: [observation("o-1")],
    relations: [relation("o-1", "c-1")],
  });
  assertNoLayout(map);
});

test("Y. LLM = 0 in production map modules", () => {
  for (const file of [
    "lib/thought-map/types.ts",
    "lib/thought-map/map.ts",
    "lib/thought-map/load.ts",
  ]) {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(source, /from "openai"/);
    assert.doesNotMatch(source, /generateText|generateObject|streamText/);
    assert.doesNotMatch(source, /embedding/i);
  }
});

test("stats are raw counts only", () => {
  const map = buildThoughtMap({
    concepts: [concept("c-1", "Alpha"), concept("c-2", "Beta")],
    observations: [observation("o-1"), observation("o-2")],
    relations: [relation("o-1", "c-1")],
  });
  assertNoScores(map);
  assert.equal(map.stats.isolatedConceptCount, 1);
  assert.equal(map.stats.isolatedObservationCount, 1);
});

test("empty temp SQLite load is a valid empty map", () => {
  const db = openMemoryDb();
  const map = loadThoughtMap({ db });
  assert.equal(map.version, THOUGHT_MAP_VERSION);
  assert.deepEqual(map.nodes, []);
  assert.deepEqual(map.edges, []);
  assert.deepEqual(map.stats, emptyStats());
});

test("83/84. temp SQLite: reconciler → unique pairs → Thought Map v0", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "s-1");
  seedMessage(db, { id: "m-1", sessionId: "s-1" });
  seedConcept(db, "c-1", "ThemeA");
  seedConcept(db, "c-2", "ThemeB");
  seedObservation(db, {
    id: "o-1",
    payload: connectionPayload([
      evidence({
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
        quote: USER_QUOTE,
      }),
      evidence({
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E02",
        quote: USER_QUOTE,
      }),
    ]),
    sessionIds: ["s-1"],
    title: "saved o1 title",
    body: "saved o1 body",
  });
  seedObservation(db, {
    id: "o-2",
    payload: connectionPayload([
      evidence({
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E03",
        quote: USER_QUOTE,
      }),
    ]),
    sessionIds: ["s-1"],
    title: "saved o2 title",
    body: "saved o2 body",
    lastSeenAt: "2026-08-01",
  });
  seedOccurrence(db, {
    id: "occ-c1-e1",
    conceptId: "c-1",
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "M001:E01",
  });
  seedOccurrence(db, {
    id: "occ-c1-e2",
    conceptId: "c-1",
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "M001:E02",
  });
  seedOccurrence(db, {
    id: "occ-c2-e1",
    conceptId: "c-2",
    sessionId: "s-1",
    messageId: "m-1",
    evidenceRef: "M001:E01",
  });

  const reconciled = reconcileObservationConceptEvidenceSupports(
    { sessionIds: ["s-1"] },
    { db, now: () => "2026-08-23T00:00:00.000Z" },
  );
  assert.equal(reconciled.created, 3);
  assert.equal(reconciled.uniqueObservationConceptPairs, 2);

  const pairs = listObservationConceptRelations(db);
  assert.equal(pairs.length, 2);

  const conceptCount = countConcepts(db);
  const observationCount = countObservations(db);
  const occurrenceCount = countConceptOccurrences(db);
  const supportCount = db
    .select()
    .from(schema.observationConceptEvidenceSupports)
    .all().length;

  const map = loadThoughtMap({ db });

  assert.equal(countConcepts(db), conceptCount);
  assert.equal(countObservations(db), observationCount);
  assert.equal(countConceptOccurrences(db), occurrenceCount);
  assert.equal(
    db.select().from(schema.observationConceptEvidenceSupports).all().length,
    supportCount,
  );

  assert.equal(map.version, THOUGHT_MAP_VERSION);
  assert.equal(map.stats.conceptNodeCount, 2);
  assert.equal(map.stats.observationNodeCount, 2);
  assert.equal(map.stats.edgeCount, 2);
  assert.equal(map.stats.isolatedConceptCount, 0);
  assert.equal(map.stats.isolatedObservationCount, 1);

  const conceptIds = map.nodes
    .filter((node) => node.kind === "concept")
    .map((node) => node.conceptId);
  const observationIds = map.nodes
    .filter((node) => node.kind === "observation")
    .map((node) => node.observationId);
  assert.deepEqual(conceptIds, ["c-1", "c-2"]);
  assert.deepEqual(observationIds, ["o-1", "o-2"]);

  assert.deepEqual(
    map.edges.map((edge) => ({
      observationId: edge.observationId,
      conceptId: edge.conceptId,
      supportCount: edge.supportCount,
      relationVersion: edge.relationVersion,
      kind: edge.kind,
    })),
    [
      {
        observationId: "o-1",
        conceptId: "c-1",
        supportCount: 2,
        relationVersion: OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
        kind: THOUGHT_MAP_EDGE_KIND,
      },
      {
        observationId: "o-1",
        conceptId: "c-2",
        supportCount: 1,
        relationVersion: OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
        kind: THOUGHT_MAP_EDGE_KIND,
      },
    ],
  );

  const json = JSON.stringify(map);
  assert.doesNotMatch(json, new RegExp(USER_QUOTE));
  assert.doesNotMatch(json, new RegExp(USER_SURFACE));
  assert.doesNotMatch(json, /"sessionId"/);
  assert.doesNotMatch(json, /"messageId"/);
  assert.doesNotMatch(json, /"evidenceRef"/);
  assertNoLayout(map);
  assertNoScores(map);
  assertBipartite(map);
});

test("Z. loader is read-only and has no getDb fallback", () => {
  const loadSource = readFileSync(
    resolve(process.cwd(), "lib/thought-map/load.ts"),
    "utf8",
  );
  const mapSource = readFileSync(
    resolve(process.cwd(), "lib/thought-map/map.ts"),
    "utf8",
  );
  assert.doesNotMatch(loadSource, /getDb\(/);
  assert.doesNotMatch(mapSource, /getDb\(/);
  assert.match(loadSource, /listObservationConceptRelations/);
  assert.match(loadSource, /observationFromRecord/);
  assert.match(loadSource, /listConcepts/);
  assert.doesNotMatch(loadSource, /insert\(/);
  assert.doesNotMatch(loadSource, /reconcileObservationConceptEvidenceSupports/);
});
