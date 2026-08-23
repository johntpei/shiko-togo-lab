import { CONCEPT_APPLY_DEFAULT_CANDIDATES } from "@/lib/concepts/admission/apply-manifest";

export const DUAL_PIPELINE_ORCHESTRATOR_PLAN_HELP = `Usage:
  npm run processing:orchestrator-plan -- --session <id> [--session <id> ...]

Read-only dual-pipeline orchestrator plan for an explicit Session selection.
Does not INSERT / UPDATE / DELETE.
Does not run Concept processing, Review, or relation reconciliation.
Does not print USER text.
--apply is not accepted.
Session auto-selection is not accepted.
`;

export type DualPipelineOrchestratorPlanArgs =
  | {
      ok: true;
      help: false;
      sessionIds: string[];
      candidatesPath: string;
    }
  | {
      ok: true;
      help: true;
      sessionIds: [];
      candidatesPath: string;
    }
  | {
      ok: false;
      help: false;
      code: string;
      detail: string;
    };

export function parseDualPipelineOrchestratorPlanArgs(
  argv: string[],
): DualPipelineOrchestratorPlanArgs {
  let help = false;
  const sessionIds: string[] = [];
  let candidatesPath = CONCEPT_APPLY_DEFAULT_CANDIDATES;

  const takeValue = (index: number) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      return { ok: false as const, code: "missing_option_value", detail: argv[index]! };
    }
    return { ok: true as const, value };
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--apply") {
      return {
        ok: false,
        help: false,
        code: "apply_not_allowed",
        detail: "processing-orchestrator-plan is read-only; --apply is not accepted",
      };
    }
    if (arg === "--session") {
      const value = takeValue(i);
      if (!value.ok) {
        return { ok: false, help: false, code: value.code, detail: value.detail };
      }
      sessionIds.push(value.value);
      i += 1;
      continue;
    }
    if (arg === "--candidates") {
      const value = takeValue(i);
      if (!value.ok) {
        return { ok: false, help: false, code: value.code, detail: value.detail };
      }
      candidatesPath = value.value;
      i += 1;
      continue;
    }
    return {
      ok: false,
      help: false,
      code: "unexpected_arg",
      detail: arg,
    };
  }

  if (help) {
    return {
      ok: true,
      help: true,
      sessionIds: [],
      candidatesPath,
    };
  }

  const trimmed = sessionIds.map((id) => id.trim()).filter((id) => id !== "");
  if (trimmed.length === 0) {
    return {
      ok: false,
      help: false,
      code: "missing_session",
      detail: "at least one --session is required",
    };
  }

  return {
    ok: true,
    help: false,
    sessionIds: trimmed,
    candidatesPath,
  };
}
