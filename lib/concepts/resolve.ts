import type { ConceptExtractAction } from "./actions";
import { MAX_CONCEPTS_PER_UNIT } from "./actions";
import {
  addAliasesToCatalog,
  addConceptToCatalog,
  cloneConceptCatalog,
  lookupCatalogByConceptId,
  lookupCatalogByNormalizedKey,
  lookupCatalogByRef,
  uniqueAliasLabels,
  virtualConceptId,
  type ConceptRegistrySnapshot,
} from "./catalog";
import { validateConceptCandidate } from "./candidate";
import { groundSurfaceForm, lookupExtractUnit } from "./grounding";
import { containsHonorificPerson } from "./honorific";
import type { ConceptMatchKind } from "./identity";
import { classifyServerIdentity } from "./identity";
import { normalizeConceptKey } from "./normalize";
import { conceptThoughtOccurredAt } from "./occurred-at";
import { validateConceptOccurrence } from "./occurrence";
import {
  CONCEPT_EXTRACTION_VERSION,
  type ConceptSourceRole,
  type ConceptSourceType,
} from "./types";
import {
  conceptExtractUnitsByRef,
  type ConceptExtractUnit,
} from "./user-units";

export { MAX_CONCEPTS_PER_UNIT } from "./actions";

export const CONCEPT_RESOLVE_REJECT_REASONS = [
  "empty_surface",
  "invalid_evidence_ref",
  "ref_not_in_batch",
  "surface_not_in_unit",
  "unknown_concept_ref",
  "invalid_candidate",
  "invalid_occurrence",
  "max_concepts_per_unit",
  "duplicate_concept_in_unit",
  "honorific_person",
] as const;

export type ConceptResolveRejectReason =
  (typeof CONCEPT_RESOLVE_REJECT_REASONS)[number];

export type ConceptNewConceptOperation = {
  type: "new_concept";
  conceptId: string;
  canonicalLabel: string;
  normalizedKey: string;
  aliases: string[];
};

export type ConceptOccurrenceOperation = {
  type: "occurrence";
  resolvedAs: "match" | "new";
  matchKind?: ConceptMatchKind;
  conceptId: string;
  canonicalLabel: string;
  sessionId: string;
  messageId: string;
  evidenceRef: string;
  occurredAt: string;
  sourceRole: ConceptSourceRole;
  sourceType: ConceptSourceType;
  extractionVersion: typeof CONCEPT_EXTRACTION_VERSION;
};

export type ConceptAliasCandidateOperation = {
  type: "alias_candidate";
  conceptId: string;
  aliasLabel: string;
  normalizedAlias: string;
};

export type ConceptValidatedOperation =
  | ConceptNewConceptOperation
  | ConceptOccurrenceOperation
  | ConceptAliasCandidateOperation;

export type ConceptSkippedOperation = {
  type: "skip";
  evidenceRef: string;
  surfaceForm: string;
};

export type ConceptUncertainOperation = {
  type: "uncertain";
  evidenceRef: string;
  surfaceForm: string;
};

export type ConceptRejectedOperation = {
  type: "rejected";
  reason: ConceptResolveRejectReason;
  evidenceRef?: string;
  surfaceForm?: string;
  action?: ConceptExtractAction["action"];
  detail?: string;
};

export type ConceptRejectedAlias = {
  type: "alias_rejected";
  aliasLabel: string;
  reason: string;
  evidenceRef?: string;
  conceptId?: string;
};

export type ConceptProvisionalMatch = {
  type: "provisional_match";
  kind: "semantic";
  evidenceRef: string;
  surfaceForm: string;
  candidateConceptRef: string;
  existingCanonicalLabel: string;
};

export type ConceptActionOutcome = {
  originalAction: ConceptExtractAction["action"];
  evidenceRef: string;
  surfaceForm: string;
  status: "skip" | "uncertain" | "rejected" | "accepted" | "provisional_match";
  resolvedAs?: "match" | "new";
  matchKind?: ConceptMatchKind;
  conceptRef?: string;
  canonicalLabel?: string;
  aliases?: string[];
  candidateConceptRef?: string;
  existingCanonicalLabel?: string;
  rejectReason?: ConceptResolveRejectReason;
  detail?: string;
};

