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
  PROVENANCE_MATCH_TIERS,
  THOUGHT_MAP_PROVENANCE_JOIN_AUDIT_VERSION,
  buildThoughtMapProvenanceJoinAudit,
  extractObservationEvidenceAnchors,
  formatThoughtMapProvenanceJoinAudit,
  type ThoughtMapProvenanceJoinAuditInput,
} from "./provenance-join-audit";
import { loadThoughtMapProvenanceJoinAudit } from "./provenance-join-audit-load";

const USER =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const QUOTE = "SECRET_USER_EVIDENCE_QUOTE_provenance_join";

function emptyInput(): ThoughtMapProvenanceJoinAuditInput {
  return {
    concepts: [],
    observations: [],
    conceptOccurrences: [],
  };
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
    occurredAt: "2026-08-02",
    role: "user",
    ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
  };
}

function connectionPayload(
  items: Array<ReturnType<typeof evidence>>,
  extras: Record<string, unknown> = {},
) {
  return JSON.stringify({
    text: USER,
    evidence: items,
    semanticValid: true,
    relationType: "complement",
    ...extras,
  });
}

function tensionPayload(input: {
  primary?: Array<ReturnType<typeof evidence>>;
  sideA?: Array<ReturnType<typeof evidence>>;
  sideB?: Array<ReturnType<typeof evidence>>;
}) {
  return JSON.stringify({
    text: USER,
    evidence: input.primary ?? [],
    semanticValid: true,
    sideA: { text: "side A", evidence: input.sideA ?? [] },
    sideB: { text: "side B", evidence: input.sideB ?? [] },
  });
}

function shiftPayload(input: {
  before?: Array<ReturnType<typeof evidence>>;
  after?: Array<ReturnType<typeof evidence>>;
}) {
  return JSON.stringify({
    text: USER,
    evidence: [],
    semanticValid: true,
    before: "以前の考え",
    after: "いまの考え",
    interpretation: USER,
    beforeEvidence: input.before ?? [],
    afterEvidence: input.after ?? [],
  });
}

function occurrence(input: {
  conceptId: string;
  sessionId: string;
  messageId: string;
  evidenceRef: string;
}) {
  return input;
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
  input: { id: string; kind: string; payload: string; sessionIds: string[] },
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

test("A. empty → match 0", () => {
  const audit = buildThoughtMapProvenanceJoinAudit(emptyInput());
  assert.equal(audit.version, THOUGHT_MAP_PROVENANCE_JOIN_AUDIT_VERSION);
  assert.equal(audit.counts.uniqueObservationConceptPairs, 0);
  assert.equal(audit.counts.tierAMatchCount, 0);
  assert.equal(audit.counts.tierBOnlyMatchCount, 0);
  assert.equal(audit.projectionC.edgeCount, 0);
  assert.equal(audit.projectionD.edgeCount, 0);
  assert.equal(audit.contract.tierA.possibleFromContract, false);
  assert.equal(audit.contract.observationHasEvidenceRef, false);
});

test("B. extra Observation evidenceRef is not invented into Tier A", () => {
  const audit = buildThoughtMapProvenanceJoinAudit({
    concepts: [{ conceptId: "c-1" }],
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
      occurrence({
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      }),
    ],
  });
  assert.equal(audit.counts.tierAMatchCount, 0);
  assert.equal(audit.counts.tierBOnlyMatchCount, 1);
  assert.equal(
    audit.matches[0]?.strongestTier,
    PROVENANCE_MATCH_TIERS.exactMessageAnchor,
  );
  assert.equal(audit.contract.uniqueEvidenceIdentity.sharedExactEvidenceKey, false);
});

test("C. same message / different EvidenceRef stays Tier B, not Tier A", () => {
  const audit = buildThoughtMapProvenanceJoinAudit({
    concepts: [{ conceptId: "c-1" }],
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
      occurrence({
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      }),
      occurrence({
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E02",
      }),
    ],
  });
  assert.equal(audit.counts.uniqueObservationConceptPairs, 1);
  assert.equal(audit.counts.tierAMatchCount, 0);
  assert.equal(
    audit.matches[0]?.strongestTier,
    PROVENANCE_MATCH_TIERS.exactMessageAnchor,
  );
  assert.equal(audit.matches[0]?.supportCount, 2);
});

test("D. same Session only → no pair", () => {
  const audit = buildThoughtMapProvenanceJoinAudit({
    concepts: [{ conceptId: "c-1" }],
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload([
          evidence({ sessionId: "s-1", messageId: "m-obs" }),
        ]),
      },
    ],
    conceptOccurrences: [
      occurrence({
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-concept",
        evidenceRef: "M001:E01",
      }),
    ],
  });
  assert.equal(audit.counts.uniqueObservationConceptPairs, 0);
  assert.equal(audit.counts.sessionOnlyOverlapPairCount, 1);
});

