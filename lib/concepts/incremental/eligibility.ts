import { eq } from "drizzle-orm";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import { hashSourceArtifactText } from "@/lib/concepts/admission/apply-manifest";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { sessions } from "@/lib/db/schema";
import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import {
  CONCEPT_INCREMENTAL_PROCESSING_VERSION,
  hasIncrementalConceptProcessingCheckpoint,
} from "./checkpoint";

export type InitialConceptProcessingCoverage = {
  sessionIds: string[];
  sourceHash: string;
  extractPromptVersion: string;
  extractionVersion: string;
};

export type InitialConceptProcessingCoverageLoad =
  | { ok: true; coverage: InitialConceptProcessingCoverage }
  | { ok: false; code: string; detail: string };

export type IncrementalSessionEligibility =
  | {
      status: "eligible";
      sessionId: string;
    }
  | {
      status: "already_covered";
      sessionId: string;
      reason: string;
    }
  | {
      status: "blocked";
      sessionId: string;
      reason: string;
    };

function failLoad(
  code: string,
  detail: string,
): InitialConceptProcessingCoverageLoad {
  return { ok: false, code, detail };
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      return null;
    }
    ids.push(item);
  }
  return ids;
}

function sessionIdsFromRows(rows: unknown): string[] | null {
  if (!Array.isArray(rows)) {
    return [];
  }
  const ids: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      return null;
    }
    const sessionId = (row as { sessionId?: unknown }).sessionId;
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      return null;
    }
    ids.push(sessionId);
  }
  return ids;
}

function uniqueSorted(ids: string[]) {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

/**
 * Initial Candidate artifact（concept-pilot-2b-v4 相当）から
 * processing coverage を復元する。ADMIT 結果 / Occurrence / Calibration は見ない。
 */
export function loadInitialConceptProcessingCoverage(input: {
  candidateReportText: string;
  expectedSourceHash: string;
}): InitialConceptProcessingCoverageLoad {
  let raw: unknown;
  try {
    raw = JSON.parse(input.candidateReportText);
  } catch {
    return failLoad("malformed_coverage", "candidate_report_json");
  }
  if (!raw || typeof raw !== "object") {
    return failLoad("malformed_coverage", "candidate_report_object");
  }

  const sourceHash = hashSourceArtifactText(input.candidateReportText);
  if (sourceHash !== input.expectedSourceHash) {
    return failLoad("source_hash_mismatch", sourceHash);
  }

  const metadata = (raw as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") {
    return failLoad("malformed_coverage", "metadata");
  }
  const selected = asStringArray(
    (metadata as { selectedSessionIds?: unknown }).selectedSessionIds,
  );
  if (!selected) {
    return failLoad("malformed_coverage", "selectedSessionIds");
  }

  const extractPromptVersion = (metadata as { promptVersion?: unknown })
    .promptVersion;
  const extractionVersion = (metadata as { extractionVersion?: unknown })
    .extractionVersion;
  if (extractPromptVersion !== CONCEPT_EXTRACT_PROMPT_VERSION) {
    return failLoad(
      "coverage_version_mismatch",
      String(extractPromptVersion ?? ""),
    );
  }
  if (extractionVersion !== CONCEPT_EXTRACTION_VERSION) {
    return failLoad(
      "coverage_version_mismatch",
      String(extractionVersion ?? ""),
    );
  }

  const actionIds = sessionIdsFromRows((raw as { actions?: unknown }).actions);
  if (!actionIds) {
    return failLoad("malformed_coverage", "actions");
  }
  const failedIds = sessionIdsFromRows(
    (raw as { failedSessions?: unknown }).failedSessions ?? [],
  );
  if (!failedIds) {
    return failLoad("malformed_coverage", "failedSessions");
  }
  const selectedSet = new Set(selected);
  const leaked = [...actionIds, ...failedIds].find((id) => !selectedSet.has(id));
  if (leaked) {
    return failLoad("malformed_coverage", `session_outside_selected:${leaked}`);
  }

  return {
    ok: true,
    coverage: {
      sessionIds: uniqueSorted(selected),
      sourceHash,
      extractPromptVersion,
      extractionVersion,
    },
  };
}

function loadSessionRow(db: ConceptQueryDb, sessionId: string) {
  return (
    db.select().from(sessions).where(eq(sessions.id, sessionId)).get() ?? null
  );
}

/**
 * Initial processing coverage と Incremental completion checkpoint に対する
 * Session eligibility。ConceptOccurrence / Concept の有無では判定しない。
 * Extraction は実行しない。
 */
export function evaluateIncrementalSessionEligibility(input: {
  sessionId: string;
  db: ConceptQueryDb;
  coverage: InitialConceptProcessingCoverageLoad;
}): IncrementalSessionEligibility {
  if (!input.coverage.ok) {
    return {
      status: "blocked",
      sessionId: input.sessionId,
      reason: input.coverage.code,
    };
  }
  if (!Array.isArray(input.coverage.coverage.sessionIds)) {
    return {
      status: "blocked",
      sessionId: input.sessionId,
      reason: "coverage_unresolved",
    };
  }

  const session = loadSessionRow(input.db, input.sessionId);
  if (!session) {
    return {
      status: "blocked",
      sessionId: input.sessionId,
      reason: "missing_session",
    };
  }

  if (input.coverage.coverage.sessionIds.includes(input.sessionId)) {
    return {
      status: "already_covered",
      sessionId: input.sessionId,
      reason: "initial_processing_coverage",
    };
  }

  if (
    hasIncrementalConceptProcessingCheckpoint({
      sessionId: input.sessionId,
      processingVersion: CONCEPT_INCREMENTAL_PROCESSING_VERSION,
      db: input.db,
    })
  ) {
    return {
      status: "already_covered",
      sessionId: input.sessionId,
      reason: "incremental_processing_checkpoint",
    };
  }

  return { status: "eligible", sessionId: input.sessionId };
}
