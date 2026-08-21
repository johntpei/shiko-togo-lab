export const CONCEPT_EXTRACT_ACTIONS = [
  "match",
  "new",
  "skip",
  "uncertain",
] as const;

export type ConceptExtractActionKind = (typeof CONCEPT_EXTRACT_ACTIONS)[number];

export const MAX_PROPOSED_ALIASES = 2;

type ConceptExtractActionBase = {
  evidenceRef: string;
  surfaceForm: string;
};

export type ConceptMatchAction = ConceptExtractActionBase & {
  action: "match";
  existingConceptRef: string;
};

export type ConceptNewAction = ConceptExtractActionBase & {
  action: "new";
  proposedCanonicalLabel: string;
  aliases?: string[];
};

export type ConceptSkipAction = ConceptExtractActionBase & {
  action: "skip";
};

export type ConceptUncertainAction = ConceptExtractActionBase & {
  action: "uncertain";
};

/**
 * 将来 LLM Structured Output から受け取る action。
 * role / messageId / sessionId / occurredAt は含めない。
 */
export type ConceptExtractAction =
  | ConceptMatchAction
  | ConceptNewAction
  | ConceptSkipAction
  | ConceptUncertainAction;