test("E. same date only → no pair", () => {
  const audit = buildThoughtMapProvenanceJoinAudit({
    concepts: [{ conceptId: "c-1" }],
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload([
          evidence({ sessionId: "s-obs", messageId: "m-obs" }),
        ]),
      },
    ],
    conceptOccurrences: [
      occurrence({
        conceptId: "c-1",
        sessionId: "s-concept",
        messageId: "m-concept",
        evidenceRef: "M001:E01",
      }),
    ],
  });
  assert.equal(audit.counts.uniqueObservationConceptPairs, 0);
  assert.equal(audit.counts.sessionOnlyOverlapPairCount, 0);
});

test("F. matching text only → no pair", () => {
  const audit = buildThoughtMapProvenanceJoinAudit({
    concepts: [{ conceptId: "c-1" }],
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload([
          evidence({
            sessionId: "s-obs",
            messageId: "m-obs",
            quote: USER,
          }),
        ]),
      },
    ],
    conceptOccurrences: [
      occurrence({
        conceptId: "c-1",
        sessionId: "s-concept",
        messageId: "m-concept",
        evidenceRef: "M001:E01",
      }),
    ],
  });
  assert.equal(audit.counts.uniqueObservationConceptPairs, 0);
});

test("G. multiple Concepts on the same message → multiple pairs", () => {
  const audit = buildThoughtMapProvenanceJoinAudit({
    concepts: [{ conceptId: "c-2" }, { conceptId: "c-1" }],
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
      occurrence({
        conceptId: "c-2",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E02",
      }),
      occurrence({
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      }),
    ],
  });
  assert.equal(audit.counts.uniqueObservationConceptPairs, 2);
  assert.deepEqual(
    audit.matches.map((match) => match.conceptId),
    ["c-1", "c-2"],
  );
});

test("H. multiple matching anchors for the same pair → 1 pair + supportCount", () => {
  const audit = buildThoughtMapProvenanceJoinAudit({
    concepts: [{ conceptId: "c-1" }],
    observations: [
      {
        observationId: "obs-1",
        kind: "tension",
        payload: tensionPayload({
          primary: [evidence({ sessionId: "s-1", messageId: "m-1" })],
          sideA: [evidence({ sessionId: "s-1", messageId: "m-1" })],
        }),
      },
    ],
    conceptOccurrences: [
      occurrence({
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      }),
    ],
  });
  assert.equal(audit.counts.uniqueObservationConceptPairs, 1);
  assert.equal(audit.matches[0]?.supportCount, 2);
});

test("I. same pair is not duplicated across anchors", () => {
  const audit = buildThoughtMapProvenanceJoinAudit({
    concepts: [{ conceptId: "c-1" }],
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload([
          evidence({ sessionId: "s-1", messageId: "m-1" }),
          evidence({ sessionId: "s-1", messageId: "m-1" }),
        ]),
      },
    ],
    conceptOccurrences: [
      occurrence({
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      }),
    ],
  });
  assert.equal(audit.matches.length, 1);
  assert.equal(
    audit.matches[0]?.strongestTier,
    PROVENANCE_MATCH_TIERS.exactMessageAnchor,
  );
  assert.equal(audit.counts.tierAMatchCount, 0);
});

test("J. Observation with no match is isolated", () => {
  const audit = buildThoughtMapProvenanceJoinAudit({
    concepts: [{ conceptId: "c-1" }],
    observations: [
      {
        observationId: "obs-1",
        kind: "connection",
        payload: connectionPayload([
          evidence({ sessionId: "s-obs", messageId: "m-obs" }),
        ]),
      },
    ],
    conceptOccurrences: [
      occurrence({
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      }),
    ],
  });
  assert.equal(audit.coverage.observationsWith0Concepts, 1);
  assert.equal(audit.projectionD.isolatedObservations, 1);
});

test("K. Concept with no match is isolated", () => {
  const audit = buildThoughtMapProvenanceJoinAudit({
    concepts: [{ conceptId: "c-1" }, { conceptId: "c-2" }],
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
      occurrence({
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      }),
    ],
  });
  assert.equal(audit.coverage.conceptsMatchedToObservation, 1);
  assert.equal(audit.coverage.conceptsUnmatched, 1);
  assert.equal(audit.projectionD.isolatedConcepts, 1);
});

test("L. Tension side evidence is flattened from existing locators only", () => {
  const anchors = extractObservationEvidenceAnchors({
    observationId: "obs-t",
    kind: "tension",
    payload: tensionPayload({
      sideA: [evidence({ sessionId: "s-a", messageId: "m-a" })],
      sideB: [evidence({ sessionId: "s-b", messageId: "m-b" })],
    }),
  });
  assert.deepEqual(
    anchors.map((anchor) => [
      anchor.evidenceRole,
      anchor.sessionId,
      anchor.messageId,
      anchor.evidenceRef,
    ]),
    [
      ["side_a", "s-a", "m-a", null],
      ["side_b", "s-b", "m-b", null],
    ],
  );
});

test("M. Connection top-level evidence is audited without sideA/sideB", () => {
  const anchors = extractObservationEvidenceAnchors({
    observationId: "obs-c",
    kind: "connection",
    payload: connectionPayload([
      evidence({ sessionId: "s-1", messageId: "m-1" }),
    ]),
  });
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0]?.evidenceRole, "primary");
  assert.equal(anchors[0]?.hasEvidenceRef, false);
});

