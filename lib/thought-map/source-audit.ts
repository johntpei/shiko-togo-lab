export const THOUGHT_MAP_SOURCE_AUDIT_VERSION = "thought-map-source-audit-v0";

export const THOUGHT_MAP_EDGE_REASONS = {
  conceptSession: "concept_observed_in_session",
  observationSession: "observation_session_link",
} as const;

export type ThoughtMapDegreeBuckets = {
  degree0: number;
  degree1: number;
  degree2Plus: number;
};

export type ThoughtMapProjectionSummary = {
  nodeCount: number;
  edgeCount: number;
  connectedComponentCount: number;
  isolatedNodeCount: number;
  isolatedConcepts: number;
  isolatedObservations: number;
  isolatedSessions: number;
  degreeByNodeType: {
    concept: ThoughtMapDegreeBuckets;
    observation: ThoughtMapDegreeBuckets;
    session: ThoughtMapDegreeBuckets;
  };
};

export type ThoughtMapObservationKindShape = {
  kind: string;
  instanceCount: number;
  topLevelFieldNames: string[];
  hasTextSides: boolean;
  hasBeforeAfterText: boolean;
  hasContractedEntityIds: boolean;
  uncontractedIdFieldNames: string[];
};

export type ThoughtMapSourceAudit = {
  version: typeof THOUGHT_MAP_SOURCE_AUDIT_VERSION;
  nodes: {
    conceptCount: number;
    observationCount: number;
    sessionCount: number;
  };
  explicitEdges: {
    conceptSessionCount: number;
    observationSessionCount: number;
    observationObservationCount: number;
    conceptConceptCount: number;
    observationConceptCount: number;
  };
  conceptSession: Array<{
    conceptId: string;
    sessionId: string;
    reason: typeof THOUGHT_MAP_EDGE_REASONS.conceptSession;
    supportCount: number;
  }>;
  observationSession: Array<{
    observationId: string;
    sessionId: string;
    reason: typeof THOUGHT_MAP_EDGE_REASONS.observationSession;
    supportCount: number;
  }>;
  projectionA: ThoughtMapProjectionSummary;
  projectionB: ThoughtMapProjectionSummary;
  observationShapes: ThoughtMapObservationKindShape[];
  schema: {
    hasObservationConceptsTable: false;
    hasConceptRelationsTable: false;
    hasObservationObservationRelationsTable: false;
    conceptOccurrenceIsNode: false;
  };
  unsupportedStructures: string[];
  contract: {
    shift: { textFields: string[]; entityIdFields: string[] };
    connection: {
      textFields: string[];
      optionalTextSideFields: string[];
      entityIdFields: string[];
    };
    tension: {
      textFields: string[];
      optionalTextSideFields: string[];
      entityIdFields: string[];
    };
  };
};

export type ThoughtMapSourceAuditInput = {
  concepts: Array<{ conceptId: string }>;
  observations: Array<{
    observationId: string;
    kind: string;
    payload: string;
  }>;
  sessions: Array<{ sessionId: string }>;
  conceptSessionLinks: Array<{ conceptId: string; sessionId: string }>;
  observationSessionLinks: Array<{
    observationId: string;
    sessionId: string;
  }>;
};

const UNCONTRACTED_ID_KEY =
  /(observationid|relatedobservation|parentobservation|sourceobservation|targetobservation|conceptid|relatedconcept)/i;

const CONTRACT: ThoughtMapSourceAudit["contract"] = {
  shift: {
    textFields: ["text", "before", "after", "interpretation"],
    entityIdFields: [],
  },
  connection: {
    textFields: ["text"],
    optionalTextSideFields: ["sideA", "sideB"],
    entityIdFields: [],
  },
  tension: {
    textFields: ["text"],
    optionalTextSideFields: ["sideA", "sideB"],
    entityIdFields: [],
  },
};

function emptyDegrees(): ThoughtMapDegreeBuckets {
  return { degree0: 0, degree1: 0, degree2Plus: 0 };
}

function comparePair(
  leftFrom: string,
  leftTo: string,
  rightFrom: string,
  rightTo: string,
) {
  const byFrom = leftFrom.localeCompare(rightFrom);
  if (byFrom !== 0) {
    return byFrom;
  }
  return leftTo.localeCompare(rightTo);
}

function collectKeys(value: unknown, keys: Set<string>, depth = 0) {
  if (depth > 4 || !value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys, depth + 1);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys, depth + 1);
  }
}

function payloadObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasTextSide(value: unknown) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as { text?: unknown }).text === "string",
  );
}

