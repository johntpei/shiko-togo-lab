import type {
  ThoughtMapPresentationEdge,
  ThoughtMapPresentationNode,
} from "./presentation";

const CANVAS_WIDTH = 760;
const MIN_CANVAS_HEIGHT = 360;
const HORIZONTAL_PADDING = 32;
const TOP_PADDING = 64;
const BOTTOM_PADDING = 32;
const NODE_GAP = 28;
const CONCEPT_WIDTH = 232;
const CONCEPT_HEIGHT = 76;
const OBSERVATION_WIDTH = 248;
const OBSERVATION_HEIGHT = 96;

export type ThoughtMapLayoutNode = {
  nodeId: string;
  kind: "concept" | "observation";
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ThoughtMapLayoutEdge = {
  edgeId: string;
  conceptNodeId: string;
  observationNodeId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type ThoughtMapLayout = {
  width: number;
  height: number;
  columns: {
    concept: { x: number; width: number };
    observation: { x: number; width: number };
  };
  nodes: ThoughtMapLayoutNode[];
  edges: ThoughtMapLayoutEdge[];
};

function columnHeight(count: number, nodeHeight: number) {
  if (count === 0) {
    return 0;
  }
  return count * nodeHeight + (count - 1) * NODE_GAP;
}

function positionColumn(input: {
  nodes: ThoughtMapPresentationNode[];
  kind: "concept" | "observation";
  x: number;
  width: number;
  height: number;
  canvasHeight: number;
}) {
  const contentHeight = columnHeight(input.nodes.length, input.height);
  const availableHeight = input.canvasHeight - TOP_PADDING - BOTTOM_PADDING;
  const startY = TOP_PADDING + Math.max(0, (availableHeight - contentHeight) / 2);
  return input.nodes.map<ThoughtMapLayoutNode>((node, index) => ({
    nodeId: node.id,
    kind: input.kind,
    x: input.x,
    y: startY + index * (input.height + NODE_GAP),
    width: input.width,
    height: input.height,
  }));
}

export function layoutThoughtMap(input: {
  nodes: ThoughtMapPresentationNode[];
  edges: ThoughtMapPresentationEdge[];
}): ThoughtMapLayout {
  const concepts = input.nodes.filter((node) => node.kind === "concept");
  const observations = input.nodes.filter(
    (node) => node.kind === "observation",
  );
  const tallestColumn = Math.max(
    columnHeight(concepts.length, CONCEPT_HEIGHT),
    columnHeight(observations.length, OBSERVATION_HEIGHT),
  );
  const height = Math.max(
    MIN_CANVAS_HEIGHT,
    TOP_PADDING + tallestColumn + BOTTOM_PADDING,
  );
  const conceptX = HORIZONTAL_PADDING;
  const observationX = CANVAS_WIDTH - HORIZONTAL_PADDING - OBSERVATION_WIDTH;
  const nodes = [
    ...positionColumn({
      nodes: concepts,
      kind: "concept",
      x: conceptX,
      width: CONCEPT_WIDTH,
      height: CONCEPT_HEIGHT,
      canvasHeight: height,
    }),
    ...positionColumn({
      nodes: observations,
      kind: "observation",
      x: observationX,
      width: OBSERVATION_WIDTH,
      height: OBSERVATION_HEIGHT,
      canvasHeight: height,
    }),
  ];
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  const edges = input.edges.flatMap<ThoughtMapLayoutEdge>((edge) => {
    const concept = nodeById.get(edge.conceptNodeId);
    const observation = nodeById.get(edge.observationNodeId);
    if (!concept || !observation) {
      return [];
    }
    return [
      {
        edgeId: edge.id,
        conceptNodeId: edge.conceptNodeId,
        observationNodeId: edge.observationNodeId,
        x1: concept.x + concept.width,
        y1: concept.y + concept.height / 2,
        x2: observation.x,
        y2: observation.y + observation.height / 2,
      },
    ];
  });

  return {
    width: CANVAS_WIDTH,
    height,
    columns: {
      concept: { x: conceptX, width: CONCEPT_WIDTH },
      observation: { x: observationX, width: OBSERVATION_WIDTH },
    },
    nodes,
    edges,
  };
}
