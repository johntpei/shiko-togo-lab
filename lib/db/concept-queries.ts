import { and, eq } from "drizzle-orm";
import { getDb } from "./client";
import {
  conceptAliases,
  conceptOccurrences,
  concepts,
  type ConceptAliasRecord,
  type ConceptOccurrenceRecord,
  type ConceptRecord,
} from "./schema";
import { validateConceptCandidate } from "@/lib/concepts/candidate";
import { normalizeConceptKey, normalizeConceptLabel } from "@/lib/concepts/normalize";
import {
  validateConceptOccurrence,
  type ConceptOccurrenceInput,
} from "@/lib/concepts/occurrence";
import { CONCEPT_MATCHING_VERSION } from "@/lib/concepts/types";

type AppDb = ReturnType<typeof getDb>;

export type ConceptQueryDb = AppDb;

export type NewConceptInsert = {
  id: string;
  canonicalLabel: string;
  matchingVersion?: string;
  createdAt: string;
};

export type NewConceptAliasInsert = {
  conceptId: string;
  aliasLabel: string;
};

export type NewConceptOccurrenceInsert = ConceptOccurrenceInput & {
  id: string;
};

export type ConceptInsertResult =
  | { status: "inserted"; record: ConceptRecord }
  | { status: "skipped"; reason: "invalid_candidate" | "duplicate_normalized_key" };

export type ConceptAliasInsertResult =
  | { status: "inserted"; record: ConceptAliasRecord }
  | { status: "skipped"; reason: "empty_alias" | "duplicate_alias" };

export type ConceptOccurrenceInsertResult =
  | { status: "inserted"; record: ConceptOccurrenceRecord }
  | {
      status: "skipped";
      reason: "invalid_occurrence" | "duplicate_identity";
      detail?: string;
    };

function isUniqueConstraintError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const message = "message" in error ? String(error.message) : "";
  return (
    message.includes("UNIQUE constraint failed") ||
    message.includes("concepts_normalized_key_unique") ||
    message.includes("concept_occurrences_identity_unique") ||
    message.includes("concept_aliases")
  );
}

export function findConceptByNormalizedKey(
  normalizedKey: string,
  db: AppDb = getDb(),
) {
  return (
    db
      .select()
      .from(concepts)
      .where(eq(concepts.normalizedKey, normalizedKey))
      .get() ?? null
  );
}

export function listConcepts(db: AppDb = getDb()) {
  return db.select().from(concepts).all();
}

export function countConcepts(db: AppDb = getDb()) {
  return listConcepts(db).length;
}

export function insertConcept(
  input: NewConceptInsert,
  db: AppDb = getDb(),
): ConceptInsertResult {
  const candidate = validateConceptCandidate(input.canonicalLabel);
  if (!candidate.ok) {
    return { status: "skipped", reason: "invalid_candidate" };
  }
  const matchingVersion = input.matchingVersion ?? CONCEPT_MATCHING_VERSION;
  try {
    db.insert(concepts)
      .values({
        id: input.id,
        canonicalLabel: candidate.canonicalLabel,
        normalizedKey: candidate.normalizedKey,
        matchingVersion,
        createdAt: input.createdAt,
      })
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { status: "skipped", reason: "duplicate_normalized_key" };
    }
    throw error;
  }
  const record = db
    .select()
    .from(concepts)
    .where(eq(concepts.id, input.id))
    .get();
  if (!record) {
    throw new Error("Concept insert succeeded but row was not found.");
  }
  return { status: "inserted", record };
}

export function insertConceptAlias(
  input: NewConceptAliasInsert,
  db: AppDb = getDb(),
): ConceptAliasInsertResult {
  const aliasLabel = normalizeConceptLabel(input.aliasLabel);
  const normalizedAlias = normalizeConceptKey(input.aliasLabel);
  if (!aliasLabel || !normalizedAlias) {
    return { status: "skipped", reason: "empty_alias" };
  }
  try {
    db.insert(conceptAliases)
      .values({
        conceptId: input.conceptId,
        aliasLabel,
        normalizedAlias,
      })
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { status: "skipped", reason: "duplicate_alias" };
    }
    throw error;
  }
  const record = db
    .select()
    .from(conceptAliases)
    .where(
      and(
        eq(conceptAliases.conceptId, input.conceptId),
        eq(conceptAliases.normalizedAlias, normalizedAlias),
      ),
    )
    .get();
  if (!record) {
    throw new Error("Concept alias insert succeeded but row was not found.");
  }
  return { status: "inserted", record };
}

export function insertConceptOccurrence(
  input: NewConceptOccurrenceInsert,
  db: AppDb = getDb(),
): ConceptOccurrenceInsertResult {
  const validated = validateConceptOccurrence(input);
  if (!validated.ok) {
    return {
      status: "skipped",
      reason: "invalid_occurrence",
      detail: validated.reason,
    };
  }
  try {
    db.insert(conceptOccurrences)
      .values({
        id: input.id,
        conceptId: input.conceptId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        evidenceRef: input.evidenceRef,
        occurredAt: input.occurredAt,
        sourceRole: validated.sourceRole,
        sourceType: validated.sourceType,
        extractionVersion: validated.extractionVersion,
      })
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { status: "skipped", reason: "duplicate_identity" };
    }
    throw error;
  }
  const record = db
    .select()
    .from(conceptOccurrences)
    .where(eq(conceptOccurrences.id, input.id))
    .get();
  if (!record) {
    throw new Error("Concept occurrence insert succeeded but row was not found.");
  }
  return { status: "inserted", record };
}

export function countConceptOccurrences(db: AppDb = getDb()) {
  return db.select().from(conceptOccurrences).all().length;
}

export function countConceptAliases(db: AppDb = getDb()) {
  return db.select().from(conceptAliases).all().length;
}
