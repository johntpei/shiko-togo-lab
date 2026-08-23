import type { ObservationConceptSupportDb } from "@/lib/db/observation-concept-support-queries";
import {
  planObservationConceptEvidenceSupports,
  reconcileObservationConceptEvidenceSupports,
} from "./reconcile-concept-evidence-supports";
import {
  RELATION_RECONCILIATION_FAILED_CODE,
  normalizeAffectedSessionIds,
  runObservationConceptRelationReconciliationAfterCommit,
} from "./observation-concept-relation-lifecycle";

export const OBSERVATION_CONCEPT_RELATION_CLI_HELP = `Usage:
  npm run observation:concept-relations-reconcile -- --session <session-id>
    Read-only preview of derived Observation↔Concept exact-evidence supports.

  npm run observation:concept-relations-reconcile -- --session <session-id> --apply
    Write missing supports for the given session scope. Primary data is not modified.

--session is required and may be repeated. Global scan is not supported.
Does not print Observation body, quotes, or USER text.
`;

export type ObservationConceptRelationCliArgs = {
  apply: boolean;
  help: boolean;
  sessionIds: string[];
  error: string | null;
};

export function parseObservationConceptRelationCliArgs(
  argv: string[],
): ObservationConceptRelationCliArgs {
  let apply = false;
  let help = false;
  const sessionIds: string[] = [];
  let error: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--session") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        error = "missing_session";
        continue;
      }
      sessionIds.push(value);
      index += 1;
      continue;
    }
    if (!error) {
      error = arg.startsWith("--")
        ? `unknown_option:${arg}`
        : `unexpected_arg:${arg}`;
    }
  }

  const normalized = normalizeAffectedSessionIds(sessionIds);
  if (!help && !error && normalized.length === 0) {
    error = "session_required";
  }

  return { apply, help, sessionIds: normalized, error };
}

export type ObservationConceptRelationCliResult =
  | {
      ok: true;
      mode: "preview";
      sessionIds: string[];
      desiredSupportCount: number;
      existingSupportCount: number;
      missingSupportCount: number;
      uniqueObservationConceptPairs: number;
      wrote: 0;
    }
  | {
      ok: true;
      mode: "apply";
      sessionIds: string[];
      status: "ready" | "not_needed" | "failed";
      desiredSupportCount: number;
      created: number;
      alreadyPresent: number;
      removed: 0;
      uniqueObservationConceptPairs: number;
      wrote: number;
    }
  | { ok: false; error: string };

export function runObservationConceptRelationCli(
  argv: string[],
  deps: { db: ObservationConceptSupportDb; now?: () => string },
): ObservationConceptRelationCliResult {
  const parsed = parseObservationConceptRelationCliArgs(argv);
  if (parsed.help) {
    return { ok: false, error: "help" };
  }
  if (parsed.error) {
    return { ok: false, error: parsed.error };
  }

  if (!parsed.apply) {
    const plan = planObservationConceptEvidenceSupports(
      parsed.sessionIds,
      deps.db,
    );
    return {
      ok: true,
      mode: "preview",
      sessionIds: plan.sessionsChecked,
      desiredSupportCount: plan.desired.length,
      existingSupportCount: plan.existingCount,
      missingSupportCount: plan.missing.length,
      uniqueObservationConceptPairs: plan.uniqueObservationConceptPairs,
      wrote: 0,
    };
  }

  const result = runObservationConceptRelationReconciliationAfterCommit(
    { sessionIds: parsed.sessionIds },
    {
      db: deps.db,
      now: deps.now,
      reconcile: reconcileObservationConceptEvidenceSupports,
    },
  );
  if (result.status === "not_needed") {
    return {
      ok: true,
      mode: "apply",
      sessionIds: parsed.sessionIds,
      status: "not_needed",
      desiredSupportCount: 0,
      created: 0,
      alreadyPresent: 0,
      removed: 0,
      uniqueObservationConceptPairs: 0,
      wrote: 0,
    };
  }
  if (result.status === "failed") {
    return { ok: false, error: RELATION_RECONCILIATION_FAILED_CODE };
  }
  return {
    ok: true,
    mode: "apply",
    sessionIds: result.sessionsChecked,
    status: "ready",
    desiredSupportCount: result.desiredSupportCount,
    created: result.created,
    alreadyPresent: result.alreadyPresent,
    removed: 0,
    uniqueObservationConceptPairs: result.uniqueObservationConceptPairs,
    wrote: result.created,
  };
}

export function formatObservationConceptRelationCliResult(
  result: ObservationConceptRelationCliResult,
): string {
  if (!result.ok) {
    return result.error === "help"
      ? OBSERVATION_CONCEPT_RELATION_CLI_HELP
      : `observation-concept-relations-reconcile failed: ${result.error}`;
  }
  if (result.mode === "preview") {
    return [
      "mode=preview wrote=0",
      `sessions=${result.sessionIds.length}`,
      `desired=${result.desiredSupportCount}`,
      `existing=${result.existingSupportCount}`,
      `missing=${result.missingSupportCount}`,
      `pairs=${result.uniqueObservationConceptPairs}`,
    ].join(" ");
  }
  return [
    `mode=apply status=${result.status}`,
    `sessions=${result.sessionIds.length}`,
    `created=${result.created}`,
    `alreadyPresent=${result.alreadyPresent}`,
    `wrote=${result.wrote}`,
    `pairs=${result.uniqueObservationConceptPairs}`,
  ].join(" ");
}
