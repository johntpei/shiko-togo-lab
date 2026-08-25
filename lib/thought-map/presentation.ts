import type { ReviewObservationKind } from "@/lib/observations/types";
import type {
  ThoughtMap,
  ThoughtMapConceptNode,
  ThoughtMapObservationNode,
} from "./types";

export const THOUGHT_MAP_PRESENTATION_COPY = {
  eyebrow: "観測",
  title: "思考マップ",
  description:
    "観測された気づきや変化が、どの思考テーマとつながっているかを見渡します。",
  trust: "実際の発言を根拠に確認できたつながりだけを表示しています。",
  emptyTitle: "まだ、テーマと観測のつながりは確認されていません。",
  emptyBody:
    "対話やレビューが蓄積されると、実際の発言を根拠にしたつながりがここに現れます。",
} as const;

export type ThoughtMapPresentationConceptNode = {
  id: string;
  kind: "concept";
  label: string;
  neighborIds: string[];
};

export type ThoughtMapPresentationObservationNode = {
  id: string;
  kind: "observation";
  observationKind: ReviewObservationKind;
  kindLabel: string;
  title: string;
  summary: string;
  neighborIds: string[];
};

export type ThoughtMapPresentationNode =
  | ThoughtMapPresentationConceptNode
  | ThoughtMapPresentationObservationNode;

export type ThoughtMapPresentationEdge = {
  id: string;
  conceptNodeId: string;
  observationNodeId: string;
  supportCount: number;
};

export type ThoughtMapPresentationRelationship = {
  conceptNodeId: string;
  observationNodeIds: string[];
};

export type ThoughtMapPresentation = {
  nodes: ThoughtMapPresentationNode[];
  edges: ThoughtMapPresentationEdge[];
  relationships: ThoughtMapPresentationRelationship[];
  counts: {
    totalConcepts: number;
    totalObservations: number;
    connectedConcepts: number;
    connectedObservations: number;
    unconnectedConcepts: number;
    unconnectedObservations: number;
    edges: number;
  };
};

export function observationKindLabel(kind: ReviewObservationKind) {
  switch (kind) {
    case "shift":
      return "変化";
    case "connection":
      return "接続";
    case "tension":
      return "緊張";
  }
}

export function buildThoughtMapPresentation(
  map: ThoughtMap,
): ThoughtMapPresentation {
  const connectedConceptIds = new Set(map.edges.map((edge) => edge.conceptId));
  const connectedObservationIds = new Set(
    map.edges.map((edge) => edge.observationId),
  );

  const conceptNodes = map.nodes.filter(
    (node): node is ThoughtMapConceptNode =>
      node.kind === "concept" && connectedConceptIds.has(node.conceptId),
  );
  const observationNodes = map.nodes.filter(
    (node): node is ThoughtMapObservationNode =>
      node.kind === "observation" &&
      connectedObservationIds.has(node.observationId),
  );

  const presentationConceptIdBySourceId = new Map(
    conceptNodes.map((node, index) => [node.conceptId, `concept-${index + 1}`]),
  );
  const presentationObservationIdBySourceId = new Map(
    observationNodes.map((node, index) => [
      node.observationId,
      `observation-${index + 1}`,
    ]),
  );

  const edges = map.edges.flatMap((edge, index) => {
    const conceptNodeId = presentationConceptIdBySourceId.get(edge.conceptId);
    const observationNodeId = presentationObservationIdBySourceId.get(
      edge.observationId,
    );
    if (!conceptNodeId || !observationNodeId) {
      return [];
    }
    return [
      {
        id: `edge-${index + 1}`,
        conceptNodeId,
        observationNodeId,
        supportCount: edge.supportCount,
      },
    ];
  });

  const neighbors = new Map<string, Set<string>>();
  for (const edge of edges) {
    const conceptNeighbors = neighbors.get(edge.conceptNodeId) ?? new Set();
    conceptNeighbors.add(edge.observationNodeId);
    neighbors.set(edge.conceptNodeId, conceptNeighbors);

    const observationNeighbors =
      neighbors.get(edge.observationNodeId) ?? new Set();
    observationNeighbors.add(edge.conceptNodeId);
    neighbors.set(edge.observationNodeId, observationNeighbors);
  }

  const concepts: ThoughtMapPresentationConceptNode[] = conceptNodes.map(
    (node) => {
      const id = presentationConceptIdBySourceId.get(node.conceptId)!;
      return {
        id,
        kind: "concept",
        label: node.canonicalLabel,
        neighborIds: [...(neighbors.get(id) ?? [])],
      };
    },
  );
  const observations: ThoughtMapPresentationObservationNode[] =
    observationNodes.map((node) => {
      const id = presentationObservationIdBySourceId.get(node.observationId)!;
      return {
        id,
        kind: "observation",
        observationKind: node.observationKind,
        kindLabel: observationKindLabel(node.observationKind),
        title: node.title,
        summary: node.summary,
        neighborIds: [...(neighbors.get(id) ?? [])],
      };
    });

  const relationships = concepts.map((concept) => ({
    conceptNodeId: concept.id,
    observationNodeIds: concept.neighborIds,
  }));

  return {
    nodes: [...concepts, ...observations],
    edges,
    relationships,
    counts: {
      totalConcepts: map.stats.conceptNodeCount,
      totalObservations: map.stats.observationNodeCount,
      connectedConcepts: concepts.length,
      connectedObservations: observations.length,
      unconnectedConcepts: map.stats.conceptNodeCount - concepts.length,
      unconnectedObservations: map.stats.observationNodeCount - observations.length,
      edges: edges.length,
    },
  };
}
