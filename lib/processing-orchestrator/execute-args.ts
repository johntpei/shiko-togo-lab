import { CONCEPT_APPLY_DEFAULT_CANDIDATES } from "@/lib/concepts/admission/apply-manifest";

export const DUAL_PIPELINE_ORCHESTRATOR_EXECUTE_HELP = `Usage:
  npm run processing:orchestrator-execute -- --session <id> [--session <id> ...] --apply

Explicit dual-pipeline orchestrator execution for a selected Session set.
Requires --apply to perform LLM calls and DB writes.
Does not print USER text.

Without --apply the command rejects with explicit_apply_required.
Session auto-selection is not accepted.
`;

export type DualPipelineOrchestratorExecuteArgs =
  | {
      ok: true;
      help: false;
      apply: true;
      sessionIds: string[];
      candidatesPath: string;
    }
  | {
      ok: true;
      help: true;
      apply: false;
      sessionIds: [];
      candidatesPath: string;
    }
  | {
      ok: false;
      help: false;
      apply: false;
      code: string;
      detail: string;
    };

export function parseDualPipelineOrchestratorExecuteArgs(
  argv: string[],
): DualPipelineOrchestratorExecuteArgs {
  let help = false;
  let apply = false;
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
      apply = true;
      continue;
    }
    if (arg === "--session") {
      const value = takeValue(i);
      if (!value.ok) {
        return { ok: false, help: false, apply: false, code: value.code, detail: value.detail };
      }
      sessionIds.push(value.value);
      i += 1;
      continue;
    }
    if (arg === "--candidates") {
      const value = takeValue(i);
      if (!value.ok) {
        return { ok: false, help: false, apply: false, code: value.code, detail: value.detail };
      }
      candidatesPath = value.value;
      i += 1;
      continue;
    }
    return {
      ok: false,
      help: false,
      apply: false,
      code: "unexpected_arg",
      detail: arg,
    };
  }

  if (help) {
    return {
      ok: true,
      help: true,
      apply: false,
      sessionIds: [],
      candidatesPath,
    };
  }

  if (!apply) {
    return {
      ok: false,
      help: false,
      apply: false,
      code: "explicit_apply_required",
      detail: "processing-orchestrator-execute requires --apply",
    };
  }

  const trimmed = sessionIds.map((id) => id.trim()).filter((id) => id !== "");
  if (trimmed.length === 0) {
    return {
      ok: false,
      help: false,
      apply: false,
      code: "missing_session",
      detail: "at least one --session is required",
    };
  }

  return {
    ok: true,
    help: false,
    apply: true,
    sessionIds: trimmed,
    candidatesPath,
  };
}
