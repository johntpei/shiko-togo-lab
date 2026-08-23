import { asc, eq } from "drizzle-orm";
import type { ConceptExtractAction } from "@/lib/concepts/actions";
import {
  conceptExtractUnitsByRef,
  prepareUserEvidenceUnits,
  type ConceptExtractUnit,
} from "@/lib/concepts/user-units";
import {
  groundSurfaceForm,
  lookupExtractUnit,
} from "@/lib/concepts/grounding";
import {
  diagnoseSurfaceNotInUnit,
  type SurfaceNotInUnitDiagnostic,
} from "@/lib/concepts/grounding-diagnostic";
import { lookupCatalogByRef, type ConceptRegistrySnapshot } from "@/lib/concepts/catalog";
import { conceptThoughtOccurredAt } from "@/lib/concepts/occurred-at";
import { resolveConceptActions } from "@/lib/concepts/resolve";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { messages, sessions } from "@/lib/db/schema";
import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import {
  planIncrementalConceptCandidates,
  type IncrementalConceptPlan,
  type IncrementalGroundedCandidate,
} from "./plan";
import { loadConceptRegistrySnapshot } from "./registry";

/**
 * Extraction v4 の Grounded Candidate contract（ConceptExtractAction）。
 * sessionId / messageId / provenance は LLM が幻覚した場合の検証用で、
 * Server Evidence を上書きしない。
 */
export type IncrementalExtractedAction = ConceptExtractAction & {
  sessionId?: string;
  messageId?: string;
  sourceRole?: string;
  sourceType?: string;
  extractionVersion?: string;
  occurredAt?: string;
};

export type IncrementalCandidateExtractorContext = {
  catalog: ConceptRegistrySnapshot;
};

export type IncrementalCandidateExtractor = (
  evidenceUnits: ConceptExtractUnit[],
  context?: IncrementalCandidateExtractorContext,
) => Promise<IncrementalExtractedAction[]>;

export type IncrementalSessionPlanStatus = "planned" | "no_op" | "blocked";

export const ALL_ACTIONS_GROUNDING_REJECTED = "all_actions_grounding_rejected";

export type IncrementalPlanningActionCounts = {
  adapterActions: number;
  actionsEnteringGrounding: number;
  groundedActions: number;
  groundedCandidates: number;
  groundingRejectedCount: number;
};

export type IncrementalSessionPlanResult =
  | {
      status: "planned";
      sessionId: string;
      userEvidenceUnits: number;
      candidatesExtracted: number;
      existingMatches: number;
      newCandidates: number;
      provisionalNewCandidates: number;
      plans: IncrementalConceptPlan[];
      adapterActions: number;
      actionsEnteringGrounding: number;
      groundedActions: number;
      groundedCandidates: number;
      groundingRejectedCount: number;
      groundingRejections: SurfaceNotInUnitDiagnostic[];
    }
  | {
      status: "no_op";
      sessionId: string;
      userEvidenceUnits: number;
      candidatesExtracted: 0;
      existingMatches: 0;
      newCandidates: 0;
      provisionalNewCandidates: 0;
      plans: [];
      adapterActions: number;
      actionsEnteringGrounding: number;
      groundedActions: 0;
      groundedCandidates: 0;
      groundingRejectedCount: number;
      groundingRejections: SurfaceNotInUnitDiagnostic[];
    }
  | {
      status: "blocked";
      sessionId: string;
      code: string;
      detail: string;
      userEvidenceUnits: number;
      adapterActions: number;
      actionsEnteringGrounding: number;
      groundedActions: number;
      groundedCandidates: 0;
      groundingRejectedCount: number;
      groundingRejections: SurfaceNotInUnitDiagnostic[];
      groundingFailure: SurfaceNotInUnitDiagnostic | null;
    };

function emptyCounts(
  overrides: Partial<IncrementalPlanningActionCounts> = {},
): IncrementalPlanningActionCounts {
  return {
    adapterActions: 0,
    actionsEnteringGrounding: 0,
    groundedActions: 0,
    groundedCandidates: 0,
    groundingRejectedCount: 0,
    ...overrides,
  };
}

