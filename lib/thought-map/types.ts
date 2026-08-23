import {
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_KIND,
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
} from "@/lib/observations/concept-evidence-supports";
import type { ReviewObservationKind } from "@/lib/observations/types";

export const THOUGHT_MAP_VERSION = "thought-map-v0";

export type ThoughtMapVersion = typeof THOUGHT_MAP_VERSION;

export const THOUGHT_MAP_SUPPORTED_RELATION_VERSIONS = [
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
] as const;

export type ThoughtMapSupportedRelationVersion =
  (typeof THOUGHT_MAP_SUPPORTED_RELATION_VERSIONS)[number];

export const THOUGHT_MAP_EDGE_KIND = OBSERVATION_CONCEPT_EVIDENCE_RELATION_KIND;

export type ThoughtMapConceptNode = {
  kind: "concept";
  conceptId: string;
  canonicalLabel: string;
};

export type ThoughtMapObservationNode = {
  kind: "observation";
  observationId: string;
  observationKind: ReviewObservationKind;
  title: string;
  summary: string;
};

export type ThoughtMapNode = ThoughtMapConceptNode | ThoughtMapObservationNode;

/**
 * Undirected Observation↔Concept exact Evidence provenance.
 * Endpoints are typed; this is not a causal source→target edge.
 * supportCount is a raw provenance row count, not a weight.
 */
export type ThoughtMapObservationConceptEdge = {
  kind: typeof THOUGHT_MAP_EDGE_KIND;
  observationId: string;
  conceptId: string;
  relationVersion: ThoughtMapSupportedRelationVersion;
  supportCount: number;
};

export type ThoughtMapEdge = ThoughtMapObservationConceptEdge;

export type ThoughtMapStats = {
  conceptNodeCount: number;
  observationNodeCount: number;
  edgeCount: number;
  isolatedConceptCount: number;
  isolatedObservationCount: number;
};

export type ThoughtMap = {
  version: ThoughtMapVersion;
  nodes: ThoughtMapNode[];
  edges: ThoughtMapEdge[];
  stats: ThoughtMapStats;
};

export type ThoughtMapConceptInput = {
  conceptId: string;
  canonicalLabel: string;
};

export type ThoughtMapObservationInput = {
  observationId: string;
  observationKind: ReviewObservationKind;
  title: string;
  summary: string;
  lastSeenAt: string | null;
  firstSeenAt: string | null;
  detectedAt: string;
};

export type ThoughtMapRelationInput = {
  observationId: string;
  conceptId: string;
  relationVersion: string;
  supportCount: number;
};

export type BuildThoughtMapInput = {
  concepts: ThoughtMapConceptInput[];
  observations: ThoughtMapObservationInput[];
  relations: ThoughtMapRelationInput[];
};
