import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { INTEGRATED_REVIEW_MAX_INPUT_CHARS } from "@/lib/ai/limits";
import { parseStoredReviewPayload } from "@/lib/ai/review-schemas";
import {
  PROVENANCE_MATCH_TIERS,
  buildThoughtMapProvenanceJoinAudit,
  extractObservationEvidenceAnchors,
} from "@/lib/thought-map/provenance-join-audit";

function storedPayload(evidence: Record<string, unknown>) {
  return {
    summary: "summary",
    commonThemes: [],
    shifts: [],
    tensions: [],
    crossInsights: [
      {
        text: "connection",
        evidence: [evidence],
        semanticValid: true,
      },
    ],
    hypotheses: [],
    openQuestions: [],
    nextQuestions: [],
    settings: {
      provider: "openai",
      store: false as const,
      maxInputChars: INTEGRATED_REVIEW_MAX_INPUT_CHARS,
    },
  };
}

test("D/E. old StoredReviewEvidence without evidenceRef still parses", () => {
  const parsed = parseStoredReviewPayload(
    JSON.stringify(
      storedPayload({
        messageRef: "S01:M001:E01",
        quote: "x",
        validated: true,
        messageId: "m-1",
        sessionId: "s-1",
      }),
    ),
  );
  assert.ok(parsed);
  assert.equal(parsed.crossInsights[0]?.evidence[0]?.evidenceRef, undefined);
});

test("D. new StoredReviewEvidence round-trip keeps evidenceRef", () => {
  const parsed = parseStoredReviewPayload(
    JSON.stringify(
      storedPayload({
        messageRef: "S01:M001:E01",
        quote: "x",
        validated: true,
        messageId: "m-1",
        sessionId: "s-1",
        evidenceRef: "S01:M001:E01",
      }),
    ),
  );
  assert.ok(parsed);
  assert.equal(
    parsed.crossInsights[0]?.evidence[0]?.evidenceRef,
    "S01:M001:E01",
  );
  const again = parseStoredReviewPayload(JSON.stringify(parsed));
  assert.equal(
    again?.crossInsights[0]?.evidence[0]?.evidenceRef,
    "S01:M001:E01",
  );
});

test("N. prospective Tier A when Observation and ConceptOccurrence share identity", () => {
  const payload = JSON.stringify({
    text: "connection",
    evidence: [
      {
        messageRef: "M001",
        quote: "x",
        validated: true,
        messageId: "m-1",
        sessionId: "s-1",
        evidenceRef: "M001:E02",
      },
    ],
    semanticValid: true,
  });
  const anchors = extractObservationEvidenceAnchors({
    observationId: "obs-1",
    kind: "connection",
    payload,
  });
  assert.equal(anchors[0]?.sessionId, "s-1");
  assert.equal(anchors[0]?.messageId, "m-1");
  assert.equal(anchors[0]?.evidenceRef, "M001:E02");

  const audit = buildThoughtMapProvenanceJoinAudit({
    concepts: [{ conceptId: "c-1" }],
    observations: [{ observationId: "obs-1", kind: "connection", payload }],
    conceptOccurrences: [
      {
        conceptId: "c-1",
        sessionId: "s-1",
        messageId: "m-1",
        evidenceRef: "M001:E02",
      },
    ],
  });
  assert.equal(audit.counts.tierAMatchCount, 1);
  assert.equal(
    audit.matches[0]?.strongestTier,
    PROVENANCE_MATCH_TIERS.exactEvidenceAnchor,
  );
});

test("R. no observation_concepts table or relation writer", () => {
  const schema = readFileSync(resolve(process.cwd(), "lib/db/schema.ts"), "utf8");
  assert.equal(schema.includes("observation_concepts"), false);
  assert.equal(schema.includes("observationConcepts"), false);
  const projectReview = readFileSync(
    resolve(process.cwd(), "lib/observations/project-review.ts"),
    "utf8",
  );
  assert.doesNotMatch(projectReview, /insertObservationConcept/);
});
