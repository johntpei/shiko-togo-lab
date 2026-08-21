import type { ConceptExtractAction } from "./actions";
import {
  addAliasesToCatalog,
  addConceptToCatalog,
  cloneConceptCatalog,
  collectAliasCandidates,
  lookupCatalogByNormalizedKey,
  lookupCatalogByRef,
  uniqueAliasLabels,
  virtualConceptId,
  type ConceptRegistrySnapshot,
} from "./catalog";
import { validateConceptCandidate } from "./candidate";
import { groundSurfaceForm, lookupExtractUnit } from "./grounding";
import { isHonorificPersonLabel } from "./honorific";
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

export const MAX_CONCEPTS_PER_UNIT = 3;

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

export type ConceptResolveResult = {
  nextCatalog: ConceptRegistrySnapshot;
  operations: ConceptValidatedOperation[];
  newConcepts: ConceptNewConceptOperation[];
  occurrences: ConceptOccurrenceOperation[];
  aliasCandidates: ConceptAliasCandidateOperation[];
  skipped: ConceptSkippedOperation[];
  uncertain: ConceptUncertainOperation[];
  rejected: ConceptRejectedOperation[];
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
  const acceptedByUnit = new Map<string, Set<string>>();
  const createdInBatch = new Set<string>();

  const acceptOccurrence = (
    identity: ResolvedIdentity,
    unit: ConceptExtractUnit,
    action: ConceptExtractAction,
  ) => {
    const accepted = acceptedByUnit.get(unit.evidenceRef) ?? new Set<string>();
    if (accepted.has(identity.conceptId)) {
      rejected.push(
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
      rejected.push(
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
      rejected.push(
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
      canonicalLabel: identity.canonicalLabel,
      ...occurrenceInput,
    };
    occurrences.push(occurrence);
    operations.push(occurrence);
    aliasCandidates.push(...newAliases);
    operations.push(...newAliases);
  };

  const resolveNewIdentity = (
    action: Extract<ConceptExtractAction, { action: "new" }>,
  ): ResolvedIdentity | ConceptRejectedOperation => {
    const candidate = validateConceptCandidate(action.proposedCanonicalLabel);
    if (!candidate.ok) {
      return reject({
        reason: "invalid_candidate",
        evidenceRef: action.evidenceRef,
        surfaceForm: action.surfaceForm,
        action: action.action,
        detail: candidate.reason,
      });
    }
    if (isHonorificPersonLabel(candidate.canonicalLabel)) {
      return reject({
        reason: "honorific_person",
        evidenceRef: action.evidenceRef,
        surfaceForm: action.surfaceForm,
        action: action.action,
      });
    }
    const aliases = collectAliasCandidates({
      canonicalLabel: candidate.canonicalLabel,
      surfaceForm: action.surfaceForm,
      proposedAliases: action.aliases,
    });
    const existing = lookupCatalogByNormalizedKey(
      catalog,
      candidate.normalizedKey,
    );
    if (existing) {
      return {
        conceptId: existing.conceptId,
        canonicalLabel: existing.canonicalLabel,
        resolvedAs: createdInBatch.has(existing.conceptId) ? "new" : "match",
        aliases,
      };
    }
    return {
      conceptId: virtualConceptId(candidate.normalizedKey),
      canonicalLabel: candidate.canonicalLabel,
      resolvedAs: "new",
      aliases,
    };
  };

  const resolveMatchIdentity = (
    action: Extract<ConceptExtractAction, { action: "match" }>,
  ): ResolvedIdentity | ConceptRejectedOperation => {
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
    return {
      conceptId: existing.conceptId,
      canonicalLabel: existing.canonicalLabel,
      resolvedAs: "match",
      aliases: [],
    };
  };

  for (const action of input.actions) {
    if (action.action === "skip" || action.action === "uncertain") {
      const lookup = lookupExtractUnit(action.evidenceRef, unitsByRef);
      if (!lookup.ok) {
        rejected.push(
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
      } else {
        uncertain.push({
          type: "uncertain",
          evidenceRef: lookup.unit.evidenceRef,
          surfaceForm: action.surfaceForm,
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
      rejected.push(
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
        ? resolveMatchIdentity(action)
        : resolveNewIdentity(action);
    if (isRejectedOperation(identity)) {
      rejected.push(identity);
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
  };
}

export function stableResolveResult(result: ConceptResolveResult) {
  return JSON.stringify(result);
}