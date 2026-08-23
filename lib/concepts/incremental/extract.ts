import { emptyConceptCatalog, type ConceptRegistrySnapshot } from "@/lib/concepts/catalog";
import {
  runConceptExtractOnUnits,
  type ConceptExtractDeps,
} from "@/lib/ai/tasks/concept-extract";
import type {
  IncrementalCandidateExtractor,
  IncrementalExtractedAction,
} from "./session-plan";

export class IncrementalExtractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "IncrementalExtractError";
    this.code = code;
  }
}

export type ProductionIncrementalExtractorDeps = ConceptExtractDeps & {
  conceptCatalog?: ConceptRegistrySnapshot;
};

function candidateActions(
  actions: IncrementalExtractedAction[],
): IncrementalExtractedAction[] {
  return actions.filter(
    (item) => item.action === "new" || item.action === "match",
  );
}

function resolveExtractCatalog(
  deps: ProductionIncrementalExtractorDeps,
  catalog?: ConceptRegistrySnapshot,
) {
  return catalog ?? deps.conceptCatalog ?? emptyConceptCatalog();
}

/**
 * Frozen Extraction v4 を IncrementalCandidateExtractor へ接続する。
 * Catalog は inject する。adapter は DB を開かない。
 */
export function createProductionIncrementalCandidateExtractor(
  deps: ProductionIncrementalExtractorDeps,
): IncrementalCandidateExtractor {
  return async (evidenceUnits, context) => {
    const sessionId = evidenceUnits[0]?.sessionId ?? "";
    const extracted = await runConceptExtractOnUnits(
      {
        sessionId,
        units: evidenceUnits,
        catalog: resolveExtractCatalog(deps, context?.catalog),
      },
      deps,
    );
    if (!extracted.ok) {
      throw new IncrementalExtractError(extracted.code, extracted.error);
    }
    return candidateActions(extracted.actions);
  };
}
