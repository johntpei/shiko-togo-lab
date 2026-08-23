export const THOUGHT_MAP_PROVENANCE_JOIN_AUDIT_VERSION =
  "thought-map-provenance-join-audit-v0";

export const PROVENANCE_MATCH_TIERS = {
  exactEvidenceAnchor: "exact_evidence_anchor",
  exactMessageAnchor: "exact_message_anchor",
} as const;

export type ProvenanceMatchTier =
  (typeof PROVENANCE_MATCH_TIERS)[keyof typeof PROVENANCE_MATCH_TIERS];

export const OBSERVATION_EVIDENCE_ROLES = [
  "primary",
  "side_a",
  "side_b",
  "before",
  "after",
] as const;

export type ObservationEvidenceRole =
  (typeof OBSERVATION_EVIDENCE_ROLES)[number];

export type ObservationEvidenceAnchor = {
  observationId: string;
  observationKind: string;
  evidenceRole: ObservationEvidenceRole;
  sessionId: string | null;
  messageId: string | null;
  evidenceRef: string | null;
  hasSessionId: boolean;
  hasMessageId: boolean;
  hasEvidenceRef: boolean;
  hasMessageRef: boolean;
  hasOccurredAt: boolean;
  hasRole: boolean;
};

export type ConceptOccurrenceAnchor = {
  conceptId: string;
  sessionId: string;
  messageId: string;
  evidenceRef: string;
};

export type ObservationConceptProvenanceMatch = {
  observationId: string;
  conceptId: string;
  strongestTier: ProvenanceMatchTier;
  supportCount: number;
  tierASupportCount: number;
  tierBSupportCount: number;
};

export type ProvenanceJoinProjection = {
  nodeCount: number;
  edgeCount: number;
  connectedComponentCount: number;
  isolatedNodeCount: number;
  isolatedConcepts: number;
  isolatedObservations: number;
};

export type ThoughtMapProvenanceJoinAudit = {
  version: typeof THOUGHT_MAP_PROVENANCE_JOIN_AUDIT_VERSION;
  contract: {
    observationEvidenceFields: string[];
    observationHasEvidenceRef: true;
    conceptOccurrenceFields: string[];
    uniqueEvidenceIdentity: {
      conceptOccurrence: string[];
      observationEvidence: string[];
      sharedExactEvidenceKey: true;
    };
    tierA: {
      fields: string[];
      possibleFromContract: true;
    };
    tierB: {
      fields: string[];
      possibleFromContract: true;
    };
    tierC: {
      fields: string[];
      treatedAsDirectEdge: false;
    };
  };
  locators: {
    observation: {
      sessionId: "yes";
      messageId: "yes_nullable";
      evidenceRef: "yes_optional";
      occurredAt: "yes_optional";
      sourceRole: "yes_optional_as_role";
      messageRef: "yes_not_join_key";
    };
    conceptOccurrence: {
      sessionId: "yes";
      messageId: "yes";
      evidenceRef: "yes";
      occurredAt: "yes";
      sourceRole: "yes";
    };
    exactJoin: {
      sessionId: "yes_if_observation_populated";
      messageId: "yes_if_observation_populated";
      evidenceRef: "yes_if_observation_populated";
      occurredAt: "not_used";
      sourceRole: "not_used";
    };
  };
  counts: {
    observationCount: number;
    observationEvidenceAnchorCount: number;
    tierAJoinableObservationAnchors: number;
    tierBJoinableObservationAnchors: number;
    conceptCount: number;
    conceptOccurrenceCount: number;
    tierAMatchCount: number;
    tierBOnlyMatchCount: number;
    uniqueObservationConceptPairs: number;
    sessionOnlyOverlapPairCount: number;
  };
  coverage: {
    observationsWith0Concepts: number;
    observationsWith1Concept: number;
    observationsWith2PlusConcepts: number;
    conceptsMatchedToObservation: number;
    conceptsUnmatched: number;
  };
  matches: ObservationConceptProvenanceMatch[];
  projectionC: ProvenanceJoinProjection;
  projectionD: ProvenanceJoinProjection;
};