function inspectObservation(kind: string, payload: string) {
  const parsed = payloadObject(payload);
  const keys = new Set<string>();
  if (parsed) {
    collectKeys(parsed, keys);
  }
  const uncontractedIdFieldNames = [...keys]
    .filter((key) => UNCONTRACTED_ID_KEY.test(key))
    .sort((left, right) => left.localeCompare(right));
  return {
    kind,
    topLevelFieldNames: parsed
      ? Object.keys(parsed).sort((left, right) => left.localeCompare(right))
      : [],
    hasTextSides: Boolean(
      parsed && hasTextSide(parsed.sideA) && hasTextSide(parsed.sideB),
    ),
    hasBeforeAfterText: Boolean(
      parsed &&
        typeof parsed.before === "string" &&
        typeof parsed.after === "string",
    ),
    hasContractedEntityIds: false,
    uncontractedIdFieldNames,
  };
}

function mergeShapes(
  observations: ThoughtMapSourceAuditInput["observations"],
): ThoughtMapObservationKindShape[] {
  const byKind = new Map<string, ThoughtMapObservationKindShape>();
  for (const kind of ["connection", "shift", "tension"]) {
    byKind.set(kind, {
      kind,
      instanceCount: 0,
      topLevelFieldNames: [],
      hasTextSides: false,
      hasBeforeAfterText: false,
      hasContractedEntityIds: false,
      uncontractedIdFieldNames: [],
    });
  }
  for (const observation of observations) {
    const inspected = inspectObservation(observation.kind, observation.payload);
    const current = byKind.get(observation.kind) ?? {
      kind: observation.kind,
      instanceCount: 0,
      topLevelFieldNames: [],
      hasTextSides: false,
      hasBeforeAfterText: false,
      hasContractedEntityIds: false,
      uncontractedIdFieldNames: [],
    };
    current.instanceCount += 1;
    current.topLevelFieldNames = [
      ...new Set([...current.topLevelFieldNames, ...inspected.topLevelFieldNames]),
    ].sort((left, right) => left.localeCompare(right));
    current.hasTextSides = current.hasTextSides || inspected.hasTextSides;
    current.hasBeforeAfterText =
      current.hasBeforeAfterText || inspected.hasBeforeAfterText;
    current.uncontractedIdFieldNames = [
      ...new Set([
        ...current.uncontractedIdFieldNames,
        ...inspected.uncontractedIdFieldNames,
      ]),
    ].sort((left, right) => left.localeCompare(right));
    byKind.set(observation.kind, current);
  }
  return [...byKind.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind),
  );
}