function blocked(
  sessionId: string,
  code: string,
  detail: string,
  userEvidenceUnits: number,
  extra: {
    adapterActions?: number;
    actionsEnteringGrounding?: number;
    groundedActions?: number;
    groundingRejectedCount?: number;
    groundingRejections?: SurfaceNotInUnitDiagnostic[];
    groundingFailure?: SurfaceNotInUnitDiagnostic | null;
  } = {},
): IncrementalSessionPlanResult {
  const rejections = extra.groundingRejections ?? [];
  return {
    status: "blocked",
    sessionId,
    code,
    detail,
    userEvidenceUnits,
    adapterActions: extra.adapterActions ?? 0,
    actionsEnteringGrounding: extra.actionsEnteringGrounding ?? 0,
    groundedActions: extra.groundedActions ?? 0,
    groundedCandidates: 0,
    groundingRejectedCount: extra.groundingRejectedCount ?? rejections.length,
    groundingRejections: rejections,
    groundingFailure: extra.groundingFailure ?? rejections[0] ?? null,
  };
}

function noOp(
  sessionId: string,
  userEvidenceUnits: number,
  counts: IncrementalPlanningActionCounts = emptyCounts(),
): IncrementalSessionPlanResult {
  return {
    status: "no_op",
    sessionId,
    userEvidenceUnits,
    candidatesExtracted: 0,
    existingMatches: 0,
    newCandidates: 0,
    provisionalNewCandidates: 0,
    plans: [],
    adapterActions: counts.adapterActions,
    actionsEnteringGrounding: counts.actionsEnteringGrounding,
    groundedActions: 0,
    groundedCandidates: 0,
    groundingRejectedCount: counts.groundingRejectedCount,
    groundingRejections: [],
  };
}

function loadSessionRow(db: ConceptQueryDb, sessionId: string) {
  return (
    db.select().from(sessions).where(eq(sessions.id, sessionId)).get() ?? null
  );
}

function loadSessionMessages(db: ConceptQueryDb, sessionId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.index))
    .all();
}

function toExtractActions(
  extracted: IncrementalExtractedAction[],
): ConceptExtractAction[] {
  return extracted.map((item) => {
    if (item.action === "match") {
      return {
        action: "match" as const,
        evidenceRef: item.evidenceRef,
        surfaceForm: item.surfaceForm,
        existingConceptRef: item.existingConceptRef,
      };
    }
    if (item.action === "new") {
      return {
        action: "new" as const,
        evidenceRef: item.evidenceRef,
        surfaceForm: item.surfaceForm,
      };
    }
    if (item.action === "skip") {
      return {
        action: "skip" as const,
        evidenceRef: item.evidenceRef,
        surfaceForm: item.surfaceForm,
      };
    }
    return {
      action: "uncertain" as const,
      evidenceRef: item.evidenceRef,
      surfaceForm: item.surfaceForm,
    };
  });
}

type GroundExtractedActionsResult =
  | {
      ok: true;
      kept: IncrementalExtractedAction[];
      groundedActions: number;
      rejections: SurfaceNotInUnitDiagnostic[];
    }
  | {
      ok: false;
      code: string;
      detail: string;
      groundingFailure: SurfaceNotInUnitDiagnostic | null;
      rejections: SurfaceNotInUnitDiagnostic[];
    };

/**
 * surface_not_in_unit だけ action 単位で reject し、他の grounded action は残す。
 * provenance / evidence lookup など構造的 failure は従来どおり全体 blocked。
 * Grounding accept 条件（exact contiguous substring）は変更しない。
 */