export type ConceptResolveResult = {
  nextCatalog: ConceptRegistrySnapshot;
  operations: ConceptValidatedOperation[];
  newConcepts: ConceptNewConceptOperation[];
  occurrences: ConceptOccurrenceOperation[];
  aliasCandidates: ConceptAliasCandidateOperation[];
  skipped: ConceptSkippedOperation[];
  uncertain: ConceptUncertainOperation[];
  rejected: ConceptRejectedOperation[];
  rejectedAliases: ConceptRejectedAlias[];
  provisionalMatches: ConceptProvisionalMatch[];
  outcomes: ConceptActionOutcome[];
};

export type ConceptResolveInput = {
  units: ConceptExtractUnit[];
  catalog: ConceptRegistrySnapshot;
  actions: ConceptExtractAction[];
};

type ResolvedIdentity = {
  conceptId: string;
  canonicalLabel: string;
  resolvedAs: "match" | "new";
  matchKind?: ConceptMatchKind;
  aliases: string[];
};

function reject(
  input: Omit<ConceptRejectedOperation, "type">,
): ConceptRejectedOperation {
  return { type: "rejected", ...input };
}

function provenanceFromUnit(unit: ConceptExtractUnit): {
  sessionId: string;
  messageId: string;
  evidenceRef: string;
  occurredAt: string;
  sourceRole: ConceptSourceRole;
  sourceType: ConceptSourceType;
  extractionVersion: typeof CONCEPT_EXTRACTION_VERSION;
} {
  return {
    sessionId: unit.sessionId,
    messageId: unit.messageId,
    evidenceRef: unit.evidenceRef,
    occurredAt: conceptThoughtOccurredAt({
      sourceCreatedAt: unit.sourceCreatedAt,
      sessionOccurredAt: unit.sessionOccurredAt,
    }),
    sourceRole: "user",
    sourceType: "evidence_unit",
    extractionVersion: CONCEPT_EXTRACTION_VERSION,
  };
}

function isRejectedOperation(
  value: ResolvedIdentity | ConceptRejectedOperation,
): value is ConceptRejectedOperation {
  return "type" in value && value.type === "rejected";
}

function toAliasOperations(
  conceptId: string,
  aliases: string[],
): ConceptAliasCandidateOperation[] {
  return aliases.map((aliasLabel) => ({
    type: "alias_candidate" as const,
    conceptId,
    aliasLabel,
    normalizedAlias: normalizeConceptKey(aliasLabel),
  }));
}

/**
 * Identity resolution 純関数。DB / LLM に依存しない。
 *
 * 同一 Unit では identity 解決後の unique concept を最大 3 件まで採用する。
 * 同一 concept への重複 action は duplicate_concept_in_unit とし、
 * 上限スロットは消費しない。
 */