export type ThoughtMapProvenanceJoinAuditInput = {
  concepts: Array<{ conceptId: string }>;
  observations: Array<{
    observationId: string;
    kind: string;
    payload: string;
  }>;
  conceptOccurrences: Array<{
    conceptId: string;
    sessionId: string;
    messageId: string;
    evidenceRef: string;
  }>;
};

const OBSERVATION_EVIDENCE_FIELDS = [
  "messageRef",
  "quote",
  "validated",
  "messageId",
  "sessionId",
  "sessionTitle",
  "occurredAt",
  "role",
  "reason",
  "evidenceRef",
] as const;

const CONCEPT_OCCURRENCE_FIELDS = [
  "conceptId",
  "sessionId",
  "messageId",
  "evidenceRef",
  "occurredAt",
  "sourceRole",
  "sourceType",
  "extractionVersion",
] as const;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
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

function evidenceArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readAnchor(
  observationId: string,
  observationKind: string,
  evidenceRole: ObservationEvidenceRole,
  value: unknown,
): ObservationEvidenceAnchor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const sessionId = nonEmptyString(row.sessionId);
  const messageId = nonEmptyString(row.messageId);
  const evidenceRef = nonEmptyString(row.evidenceRef);
  return {
    observationId,
    observationKind,
    evidenceRole,
    sessionId,
    messageId,
    evidenceRef,
    hasSessionId: sessionId !== null,
    hasMessageId: messageId !== null,
    hasEvidenceRef: evidenceRef !== null,
    hasMessageRef: nonEmptyString(row.messageRef) !== null,
    hasOccurredAt: nonEmptyString(row.occurredAt) !== null,
    hasRole: nonEmptyString(row.role) !== null,
  };
}

/**
 * Flatten Observation payload Evidence locators only.
 * Does not copy quote / text. Does not invent evidenceRef.
 */
export function extractObservationEvidenceAnchors(input: {
  observationId: string;
  kind: string;
  payload: string;
}): ObservationEvidenceAnchor[] {
  const parsed = payloadObject(input.payload);
  if (!parsed) {
    return [];
  }
  const groups: Array<{
    role: ObservationEvidenceRole;
    items: unknown[];
  }> = [
    { role: "primary", items: evidenceArray(parsed.evidence) },
    { role: "side_a", items: evidenceArray((parsed.sideA as { evidence?: unknown } | undefined)?.evidence) },
    { role: "side_b", items: evidenceArray((parsed.sideB as { evidence?: unknown } | undefined)?.evidence) },
    { role: "before", items: evidenceArray(parsed.beforeEvidence) },
    { role: "after", items: evidenceArray(parsed.afterEvidence) },
  ];
  const anchors: ObservationEvidenceAnchor[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      const anchor = readAnchor(
        input.observationId,
        input.kind,
        group.role,
        item,
      );
      if (anchor) {
        anchors.push(anchor);
      }
    }
  }
  return anchors;
}