function groundExtractedActions(
  extracted: IncrementalExtractedAction[],
  sessionId: string,
  units: ConceptExtractUnit[],
): GroundExtractedActionsResult {
  const unitsByRef = conceptExtractUnitsByRef(units);
  const kept: IncrementalExtractedAction[] = [];
  const rejections: SurfaceNotInUnitDiagnostic[] = [];

  const structuralFail = (
    code: string,
    detail: string,
    groundingFailure: SurfaceNotInUnitDiagnostic | null = null,
  ): GroundExtractedActionsResult => ({
    ok: false,
    code,
    detail,
    groundingFailure,
    rejections,
  });

  for (const [actionIndex, action] of extracted.entries()) {
    if (action.sessionId && action.sessionId !== sessionId) {
      return structuralFail(
        "cross_session_provenance",
        `${action.evidenceRef}:${action.sessionId}`,
      );
    }
    if (action.action === "skip" || action.action === "uncertain") {
      kept.push(action);
      continue;
    }
    const grounded = groundSurfaceForm({
      evidenceRef: action.evidenceRef,
      surfaceForm: action.surfaceForm,
      unitsByRef,
    });
    if (!grounded.ok) {
      if (grounded.reason === "surface_not_in_unit") {
        const lookup = lookupExtractUnit(action.evidenceRef, unitsByRef);
        if (!lookup.ok) {
          return structuralFail(lookup.reason, action.evidenceRef);
        }
        rejections.push(
          diagnoseSurfaceNotInUnit({
            actionIndex,
            evidenceRef: action.evidenceRef,
            surfaceForm: action.surfaceForm,
            unitText: lookup.unit.text,
          }),
        );
        continue;
      }
      return structuralFail(grounded.reason, action.evidenceRef);
    }
    if (grounded.unit.sessionId !== sessionId) {
      return structuralFail("cross_session_provenance", grounded.unit.sessionId);
    }
    if (action.messageId && action.messageId !== grounded.unit.messageId) {
      return structuralFail(
        "evidence_message_mismatch",
        `${action.evidenceRef}:${action.messageId}`,
      );
    }
    if (action.sourceRole && action.sourceRole !== "user") {
      return structuralFail(
        "provenance_mismatch",
        `${action.evidenceRef}:sourceRole=${action.sourceRole}`,
      );
    }
    if (action.sourceType && action.sourceType !== "evidence_unit") {
      return structuralFail(
        "provenance_mismatch",
        `${action.evidenceRef}:sourceType=${action.sourceType}`,
      );
    }
    if (
      action.extractionVersion &&
      action.extractionVersion !== CONCEPT_EXTRACTION_VERSION
    ) {
      return structuralFail(
        "invalid_extraction_version",
        `${action.evidenceRef}:${action.extractionVersion}`,
      );
    }
    const occurredAt = conceptThoughtOccurredAt({
      sourceCreatedAt: grounded.unit.sourceCreatedAt,
      sessionOccurredAt: grounded.unit.sessionOccurredAt,
    });
    if (action.occurredAt && action.occurredAt !== occurredAt) {
      return structuralFail(
        "provenance_mismatch",
        `${action.evidenceRef}:occurredAt`,
      );
    }
    kept.push(action);
  }

  return {
    ok: true,
    kept,
    groundedActions: kept.filter(
      (item) => item.action === "new" || item.action === "match",
    ).length,
    rejections,
  };
}

function candidatesFromResolve(
  units: ConceptExtractUnit[],
  resolve: ReturnType<typeof resolveConceptActions>,
  registry: ConceptRegistrySnapshot,
): IncrementalGroundedCandidate[] {
  const unitsByRef = conceptExtractUnitsByRef(units);
  const accepted = resolve.outcomes.filter((item) => item.status === "accepted");
  return resolve.occurrences.map((occurrence, index) => {
    const outcome = accepted.find(
      (item) =>
        item.evidenceRef === occurrence.evidenceRef &&
        item.canonicalLabel === occurrence.canonicalLabel,
    );
    const unit = unitsByRef.get(occurrence.evidenceRef);
    const surfaceForm = outcome?.surfaceForm ?? occurrence.canonicalLabel;
    const provisional = resolve.provisionalMatches.find(
      (item) =>
        item.evidenceRef === occurrence.evidenceRef &&
        item.surfaceForm === surfaceForm,
    );
    const provisionalConcept = provisional
      ? lookupCatalogByRef(registry, provisional.candidateConceptRef)
      : null;
    const occurredAt = unit
      ? conceptThoughtOccurredAt({
          sourceCreatedAt: unit.sourceCreatedAt,
          sessionOccurredAt: unit.sessionOccurredAt,
        })
      : occurrence.occurredAt;
    return {
      candidateRef: `${occurrence.conceptId}:${occurrence.evidenceRef}:${index}`,
      canonicalLabel: occurrence.canonicalLabel,
      surfaceForm,
      sessionId: occurrence.sessionId,
      messageId: occurrence.messageId,
      evidenceRef: occurrence.evidenceRef,
      occurredAt,
      sourceRole: occurrence.sourceRole,
      sourceType: occurrence.sourceType,
      extractionVersion: occurrence.extractionVersion,
      matchKind: occurrence.matchKind ?? null,
      resolvedAs: occurrence.resolvedAs,
      provisional:
        occurrence.matchKind === "semantic" && provisional
          ? {
              conceptId: provisionalConcept?.conceptId,
              conceptRef: provisional.candidateConceptRef,
              existingCanonicalLabel: provisional.existingCanonicalLabel,
            }
          : null,
    };
  });
}