export function resolveConceptActions(
  input: ConceptResolveInput,
): ConceptResolveResult {
  const unitsByRef = conceptExtractUnitsByRef(input.units);
  let catalog = cloneConceptCatalog(input.catalog);
  const operations: ConceptValidatedOperation[] = [];
  const newConcepts: ConceptNewConceptOperation[] = [];
  const occurrences: ConceptOccurrenceOperation[] = [];
  const aliasCandidates: ConceptAliasCandidateOperation[] = [];
  const skipped: ConceptSkippedOperation[] = [];
  const uncertain: ConceptUncertainOperation[] = [];
  const rejected: ConceptRejectedOperation[] = [];
  const rejectedAliases: ConceptRejectedAlias[] = [];
  const provisionalMatches: ConceptProvisionalMatch[] = [];
  const outcomes: ConceptActionOutcome[] = [];
  const acceptedByUnit = new Map<string, Set<string>>();
  const createdInBatch = new Set<string>();

  const recordRejected = (op: ConceptRejectedOperation) => {
    rejected.push(op);
    outcomes.push({
      originalAction: op.action ?? "new",
      evidenceRef: op.evidenceRef ?? "",
      surfaceForm: op.surfaceForm ?? "",
      status: "rejected",
      rejectReason: op.reason,
      detail: op.detail,
    });
  };

  const acceptOccurrence = (
    identity: ResolvedIdentity,
    unit: ConceptExtractUnit,
    action: ConceptExtractAction,
  ) => {
    const accepted = acceptedByUnit.get(unit.evidenceRef) ?? new Set<string>();
    if (accepted.has(identity.conceptId)) {
      recordRejected(
        reject({
          reason: "duplicate_concept_in_unit",
          evidenceRef: unit.evidenceRef,
          surfaceForm: action.surfaceForm,
          action: action.action,
        }),
      );
      return;
    }
    if (accepted.size >= MAX_CONCEPTS_PER_UNIT) {
      recordRejected(
        reject({
          reason: "max_concepts_per_unit",
          evidenceRef: unit.evidenceRef,
          surfaceForm: action.surfaceForm,
          action: action.action,
        }),
      );
      return;
    }

    const occurrenceInput = {
      conceptId: identity.conceptId,
      ...provenanceFromUnit(unit),
    };
    const occurrenceCheck = validateConceptOccurrence(occurrenceInput);
    if (!occurrenceCheck.ok) {
      recordRejected(
        reject({
          reason: "invalid_occurrence",
          evidenceRef: unit.evidenceRef,
          surfaceForm: action.surfaceForm,
          action: action.action,
          detail: occurrenceCheck.reason,
        }),
      );
      return;
    }

    accepted.add(identity.conceptId);
    acceptedByUnit.set(unit.evidenceRef, accepted);

    const newAliases = toAliasOperations(identity.conceptId, identity.aliases);
    if (identity.resolvedAs === "new") {
      let created = newConcepts.find(
        (item) => item.conceptId === identity.conceptId,
      );
      if (!created) {
        created = {
          type: "new_concept",
          conceptId: identity.conceptId,
          canonicalLabel: identity.canonicalLabel,
          normalizedKey: normalizeConceptKey(identity.canonicalLabel),
          aliases: identity.aliases,
        };
        newConcepts.push(created);
        operations.push(created);
        catalog = addConceptToCatalog(catalog, created);
        createdInBatch.add(identity.conceptId);
      } else {
        created.aliases = uniqueAliasLabels(created.canonicalLabel, [
          ...created.aliases,
          ...identity.aliases,
        ]);
        catalog = addAliasesToCatalog(
          catalog,
          identity.conceptId,
          identity.aliases,
        );
      }
    } else if (identity.aliases.length > 0) {
      catalog = addAliasesToCatalog(
        catalog,
        identity.conceptId,
        identity.aliases,
      );
    }

    const occurrence: ConceptOccurrenceOperation = {
      type: "occurrence",
      resolvedAs: identity.resolvedAs,
      matchKind: identity.matchKind,
      canonicalLabel: identity.canonicalLabel,
      ...occurrenceInput,
    };
    occurrences.push(occurrence);
    operations.push(occurrence);
    aliasCandidates.push(...newAliases);
    operations.push(...newAliases);
    outcomes.push({
      originalAction: action.action,
      evidenceRef: unit.evidenceRef,
      surfaceForm: action.surfaceForm,
      status: "accepted",
      resolvedAs: identity.resolvedAs,
      matchKind: identity.matchKind,
      conceptRef: lookupCatalogByConceptId(catalog, identity.conceptId)?.ref,
      canonicalLabel: identity.canonicalLabel,
      aliases: identity.aliases,
    });
  };

  const resolveNewFromSurface = (
    action: Extract<ConceptExtractAction, { action: "new" | "match" }>,
    matchKind?: ConceptMatchKind,
  ): ResolvedIdentity | ConceptRejectedOperation => {
    const candidate = validateConceptCandidate(action.surfaceForm);
    if (!candidate.ok) {
      return reject({
        reason: "invalid_candidate",
        evidenceRef: action.evidenceRef,
        surfaceForm: action.surfaceForm,
        action: action.action,
        detail: candidate.reason,
      });
    }
    if (containsHonorificPerson(candidate.canonicalLabel)) {
      return reject({
        reason: "honorific_person",
        evidenceRef: action.evidenceRef,
        surfaceForm: action.surfaceForm,
        action: action.action,
      });
    }
    const server = classifyServerIdentity(catalog, candidate.canonicalLabel);
    if (server.kind === "exact" || server.kind === "observed_alias") {
      return {
        conceptId: server.entry.conceptId,
        canonicalLabel: server.entry.canonicalLabel,
        resolvedAs: createdInBatch.has(server.entry.conceptId) ? "new" : "match",
        matchKind: server.kind,
        aliases: [],
      };
    }
    const existing = lookupCatalogByNormalizedKey(
      catalog,
      candidate.normalizedKey,
    );
    if (existing) {
      return {
        conceptId: existing.conceptId,
        canonicalLabel: existing.canonicalLabel,
        resolvedAs: createdInBatch.has(existing.conceptId) ? "new" : "match",
        matchKind: "exact",
        aliases: [],
      };
    }
    return {
      conceptId: virtualConceptId(candidate.normalizedKey),
      canonicalLabel: candidate.canonicalLabel,
      resolvedAs: "new",
      matchKind,
      aliases: [],
    };
  };

  const resolveLlmMatch = (
    action: Extract<ConceptExtractAction, { action: "match" }>,
  ): ResolvedIdentity | ConceptRejectedOperation => {
    const server = classifyServerIdentity(catalog, action.surfaceForm);
    if (server.kind === "exact" || server.kind === "observed_alias") {
      return {
        conceptId: server.entry.conceptId,
        canonicalLabel: server.entry.canonicalLabel,
        resolvedAs: createdInBatch.has(server.entry.conceptId) ? "new" : "match",
        matchKind: server.kind,
        aliases: [],
      };
    }
    const existing = lookupCatalogByRef(catalog, action.existingConceptRef);
    if (!existing) {
      return reject({
        reason: "unknown_concept_ref",
        evidenceRef: action.evidenceRef,
        surfaceForm: action.surfaceForm,
        action: action.action,
        detail: action.existingConceptRef,
      });
    }
    provisionalMatches.push({
      type: "provisional_match",
      kind: "semantic",
      evidenceRef: action.evidenceRef,
      surfaceForm: action.surfaceForm,
      candidateConceptRef: existing.ref,
      existingCanonicalLabel: existing.canonicalLabel,
    });
    outcomes.push({
      originalAction: "match",
      evidenceRef: action.evidenceRef,
      surfaceForm: action.surfaceForm,
      status: "provisional_match",
      matchKind: "semantic",
      candidateConceptRef: existing.ref,
      existingCanonicalLabel: existing.canonicalLabel,
    });
    return resolveNewFromSurface(action, "semantic");
  };

  for (const action of input.actions) {
    if (action.action === "skip" || action.action === "uncertain") {
      const lookup = lookupExtractUnit(action.evidenceRef, unitsByRef);
      if (!lookup.ok) {
        recordRejected(
          reject({
            reason: lookup.reason,
            evidenceRef: action.evidenceRef,
            surfaceForm: action.surfaceForm,
            action: action.action,
          }),
        );
        continue;
      }
      if (action.action === "skip") {
        skipped.push({
          type: "skip",
          evidenceRef: lookup.unit.evidenceRef,
          surfaceForm: action.surfaceForm,
        });
        outcomes.push({
          originalAction: "skip",
          evidenceRef: lookup.unit.evidenceRef,
          surfaceForm: action.surfaceForm,
          status: "skip",
        });
      } else {
        uncertain.push({
          type: "uncertain",
          evidenceRef: lookup.unit.evidenceRef,
          surfaceForm: action.surfaceForm,
        });
        outcomes.push({
          originalAction: "uncertain",
          evidenceRef: lookup.unit.evidenceRef,
          surfaceForm: action.surfaceForm,
          status: "uncertain",
        });
      }
      continue;
    }

    const grounded = groundSurfaceForm({
      evidenceRef: action.evidenceRef,
      surfaceForm: action.surfaceForm,
      unitsByRef,
    });
    if (!grounded.ok) {
      recordRejected(
        reject({
          reason: grounded.reason,
          evidenceRef: action.evidenceRef,
          surfaceForm: action.surfaceForm,
          action: action.action,
        }),
      );
      continue;
    }

    const identity =
      action.action === "match"
        ? resolveLlmMatch(action)
        : resolveNewFromSurface(action);
    if (isRejectedOperation(identity)) {
      recordRejected(identity);
      continue;
    }

    acceptOccurrence(identity, grounded.unit, action);
  }

  return {
    nextCatalog: catalog,
    operations,
    newConcepts,
    occurrences,
    aliasCandidates,
    skipped,
    uncertain,
    rejected,
    rejectedAliases,
    provisionalMatches,
    outcomes,
  };
}

export function stableResolveResult(result: ConceptResolveResult) {
  return JSON.stringify(result);
}