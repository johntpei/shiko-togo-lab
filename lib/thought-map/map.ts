import { thoughtDateSortKey } from "@/lib/observations/thought-date";
import {
  THOUGHT_MAP_EDGE_KIND,
  THOUGHT_MAP_SUPPORTED_RELATION_VERSIONS,
  THOUGHT_MAP_VERSION,
  type BuildThoughtMapInput,
  type ThoughtMap,
  type ThoughtMapConceptNode,
  type ThoughtMapObservationConceptEdge,
  type ThoughtMapObservationNode,
  type ThoughtMapSupportedRelationVersion,
} from "./types";

function isSupportedRelationVersion(
  value: string,
): value is ThoughtMapSupportedRelationVersion {
  return (THOUGHT_MAP_SUPPORTED_RELATION_VERSIONS as readonly string[]).includes(
    value,
  );
}

function compareConceptNodes(
  left: ThoughtMapConceptNode,
  right: ThoughtMapConceptNode,
) {
  const byLabel = left.canonicalLabel.localeCompare(right.canonicalLabel);
  if (byLabel !== 0) {
    return byLabel;
  }
  return left.conceptId.localeCompare(right.conceptId);
}

function compareObservationNodes(
  left: ThoughtMapObservationNode & {
    lastSeenAt: string | null;
    firstSeenAt: string | null;
    detectedAt: string;
  },
  right: ThoughtMapObservationNode & {
    lastSeenAt: string | null;
    firstSeenAt: string | null;
    detectedAt: string;
  },
) {
  const byTime = thoughtDateSortKey(right).localeCompare(thoughtDateSortKey(left));
  if (byTime !== 0) {
    return byTime;
  }
  return left.observationId.localeCompare(right.observationId);
}

function compareEdges(
  left: ThoughtMapObservationConceptEdge,
  right: ThoughtMapObservationConceptEdge,
) {
  const byVersion = left.relationVersion.localeCompare(right.relationVersion);
  if (byVersion !== 0) {
    return byVersion;
  }
  const byObservation = left.observationId.localeCompare(right.observationId);
  if (byObservation !== 0) {
    return byObservation;
  }
  return left.conceptId.localeCompare(right.conceptId);
}

function edgeIdentity(edge: {
  relationVersion: string;
  observationId: string;
  conceptId: string;
}) {
  return `${edge.relationVersion}\0${edge.observationId}\0${edge.conceptId}`;
}

/**
 * Pure Thought Map v0 builder.
 * Does not infer edges from session, date, or text.
 * Invalid relations are skipped; missing nodes are never invented.
 */
export function buildThoughtMap(input: BuildThoughtMapInput): ThoughtMap {
  const conceptNodes = new Map<string, ThoughtMapConceptNode>();
  for (const concept of input.concepts) {
    conceptNodes.set(concept.conceptId, {
      kind: "concept",
      conceptId: concept.conceptId,
      canonicalLabel: concept.canonicalLabel,
    });
  }

  const observationNodes = new Map<
    string,
    ThoughtMapObservationNode & {
      lastSeenAt: string | null;
      firstSeenAt: string | null;
      detectedAt: string;
    }
  >();
  for (const observation of input.observations) {
    observationNodes.set(observation.observationId, {
      kind: "observation",
      observationId: observation.observationId,
      observationKind: observation.observationKind,
      title: observation.title,
      summary: observation.summary,
      lastSeenAt: observation.lastSeenAt,
      firstSeenAt: observation.firstSeenAt,
      detectedAt: observation.detectedAt,
    });
  }

  const edges = new Map<string, ThoughtMapObservationConceptEdge>();
  for (const relation of input.relations) {
    if (!isSupportedRelationVersion(relation.relationVersion)) {
      continue;
    }
    if (relation.supportCount < 1) {
      continue;
    }
    if (!observationNodes.has(relation.observationId)) {
      continue;
    }
    if (!conceptNodes.has(relation.conceptId)) {
      continue;
    }
    const edge: ThoughtMapObservationConceptEdge = {
      kind: THOUGHT_MAP_EDGE_KIND,
      observationId: relation.observationId,
      conceptId: relation.conceptId,
      relationVersion: relation.relationVersion,
      supportCount: relation.supportCount,
    };
    const key = edgeIdentity(edge);
    if (edges.has(key)) {
      continue;
    }
    edges.set(key, edge);
  }

  const connectedConcepts = new Set<string>();
  const connectedObservations = new Set<string>();
  for (const edge of edges.values()) {
    connectedConcepts.add(edge.conceptId);
    connectedObservations.add(edge.observationId);
  }

  const concepts = [...conceptNodes.values()].sort(compareConceptNodes);
  const observations = [...observationNodes.values()]
    .sort(compareObservationNodes)
    .map((node) => ({
      kind: "observation" as const,
      observationId: node.observationId,
      observationKind: node.observationKind,
      title: node.title,
      summary: node.summary,
    }));
  const sortedEdges = [...edges.values()].sort(compareEdges);

  return {
    version: THOUGHT_MAP_VERSION,
    nodes: [...concepts, ...observations],
    edges: sortedEdges,
    stats: {
      conceptNodeCount: concepts.length,
      observationNodeCount: observations.length,
      edgeCount: sortedEdges.length,
      isolatedConceptCount: concepts.filter((node) => !connectedConcepts.has(node.conceptId)).length,
      isolatedObservationCount: observations.filter(
        (node) => !connectedObservations.has(node.observationId),
      ).length,
    },
  };
}