/**
 * 1 Session → USER Evidence Units → injected extractor → Resolver → Planner。
 * read-only。Occurrence write / OpenAI は行わない。
 */
export async function planIncrementalSession(input: {
  sessionId: string;
  db: ConceptQueryDb;
  extractCandidates: IncrementalCandidateExtractor;
}): Promise<IncrementalSessionPlanResult> {
  const session = loadSessionRow(input.db, input.sessionId);
  if (!session) {
    return blocked(input.sessionId, "missing_session", input.sessionId, 0);
  }

  const rows = loadSessionMessages(input.db, input.sessionId);
  const units = prepareUserEvidenceUnits({
    sessionId: session.id,
    occurredAt: session.occurredAt,
    messages: rows.map((item) => ({
      id: item.id,
      role: item.role,
      content: item.content,
      sourceCreatedAt: item.sourceCreatedAt,
    })),
  });

  if (units.length === 0) {
    return noOp(input.sessionId, 0);
  }

  const registry = loadConceptRegistrySnapshot(input.db);

  let extracted: IncrementalExtractedAction[];
  try {
    extracted = await input.extractCandidates(units, { catalog: registry });
  } catch (error) {
    return blocked(
      input.sessionId,
      "extractor_failed",
      error instanceof Error ? error.message : String(error),
      units.length,
    );
  }

  const adapterActions = extracted.length;
  const actionsEnteringGrounding = extracted.filter(
    (item) => item.action === "new" || item.action === "match",
  ).length;

  const groundedPass = groundExtractedActions(
    extracted,
    input.sessionId,
    units,
  );
  if (!groundedPass.ok) {
    return blocked(
      input.sessionId,
      groundedPass.code,
      groundedPass.detail,
      units.length,
      {
        adapterActions,
        actionsEnteringGrounding,
        groundingRejections: groundedPass.rejections,
        groundingFailure: groundedPass.groundingFailure,
      },
    );
  }

  if (actionsEnteringGrounding > 0 && groundedPass.groundedActions === 0) {
    return blocked(
      input.sessionId,
      ALL_ACTIONS_GROUNDING_REJECTED,
      `${actionsEnteringGrounding} actions rejected at grounding`,
      units.length,
      {
        adapterActions,
        actionsEnteringGrounding,
        groundedActions: 0,
        groundingRejections: groundedPass.rejections,
        groundingFailure: groundedPass.rejections[0] ?? null,
      },
    );
  }

  const actions = toExtractActions(groundedPass.kept);
  const extractedCount = actions.filter(
    (item) => item.action === "new" || item.action === "match",
  ).length;
  const extractedCounts = emptyCounts({
    adapterActions,
    actionsEnteringGrounding,
    groundingRejectedCount: groundedPass.rejections.length,
  });
  if (extractedCount === 0) {
    return noOp(input.sessionId, units.length, extractedCounts);
  }

  const resolved = resolveConceptActions({
    units,
    catalog: registry,
    actions,
  });
  const rejected = resolved.rejected.filter(
    (item) => item.action === "new" || item.action === "match",
  );
  if (rejected.length > 0) {
    const first = rejected[0]!;
    return blocked(
      input.sessionId,
      first.reason,
      first.detail ?? first.evidenceRef ?? first.reason,
      units.length,
      {
        adapterActions,
        actionsEnteringGrounding,
        groundedActions: groundedPass.groundedActions,
        groundingRejections: groundedPass.rejections,
      },
    );
  }

  const grounded = candidatesFromResolve(units, resolved, registry);
  if (grounded.length === 0) {
    return noOp(input.sessionId, units.length, extractedCounts);
  }

  const planned = planIncrementalConceptCandidates(grounded, registry);
  const existingMatches = planned.plans.filter(
    (item) => item.kind === "existing_match",
  ).length;
  const newCandidates = planned.plans.filter((item) => item.kind === "new").length;
  const provisionalNewCandidates = planned.plans.filter(
    (item) => item.kind === "provisional_new",
  ).length;

  return {
    status: "planned",
    sessionId: input.sessionId,
    userEvidenceUnits: units.length,
    candidatesExtracted: extractedCount,
    existingMatches,
    newCandidates,
    provisionalNewCandidates,
    plans: planned.plans,
    adapterActions,
    actionsEnteringGrounding,
    groundedActions: groundedPass.groundedActions,
    groundedCandidates: grounded.length,
    groundingRejectedCount: groundedPass.rejections.length,
    groundingRejections: groundedPass.rejections,
  };
}
