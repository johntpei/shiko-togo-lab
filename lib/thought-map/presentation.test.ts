import assert from "node:assert/strict";
import test from "node:test";
import {
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V1,
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V2,
} from "@/lib/observations/concept-evidence-supports";
import { THOUGHT_MAP_EDGE_KIND, THOUGHT_MAP_VERSION } from "./types";
import { buildThoughtMapPresentation } from "./presentation";
import type { ThoughtMap } from "./types";

function realTopologyFixture(): ThoughtMap {
  return {
    version: THOUGHT_MAP_VERSION,
    nodes: [
      {
        kind: "concept",
        conceptId: "SECRET_CONCEPT_UUID_1",
        canonicalLabel: "テーマA",
      },
      {
        kind: "concept",
        conceptId: "SECRET_CONCEPT_UUID_2",
        canonicalLabel: "テーマB",
      },
      {
        kind: "concept",
        conceptId: "SECRET_ISOLATED_CONCEPT_UUID",
        canonicalLabel: "未接続テーマ",
      },
      {
        kind: "observation",
        observationId: "SECRET_OBSERVATION_UUID_1",
        observationKind: "connection",
        title: "観測A",
        summary: "観測Aの要約",
      },
      {
        kind: "observation",
        observationId: "SECRET_OBSERVATION_UUID_2",
        observationKind: "tension",
        title: "観測B",
        summary: "観測Bの要約",
      },
      {
        kind: "observation",
        observationId: "SECRET_ISOLATED_OBSERVATION_UUID",
        observationKind: "shift",
        title: "未接続観測",
        summary: "未接続観測の要約",
      },
    ],
    edges: [
      {
        kind: THOUGHT_MAP_EDGE_KIND,
        conceptId: "SECRET_CONCEPT_UUID_1",
        observationId: "SECRET_OBSERVATION_UUID_1",
        relationVersion: OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V2,
        supportCount: 1,
      },
      {
        kind: THOUGHT_MAP_EDGE_KIND,
        conceptId: "SECRET_CONCEPT_UUID_1",
        observationId: "SECRET_OBSERVATION_UUID_2",
        relationVersion: OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V2,
        supportCount: 1,
      },
      {
        kind: THOUGHT_MAP_EDGE_KIND,
        conceptId: "SECRET_CONCEPT_UUID_2",
        observationId: "SECRET_OBSERVATION_UUID_2",
        relationVersion: OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V2,
        supportCount: 1,
      },
    ],
    stats: {
      conceptNodeCount: 3,
      observationNodeCount: 3,
      edgeCount: 3,
      isolatedConceptCount: 1,
      isolatedObservationCount: 1,
    },
  };
}

test("real topology presentation keeps only connected primary nodes and truthful totals", () => {
  const model = buildThoughtMapPresentation(realTopologyFixture());

  assert.equal(model.nodes.length, 4);
  assert.equal(model.nodes.filter((node) => node.kind === "concept").length, 2);
  assert.equal(
    model.nodes.filter((node) => node.kind === "observation").length,
    2,
  );
  assert.equal(model.edges.length, 3);
  assert.deepEqual(model.counts, {
    totalConcepts: 3,
    totalObservations: 3,
    connectedConcepts: 2,
    connectedObservations: 2,
    unconnectedConcepts: 1,
    unconnectedObservations: 1,
    edges: 3,
  });
  assert.doesNotMatch(JSON.stringify(model), /SECRET_.*UUID/);
  assert.doesNotMatch(JSON.stringify(model), /relationVersion/);
});

test("presentation builds exact neighbor relationships without inventing edges", () => {
  const model = buildThoughtMapPresentation(realTopologyFixture());
  const conceptA = model.nodes.find(
    (node) => node.kind === "concept" && node.label === "テーマA",
  );
  const conceptB = model.nodes.find(
    (node) => node.kind === "concept" && node.label === "テーマB",
  );
  assert.ok(conceptA && conceptA.kind === "concept");
  assert.ok(conceptB && conceptB.kind === "concept");
  assert.equal(conceptA.neighborIds.length, 2);
  assert.equal(conceptB.neighborIds.length, 1);
  assert.deepEqual(
    model.relationships.map((relationship) =>
      relationship.observationNodeIds.length,
    ),
    [2, 1],
  );
  assert.equal(
    new Set(
      model.edges.map(
        (edge) => `${edge.conceptNodeId}:${edge.observationNodeId}`,
      ),
    ).size,
    3,
  );
});

test("multi-support remains one unweighted presentation edge", () => {
  const map = realTopologyFixture();
  map.edges = [
    {
      ...map.edges[0]!,
      supportCount: 7,
    },
  ];
  map.stats.edgeCount = 1;
  map.stats.isolatedConceptCount = 2;
  map.stats.isolatedObservationCount = 2;

  const model = buildThoughtMapPresentation(map);
  assert.equal(model.edges.length, 1);
  assert.equal(model.edges[0]?.supportCount, 7);
});

test("v1 and v2 read-model edges remain distinct while relationships dedupe neighbors", () => {
  const map = realTopologyFixture();
  map.nodes = [map.nodes[0]!, map.nodes[3]!];
  map.edges = [
    {
      ...map.edges[0]!,
      relationVersion: OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V1,
    },
    {
      ...map.edges[0]!,
      relationVersion: OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V2,
    },
  ];
  map.stats = {
    conceptNodeCount: 1,
    observationNodeCount: 1,
    edgeCount: 2,
    isolatedConceptCount: 0,
    isolatedObservationCount: 0,
  };

  const model = buildThoughtMapPresentation(map);
  assert.equal(model.edges.length, 2);
  assert.equal(model.relationships[0]?.observationNodeIds.length, 1);
});

test("empty and isolated-only maps become valid empty primary presentations", () => {
  const empty = buildThoughtMapPresentation({
    version: THOUGHT_MAP_VERSION,
    nodes: [],
    edges: [],
    stats: {
      conceptNodeCount: 0,
      observationNodeCount: 0,
      edgeCount: 0,
      isolatedConceptCount: 0,
      isolatedObservationCount: 0,
    },
  });
  assert.deepEqual(empty.nodes, []);
  assert.deepEqual(empty.edges, []);
  assert.deepEqual(empty.relationships, []);

  const fixture = realTopologyFixture();
  fixture.edges = [];
  fixture.stats.edgeCount = 0;
  fixture.stats.isolatedConceptCount = 3;
  fixture.stats.isolatedObservationCount = 3;
  const isolated = buildThoughtMapPresentation(fixture);
  assert.deepEqual(isolated.nodes, []);
  assert.deepEqual(isolated.edges, []);
  assert.equal(isolated.counts.unconnectedConcepts, 3);
  assert.equal(isolated.counts.unconnectedObservations, 3);
});