test("N. Shift contract uses beforeEvidence / afterEvidence locators only", () => {
  const anchors = extractObservationEvidenceAnchors({
    observationId: "obs-s",
    kind: "shift",
    payload: shiftPayload({
      before: [evidence({ sessionId: "s-1", messageId: "m-before" })],
      after: [evidence({ sessionId: "s-1", messageId: "m-after" })],
    }),
  });
  assert.deepEqual(
    anchors.map((anchor) => anchor.evidenceRole),
    ["before", "after"],
  );
  assert.equal(
    anchors.every((anchor) => anchor.hasEvidenceRef === false),
    true,
  );
});

test("O. no text matching", () => {
  const source = readFileSync(
    resolve(process.cwd(), "lib/thought-map/provenance-join-audit.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /quoteExistsInContent/);
  assert.doesNotMatch(source, /normalizeForQuoteMatch/);
  assert.doesNotMatch(source, /\.quote\s*===/);
});

test("P. no semantic matching", () => {
  const files = [
    "lib/thought-map/provenance-join-audit.ts",
    "lib/thought-map/provenance-join-audit-load.ts",
  ];
  for (const file of files) {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(source, /from "openai"/);
    assert.doesNotMatch(source, /embedding/);
    assert.doesNotMatch(source, /similarity/);
    assert.doesNotMatch(source, /recently_observed/);
    assert.doesNotMatch(source, /cross_session_recurrence/);
  }
});

test("Q. loader is SELECT-only and does not mutate the DB", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "session-a");
  seedMessage(db, { id: "m-a", sessionId: "session-a" });
  seedObservation(db, {
    id: "obs-1",
    kind: "connection",
    payload: connectionPayload([
      evidence({
        sessionId: "session-a",
        messageId: "m-a",
        quote: QUOTE,
      }),
    ]),
    sessionIds: ["session-a"],
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
  const inserted = insertConceptOccurrence(
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
  assert.equal(inserted.status, "inserted");
  const before = {
    observations: countObservations(db),
    concepts: countConcepts(db),
    occurrences: countConceptOccurrences(db),
  };
  const audit = loadThoughtMapProvenanceJoinAudit({ db });
  const after = {
    observations: countObservations(db),
    concepts: countConcepts(db),
    occurrences: countConceptOccurrences(db),
  };
  assert.deepEqual(after, before);
  assert.equal(audit.counts.tierBOnlyMatchCount, 1);
  const loadSource = readFileSync(
    resolve(process.cwd(), "lib/thought-map/provenance-join-audit-load.ts"),
    "utf8",
  );
  assert.doesNotMatch(loadSource, /\.insert\(/);
  assert.doesNotMatch(loadSource, /\.update\(/);
  assert.doesNotMatch(loadSource, /\.delete\(/);
  assert.doesNotMatch(loadSource, /getDb\(/);
});

test("R. serialized audit has no USER content", () => {
  const audit = buildThoughtMapProvenanceJoinAudit({
    concepts: [{ conceptId: "c-1" }],
    observations: [
      {
        observationId: "obs-1",
        kind: "tension",
        payload: tensionPayload({
          primary: [
            evidence({
              sessionId: "s-1",
              messageId: "m-1",
              quote: QUOTE,
            }),
          ],
          sideA: [evidence({ sessionId: "s-1", messageId: "m-1", quote: USER })],
        }),
      },
    ],
    conceptOccurrences: [
      occurrence({
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E01",
      }),
    ],
  });
  const serialized = `${JSON.stringify(audit)}\n${formatThoughtMapProvenanceJoinAudit(audit)}`;
  assert.equal(serialized.includes(USER), false);
  assert.equal(serialized.includes(QUOTE), false);
  assert.equal(serialized.includes("surfaceForm"), false);
});

test("deterministic vs input order", () => {
  const base: ThoughtMapProvenanceJoinAuditInput = {
    concepts: [{ conceptId: "c-b" }, { conceptId: "c-a" }],
    observations: [
      {
        observationId: "obs-b",
        kind: "connection",
        payload: connectionPayload([
          evidence({ sessionId: "s-1", messageId: "m-b" }),
        ]),
      },
      {
        observationId: "obs-a",
        kind: "connection",
        payload: connectionPayload([
          evidence({ sessionId: "s-1", messageId: "m-a" }),
        ]),
      },
    ],
    conceptOccurrences: [
      occurrence({
        conceptId: "c-b",
        sessionId: "s-1",
        messageId: "m-b",
        evidenceRef: "M002:E01",
      }),
      occurrence({
        conceptId: "c-a",
        sessionId: "s-1",
        messageId: "m-a",
        evidenceRef: "M001:E01",
      }),
    ],
  };
  const reversed: ThoughtMapProvenanceJoinAuditInput = {
    concepts: [...base.concepts].reverse(),
    observations: [...base.observations].reverse(),
    conceptOccurrences: [...base.conceptOccurrences].reverse(),
  };
  assert.deepEqual(
    buildThoughtMapProvenanceJoinAudit(base),
    buildThoughtMapProvenanceJoinAudit(reversed),
  );
});
