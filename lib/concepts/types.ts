export const CONCEPT_MATCHING_VERSION = "concept-matching-v1";

export type ConceptMatchingVersion = typeof CONCEPT_MATCHING_VERSION;

export const CONCEPT_EXTRACTION_VERSION = "concept-extraction-v1";

export type ConceptExtractionVersion = typeof CONCEPT_EXTRACTION_VERSION;

export const CONCEPT_SOURCE_ROLES = ["user"] as const;

export type ConceptSourceRole = (typeof CONCEPT_SOURCE_ROLES)[number];

export const CONCEPT_SOURCE_TYPES = ["evidence_unit"] as const;

export type ConceptSourceType = (typeof CONCEPT_SOURCE_TYPES)[number];

export type Concept = {
  id: string;
  canonicalLabel: string;
  normalizedKey: string;
  matchingVersion: ConceptMatchingVersion;
  createdAt: string;
};

export type ConceptAlias = {
  conceptId: string;
  aliasLabel: string;
  normalizedAlias: string;
};

export type ConceptOccurrence = {
  id: string;
  conceptId: string;
  sessionId: string;
  messageId: string;
  evidenceRef: string;
  occurredAt: string;
  sourceRole: ConceptSourceRole;
  sourceType: ConceptSourceType;
  extractionVersion: ConceptExtractionVersion;
};

export type ConceptOccurrenceIdentity = {
  extractionVersion: string;
  sourceType: string;
  messageId: string;
  evidenceRef: string;
  conceptId: string;
};