function uniqueIds(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function aggregatePairs(links: Array<{ left: string; right: string }>) {
  const counts = new Map<
    string,
    { left: string; right: string; supportCount: number }
  >();
  for (const link of links) {
    const key = `${link.left}\0${link.right}`;
    const current = counts.get(key);
    if (current) {
      current.supportCount += 1;
    } else {
      counts.set(key, { left: link.left, right: link.right, supportCount: 1 });
    }
  }
  return [...counts.values()].sort((left, right) =>
    comparePair(left.left, left.right, right.left, right.right),
  );
}

function degreeBuckets(degrees: number[]): ThoughtMapDegreeBuckets {
  const buckets = emptyDegrees();
  for (const degree of degrees) {
    if (degree <= 0) {
      buckets.degree0 += 1;
    } else if (degree === 1) {
      buckets.degree1 += 1;
    } else {
      buckets.degree2Plus += 1;
    }
  }
  return buckets;
}

function projectGraph(input: {
  conceptIds: string[];
  observationIds: string[];
  sessionIds: string[];
  includeSessions: boolean;
  conceptSession: Array<{ conceptId: string; sessionId: string }>;
  observationSession: Array<{ observationId: string; sessionId: string }>;
}): ThoughtMapProjectionSummary {
  const nodeKeys: string[] = [
    ...input.conceptIds.map((id) => `concept:${id}`),
    ...input.observationIds.map((id) => `observation:${id}`),
  ];
  if (input.includeSessions) {
    nodeKeys.push(...input.sessionIds.map((id) => `session:${id}`));
  }
  const parent = new Map<string, string>();
  for (const key of nodeKeys) {
    parent.set(key, key);
  }
  const find = (key: string): string => {
    const current = parent.get(key) ?? key;
    if (current === key) {
      return key;
    }
    const root = find(current);
    parent.set(key, root);
    return root;
  };
  const unite = (left: string, right: string) => {
    const rootLeft = find(left);
    const rootRight = find(right);
    if (rootLeft === rootRight) {
      return;
    }
    if (rootLeft < rootRight) {
      parent.set(rootRight, rootLeft);
    } else {
      parent.set(rootLeft, rootRight);
    }
  };
  const neighbors = new Map<string, Set<string>>();
  const addUndirected = (from: string, to: string) => {
    if (!parent.has(from) || !parent.has(to)) {
      return;
    }
    unite(from, to);
    const fromSet = neighbors.get(from) ?? new Set<string>();
    fromSet.add(to);
    neighbors.set(from, fromSet);
    const toSet = neighbors.get(to) ?? new Set<string>();
    toSet.add(from);
    neighbors.set(to, toSet);
  };

  let edgeCount = 0;
  if (input.includeSessions) {
    for (const edge of input.conceptSession) {
      addUndirected(`concept:${edge.conceptId}`, `session:${edge.sessionId}`);
      edgeCount += 1;
    }
    for (const edge of input.observationSession) {
      addUndirected(
        `observation:${edge.observationId}`,
        `session:${edge.sessionId}`,
      );
      edgeCount += 1;
    }
  }

  const isolatedConcepts = input.conceptIds.filter(
    (id) => (neighbors.get(`concept:${id}`)?.size ?? 0) === 0,
  ).length;
  const isolatedObservations = input.observationIds.filter(
    (id) => (neighbors.get(`observation:${id}`)?.size ?? 0) === 0,
  ).length;
  const isolatedSessions = input.includeSessions
    ? input.sessionIds.filter(
        (id) => (neighbors.get(`session:${id}`)?.size ?? 0) === 0,
      ).length
    : 0;

  return {
    nodeCount: nodeKeys.length,
    edgeCount,
    connectedComponentCount: new Set(nodeKeys.map((key) => find(key))).size,
    isolatedNodeCount:
      isolatedConcepts + isolatedObservations + isolatedSessions,
    isolatedConcepts,
    isolatedObservations,
    isolatedSessions,
    degreeByNodeType: {
      concept: degreeBuckets(
        input.conceptIds.map((id) => neighbors.get(`concept:${id}`)?.size ?? 0),
      ),
      observation: degreeBuckets(
        input.observationIds.map(
          (id) => neighbors.get(`observation:${id}`)?.size ?? 0,
        ),
      ),
      session: input.includeSessions
        ? degreeBuckets(
            input.sessionIds.map(
              (id) => neighbors.get(`session:${id}`)?.size ?? 0,
            ),
          )
        : emptyDegrees(),
    },
  };
}

function unsupportedStructures(
  shapes: ThoughtMapObservationKindShape[],
): string[] {
  const flags = new Set([
    "no_observation_concepts_table",
    "no_concept_relations_table",
    "no_observation_observation_relations_table",
    "connection_payload_has_no_entity_ids",
    "tension_payload_has_no_entity_ids",
    "shift_payload_has_no_entity_ids",
    "shift_has_before_after_text_only",
  ]);
  for (const shape of shapes) {
    if (shape.kind === "connection" && shape.hasTextSides) {
      flags.add("connection_has_text_pair_only");
    }
    if (shape.kind === "tension" && shape.hasTextSides) {
      flags.add("tension_has_text_pair_only");
    }
  }
  return [...flags].sort((left, right) => left.localeCompare(right));
}

/**
 * Development diagnostic of explicit graph sources only.
 * Does not infer co-occurrence, same-date, or lexical-match edges.
 */
export function buildThoughtMapSourceAudit(
  input: ThoughtMapSourceAuditInput,
): ThoughtMapSourceAudit {
  const conceptIds = uniqueIds(input.concepts.map((row) => row.conceptId));
  const observationIds = uniqueIds(
    input.observations.map((row) => row.observationId),
  );
  const sessionIds = uniqueIds(input.sessions.map((row) => row.sessionId));
  const conceptIdSet = new Set(conceptIds);
  const observationIdSet = new Set(observationIds);
  const sessionIdSet = new Set(sessionIds);

  const conceptSession = aggregatePairs(
    input.conceptSessionLinks
      .filter(
        (link) =>
          conceptIdSet.has(link.conceptId) && sessionIdSet.has(link.sessionId),
      )
      .map((link) => ({ left: link.conceptId, right: link.sessionId })),
  ).map((row) => ({
    conceptId: row.left,
    sessionId: row.right,
    reason: THOUGHT_MAP_EDGE_REASONS.conceptSession,
    supportCount: row.supportCount,
  }));

  const observationSession = aggregatePairs(
    input.observationSessionLinks
      .filter(
        (link) =>
          observationIdSet.has(link.observationId) &&
          sessionIdSet.has(link.sessionId),
      )
      .map((link) => ({ left: link.observationId, right: link.sessionId })),
  ).map((row) => ({
    observationId: row.left,
    sessionId: row.right,
    reason: THOUGHT_MAP_EDGE_REASONS.observationSession,
    supportCount: row.supportCount,
  }));

  const observationShapes = mergeShapes(input.observations);
  const projectionInput = {
    conceptIds,
    observationIds,
    sessionIds,
    conceptSession,
    observationSession,
  };

  return {
    version: THOUGHT_MAP_SOURCE_AUDIT_VERSION,
    nodes: {
      conceptCount: conceptIds.length,
      observationCount: observationIds.length,
      sessionCount: sessionIds.length,
    },
    explicitEdges: {
      conceptSessionCount: conceptSession.length,
      observationSessionCount: observationSession.length,
      observationObservationCount: 0,
      conceptConceptCount: 0,
      observationConceptCount: 0,
    },
    conceptSession,
    observationSession,
    projectionA: projectGraph({ ...projectionInput, includeSessions: true }),
    projectionB: projectGraph({ ...projectionInput, includeSessions: false }),
    observationShapes,
    schema: {
      hasObservationConceptsTable: false,
      hasConceptRelationsTable: false,
      hasObservationObservationRelationsTable: false,
      conceptOccurrenceIsNode: false,
    },
    unsupportedStructures: unsupportedStructures(observationShapes),
    contract: CONTRACT,
  };
}

function formatDegrees(label: string, buckets: ThoughtMapDegreeBuckets) {
  return `  ${label}: degree0=${buckets.degree0} degree1=${buckets.degree1} degree2+=${buckets.degree2Plus}`;
}

function formatProjection(
  title: string,
  projection: ThoughtMapProjectionSummary,
) {
  return [
    title,
    `  nodes=${projection.nodeCount} edges=${projection.edgeCount} components=${projection.connectedComponentCount} isolated=${projection.isolatedNodeCount}`,
    `  isolated concepts=${projection.isolatedConcepts} observations=${projection.isolatedObservations} sessions=${projection.isolatedSessions}`,
    formatDegrees("concept", projection.degreeByNodeType.concept),
    formatDegrees("observation", projection.degreeByNodeType.observation),
    formatDegrees("session", projection.degreeByNodeType.session),
  ];
}

export function formatThoughtMapSourceAudit(audit: ThoughtMapSourceAudit) {
  const lines = [
    "THOUGHT_MAP_SOURCE_AUDIT_V0",
    `concepts=${audit.nodes.conceptCount} observations=${audit.nodes.observationCount} sessions=${audit.nodes.sessionCount}`,
    "",
    "explicit edges:",
    `  concept-session: ${audit.explicitEdges.conceptSessionCount}`,
    `  observation-session: ${audit.explicitEdges.observationSessionCount}`,
    `  observation-observation: ${audit.explicitEdges.observationObservationCount}`,
    `  concept-concept: ${audit.explicitEdges.conceptConceptCount}`,
    `  observation-concept: ${audit.explicitEdges.observationConceptCount}`,
    "",
    ...formatProjection(
      "projection A (concept + observation + session):",
      audit.projectionA,
    ),
    "",
    ...formatProjection(
      "projection B (concept + observation only):",
      audit.projectionB,
    ),
    "",
    "observation payload shapes (field names only):",
  ];
  for (const shape of audit.observationShapes) {
    lines.push(
      `  ${shape.kind}: count=${shape.instanceCount} fields=${shape.topLevelFieldNames.join(",") || "(none)"} textSides=${shape.hasTextSides} beforeAfter=${shape.hasBeforeAfterText} contractedEntityIds=${shape.hasContractedEntityIds} extraIdFields=${shape.uncontractedIdFieldNames.join(",") || "(none)"}`,
    );
  }
  lines.push(
    "",
    "schema flags:",
    `  observation_concepts=${audit.schema.hasObservationConceptsTable}`,
    `  concept_relations=${audit.schema.hasConceptRelationsTable}`,
    `  observation_observation_relations=${audit.schema.hasObservationObservationRelationsTable}`,
    `  concept_occurrence_is_node=${audit.schema.conceptOccurrenceIsNode}`,
    "",
    "unsupported structures:",
    ...audit.unsupportedStructures.map((flag) => `  ${flag}`),
    "",
    "no inferred edges: co-occurrence, same-date, lexical-match, Topic Signal",
  );
  return lines.join("\n");
}
