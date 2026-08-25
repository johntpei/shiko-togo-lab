import assert from "node:assert/strict";
import test from "node:test";
import { layoutThoughtMap } from "./layout";
import type {
  ThoughtMapPresentationEdge,
  ThoughtMapPresentationNode,
} from "./presentation";

function fixture(count = 2): {
  nodes: ThoughtMapPresentationNode[];
  edges: ThoughtMapPresentationEdge[];
} {
  const concepts: ThoughtMapPresentationNode[] = Array.from(
    { length: count },
    (_, index) => ({
      id: `concept-${index + 1}`,
      kind: "concept",
      label: `テーマ${index + 1}`,
      neighborIds: [`observation-${index + 1}`],
    }),
  );
  const observations: ThoughtMapPresentationNode[] = Array.from(
    { length: count },
    (_, index) => ({
      id: `observation-${index + 1}`,
      kind: "observation",
      observationKind: "connection",
      kindLabel: "接続",
      title: `観測${index + 1}`,
      summary: `要約${index + 1}`,
      neighborIds: [`concept-${index + 1}`],
    }),
  );
  const edges = Array.from({ length: count }, (_, index) => ({
    id: `edge-${index + 1}`,
    conceptNodeId: `concept-${index + 1}`,
    observationNodeId: `observation-${index + 1}`,
    supportCount: 1,
  }));
  return { nodes: [...concepts, ...observations], edges };
}

test("layout is deterministic and places Concepts left of Observations", () => {
  const input = fixture();
  const first = layoutThoughtMap(input);
  const second = layoutThoughtMap(input);
  assert.deepEqual(first, second);

  const concepts = first.nodes.filter((node) => node.kind === "concept");
  const observations = first.nodes.filter(
    (node) => node.kind === "observation",
  );
  assert.ok(
    Math.max(...concepts.map((node) => node.x + node.width)) <
      Math.min(...observations.map((node) => node.x)),
  );
});

test("nodes do not overlap within either deterministic column", () => {
  const layout = layoutThoughtMap(fixture(6));
  for (const kind of ["concept", "observation"] as const) {
    const nodes = layout.nodes
      .filter((node) => node.kind === kind)
      .sort((left, right) => left.y - right.y);
    for (let index = 1; index < nodes.length; index += 1) {
      const previous = nodes[index - 1]!;
      const current = nodes[index]!;
      assert.ok(previous.y + previous.height < current.y);
    }
  }
});

test("canvas grows vertically for moderate node counts", () => {
  const small = layoutThoughtMap(fixture(2));
  const large = layoutThoughtMap(fixture(25));
  assert.ok(large.height > small.height);
  assert.equal(large.width, small.width);
});

test("edge endpoints terminate on the correct node boundaries", () => {
  const layout = layoutThoughtMap(fixture());
  const nodeById = new Map(layout.nodes.map((node) => [node.nodeId, node]));
  for (const edge of layout.edges) {
    const concept = nodeById.get(edge.conceptNodeId)!;
    const observation = nodeById.get(edge.observationNodeId)!;
    assert.equal(edge.x1, concept.x + concept.width);
    assert.equal(edge.y1, concept.y + concept.height / 2);
    assert.equal(edge.x2, observation.x);
    assert.equal(edge.y2, observation.y + observation.height / 2);
  }
});