function uniqueIds(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function compareMatch(
  left: ObservationConceptProvenanceMatch,
  right: ObservationConceptProvenanceMatch,
) {
  const byObservation = left.observationId.localeCompare(right.observationId);
  if (byObservation !== 0) {
    return byObservation;
  }
  const byConcept = left.conceptId.localeCompare(right.conceptId);
  if (byConcept !== 0) {
    return byConcept;
  }
  return left.strongestTier.localeCompare(right.strongestTier);
}

function projectJoinGraph(input: {
  conceptIds: string[];
  observationIds: string[];
  pairs: Array<{ observationId: string; conceptId: string }>;
}): ProvenanceJoinProjection {
  const nodeKeys = [
    ...input.conceptIds.map((id) => `concept:${id}`),
    ...input.observationIds.map((id) => `observation:${id}`),
  ];
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
  for (const pair of input.pairs) {
    addUndirected(`observation:${pair.observationId}`, `concept:${pair.conceptId}`);
    edgeCount += 1;
  }

  const isolatedConcepts = input.conceptIds.filter(
    (id) => (neighbors.get(`concept:${id}`)?.size ?? 0) === 0,
  ).length;
  const isolatedObservations = input.observationIds.filter(
    (id) => (neighbors.get(`observation:${id}`)?.size ?? 0) === 0,
  ).length;

  return {
    nodeCount: nodeKeys.length,
    edgeCount,
    connectedComponentCount: new Set(nodeKeys.map((key) => find(key))).size,
    isolatedNodeCount: isolatedConcepts + isolatedObservations,
    isolatedConcepts,
    isolatedObservations,
  };
}

/**
 * Development diagnostic of exact provenance overlap only.
 * Does not infer text, date, session-only, or semantic Observation-Concept edges.
 */
export function buildThoughtMapProvenanceJoinAudit(
  input: ThoughtMapProvenanceJoinAuditInput,
): ThoughtMapProvenanceJoinAudit {
  const conceptIds = uniqueIds(input.concepts.map((row) => row.conceptId));
  const observationIds = uniqueIds(
    input.observations.map((row) => row.observationId),
  );
  const conceptIdSet = new Set(conceptIds);
  const observationIdSet = new Set(observationIds);

  const observationAnchors = input.observations.flatMap((observation) =>
    extractObservationEvidenceAnchors(observation),
  );
  const occurrences = input.conceptOccurrences.filter(
    (row) =>
      conceptIdSet.has(row.conceptId) &&
      row.sessionId.trim() !== "" &&
      row.messageId.trim() !== "" &&
      row.evidenceRef.trim() !== "",
  );

  type Acc = {
    strongestTier: ProvenanceMatchTier;
    tierASupportCount: number;
    tierBSupportCount: number;
  };
  const pairMap = new Map<string, Acc>();
  const sessionOnly = new Set<string>();

  for (const anchor of observationAnchors) {
    if (!observationIdSet.has(anchor.observationId)) {
      continue;
    }
    for (const occurrence of occurrences) {
      const pairKey = `${anchor.observationId}\0${occurrence.conceptId}`;
      const sameSession =
        anchor.hasSessionId && anchor.sessionId === occurrence.sessionId;
      const sameMessage =
        sameSession &&
        anchor.hasMessageId &&
        anchor.messageId === occurrence.messageId;
      const sameEvidence =
        sameMessage &&
        anchor.hasEvidenceRef &&
        anchor.evidenceRef === occurrence.evidenceRef;

      if (sameEvidence) {
        const current = pairMap.get(pairKey) ?? {
          strongestTier: PROVENANCE_MATCH_TIERS.exactMessageAnchor,
          tierASupportCount: 0,
          tierBSupportCount: 0,
        };
        current.strongestTier = PROVENANCE_MATCH_TIERS.exactEvidenceAnchor;
        current.tierASupportCount += 1;
        pairMap.set(pairKey, current);
        continue;
      }
      if (sameMessage) {
        const current = pairMap.get(pairKey) ?? {
          strongestTier: PROVENANCE_MATCH_TIERS.exactMessageAnchor,
          tierASupportCount: 0,
          tierBSupportCount: 0,
        };
        if (current.strongestTier !== PROVENANCE_MATCH_TIERS.exactEvidenceAnchor) {
          current.strongestTier = PROVENANCE_MATCH_TIERS.exactMessageAnchor;
        }
        current.tierBSupportCount += 1;
        pairMap.set(pairKey, current);
        continue;
      }
      if (sameSession) {
        sessionOnly.add(pairKey);
      }
    }
  }

  const matches: ObservationConceptProvenanceMatch[] = [...pairMap.entries()]
    .map(([key, value]) => {
      const [observationId, conceptId] = key.split("\0");
      const supportCount =
        value.strongestTier === PROVENANCE_MATCH_TIERS.exactEvidenceAnchor
          ? value.tierASupportCount
          : value.tierBSupportCount;
      return {
        observationId: observationId ?? "",
        conceptId: conceptId ?? "",
        strongestTier: value.strongestTier,
        supportCount,
        tierASupportCount: value.tierASupportCount,
        tierBSupportCount: value.tierBSupportCount,
      };
    })
    .sort(compareMatch);

  const conceptsByObservation = new Map<string, Set<string>>();
  const observationsByConcept = new Map<string, Set<string>>();
  for (const match of matches) {
    const conceptsForObservation =
      conceptsByObservation.get(match.observationId) ?? new Set<string>();
    conceptsForObservation.add(match.conceptId);
    conceptsByObservation.set(match.observationId, conceptsForObservation);
    const observationsForConcept =
      observationsByConcept.get(match.conceptId) ?? new Set<string>();
    observationsForConcept.add(match.observationId);
    observationsByConcept.set(match.conceptId, observationsForConcept);
  }

  let observationsWith0Concepts = 0;
  let observationsWith1Concept = 0;
  let observationsWith2PlusConcepts = 0;
  for (const observationId of observationIds) {
    const count = conceptsByObservation.get(observationId)?.size ?? 0;
    if (count === 0) {
      observationsWith0Concepts += 1;
    } else if (count === 1) {
      observationsWith1Concept += 1;
    } else {
      observationsWith2PlusConcepts += 1;
    }
  }

  const tierAPairs = matches.filter(
    (match) => match.strongestTier === PROVENANCE_MATCH_TIERS.exactEvidenceAnchor,
  );
  const projectionInput = {
    conceptIds,
    observationIds,
  };

  return {
    version: THOUGHT_MAP_PROVENANCE_JOIN_AUDIT_VERSION,
    contract: {
      observationEvidenceFields: [...OBSERVATION_EVIDENCE_FIELDS],
      observationHasEvidenceRef: true,
      conceptOccurrenceFields: [...CONCEPT_OCCURRENCE_FIELDS],
      uniqueEvidenceIdentity: {
        conceptOccurrence: [
          "extractionVersion",
          "sourceType",
          "messageId",
          "evidenceRef",
          "conceptId",
        ],
        observationEvidence: ["sessionId", "messageId", "evidenceRef"],
        sharedExactEvidenceKey: true,
      },
      tierA: {
        fields: ["sessionId", "messageId", "evidenceRef"],
        possibleFromContract: true,
      },
      tierB: {
        fields: ["sessionId", "messageId"],
        possibleFromContract: true,
      },
      tierC: {
        fields: ["sessionId"],
        treatedAsDirectEdge: false,
      },
    },
    locators: {
      observation: {
        sessionId: "yes",
        messageId: "yes_nullable",
        evidenceRef: "yes_optional",
        occurredAt: "yes_optional",
        sourceRole: "yes_optional_as_role",
        messageRef: "yes_not_join_key",
      },
      conceptOccurrence: {
        sessionId: "yes",
        messageId: "yes",
        evidenceRef: "yes",
        occurredAt: "yes",
        sourceRole: "yes",
      },
      exactJoin: {
        sessionId: "yes_if_observation_populated",
        messageId: "yes_if_observation_populated",
        evidenceRef: "yes_if_observation_populated",
        occurredAt: "not_used",
        sourceRole: "not_used",
      },
    },
    counts: {
      observationCount: observationIds.length,
      observationEvidenceAnchorCount: observationAnchors.length,
      tierAJoinableObservationAnchors: observationAnchors.filter(
        (anchor) =>
          anchor.hasSessionId && anchor.hasMessageId && anchor.hasEvidenceRef,
      ).length,
      tierBJoinableObservationAnchors: observationAnchors.filter(
        (anchor) => anchor.hasSessionId && anchor.hasMessageId,
      ).length,
      conceptCount: conceptIds.length,
      conceptOccurrenceCount: occurrences.length,
      tierAMatchCount: tierAPairs.length,
      tierBOnlyMatchCount: matches.filter(
        (match) =>
          match.strongestTier === PROVENANCE_MATCH_TIERS.exactMessageAnchor,
      ).length,
      uniqueObservationConceptPairs: matches.length,
      sessionOnlyOverlapPairCount: [...sessionOnly].filter(
        (key) => !pairMap.has(key),
      ).length,
    },
    coverage: {
      observationsWith0Concepts,
      observationsWith1Concept,
      observationsWith2PlusConcepts,
      conceptsMatchedToObservation: conceptIds.filter(
        (id) => (observationsByConcept.get(id)?.size ?? 0) > 0,
      ).length,
      conceptsUnmatched: conceptIds.filter(
        (id) => (observationsByConcept.get(id)?.size ?? 0) === 0,
      ).length,
    },
    matches,
    projectionC: projectJoinGraph({
      ...projectionInput,
      pairs: tierAPairs,
    }),
    projectionD: projectJoinGraph({
      ...projectionInput,
      pairs: matches,
    }),
  };
}

export function formatThoughtMapProvenanceJoinAudit(
  audit: ThoughtMapProvenanceJoinAudit,
) {
  return [
    "THOUGHT_MAP_PROVENANCE_JOIN_AUDIT_V0",
    `observations=${audit.counts.observationCount} observationAnchors=${audit.counts.observationEvidenceAnchorCount} concepts=${audit.counts.conceptCount} conceptOccurrences=${audit.counts.conceptOccurrenceCount}`,
    "",
    "locator compatibility:",
    "  sessionId: observation=yes conceptOccurrence=yes exactJoin=if_populated",
    "  messageId: observation=nullable conceptOccurrence=yes exactJoin=if_populated",
    "  evidenceRef: observation=optional conceptOccurrence=yes exactJoin=if_populated",
    "  occurredAt: not used as join key",
    "  sourceRole: not used as join key",
    "  messageRef: observation-only review ref; not evidenceRef",
    "",
    "tiers:",
    "  A exact evidence anchor: sessionId+messageId+evidenceRef; possibleFromContract=true",
    "  B exact message anchor: sessionId+messageId; possibleFromContract=true",
    "  C session-only: diagnostic count only; not a direct edge",
    "",
    "matches:",
    `  tierAJoinableAnchors=${audit.counts.tierAJoinableObservationAnchors}`,
    `  tierBJoinableAnchors=${audit.counts.tierBJoinableObservationAnchors}`,
    `  tierAPairs=${audit.counts.tierAMatchCount}`,
    `  tierBOnlyPairs=${audit.counts.tierBOnlyMatchCount}`,
    `  uniqueObservationConceptPairs=${audit.counts.uniqueObservationConceptPairs}`,
    `  sessionOnlyOverlapPairs=${audit.counts.sessionOnlyOverlapPairCount}`,
    "",
    "coverage:",
    `  observations 0/1/2+ concepts: ${audit.coverage.observationsWith0Concepts}/${audit.coverage.observationsWith1Concept}/${audit.coverage.observationsWith2PlusConcepts}`,
    `  concepts matched/unmatched: ${audit.coverage.conceptsMatchedToObservation}/${audit.coverage.conceptsUnmatched}`,
    "",
    "projection C (tier A only):",
    `  nodes=${audit.projectionC.nodeCount} edges=${audit.projectionC.edgeCount} components=${audit.projectionC.connectedComponentCount} isolated=${audit.projectionC.isolatedNodeCount}`,
    `  isolated concepts=${audit.projectionC.isolatedConcepts} observations=${audit.projectionC.isolatedObservations}`,
    "",
    "projection D (tier A + tier B):",
    `  nodes=${audit.projectionD.nodeCount} edges=${audit.projectionD.edgeCount} components=${audit.projectionD.connectedComponentCount} isolated=${audit.projectionD.isolatedNodeCount}`,
    `  isolated concepts=${audit.projectionD.isolatedConcepts} observations=${audit.projectionD.isolatedObservations}`,
    "",
    "no text matching, no semantic matching, no same-date join, no session-only direct edges",
  ].join("\n");
}
