import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, getDbPath } from "@/lib/db/client";
import { getAiProvider, type AiProvider } from "@/lib/ai/provider";
import { createProductionIncrementalCandidateExtractor } from "@/lib/concepts/incremental/extract";
import {
  DUAL_PIPELINE_ORCHESTRATOR_EXECUTE_HELP,
  parseDualPipelineOrchestratorExecuteArgs,
} from "@/lib/processing-orchestrator/execute-args";
import { executeDualPipelineProcessing } from "@/lib/processing-orchestrator/execute";
import { loadInitialConceptCoverageFromCandidateText } from "@/lib/processing-orchestrator/load";

function formatExecutionResult(
  result: Awaited<ReturnType<typeof executeDualPipelineProcessing>>,
) {
  return [
    `version: ${result.version}`,
    `status: ${result.status}`,
    `reason: ${result.reason ?? "(none)"}`,
    `planVersion: ${result.planVersion}`,
    `operationalOrder: ${result.operationalOrder}`,
    `semanticDependency: ${result.semanticDependency}`,
    `selection.sessionIds: ${result.selection.sessionIds.join(",") || "(none)"}`,
    `selection.validSessionIds: ${result.selection.validSessionIds.join(",") || "(none)"}`,
    `selection.invalidSessionIds: ${result.selection.invalidSessionIds.join(",") || "(none)"}`,
    `concept.executed: ${result.summary.conceptExecutedCount}`,
    `concept.completed: ${result.summary.conceptCompletedCount}`,
    `concept.failed: ${result.summary.conceptFailedCount}`,
    `review.resolvedAction: ${result.review.resolvedAction}`,
    `review.processorStatus: ${result.review.processorStatus ?? "(none)"}`,
    `review.reviewId: ${result.review.reviewId ?? "(none)"}`,
    `summary.conceptExtractionCalls: ${result.summary.conceptExtractionCalls}`,
    `summary.conceptAssessmentCalls: ${result.summary.conceptAssessmentCalls}`,
    `summary.reviewLlmCalls: ${result.summary.reviewLlmCalls}`,
  ].join("\n");
}

async function main() {
  const parsed = parseDualPipelineOrchestratorExecuteArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`${parsed.code}: ${parsed.detail}`);
    console.error(DUAL_PIPELINE_ORCHESTRATOR_EXECUTE_HELP);
    process.exit(1);
  }
  if (parsed.help) {
    console.log(DUAL_PIPELINE_ORCHESTRATOR_EXECUTE_HELP);
    process.exit(0);
  }

  const db = getDb();
  const candidateText = readFileSync(resolve(process.cwd(), parsed.candidatesPath), "utf8");
  const initialCoverage = loadInitialConceptCoverageFromCandidateText(candidateText);
  const provider = getAiProvider();
  const generateStructured = (request: Parameters<AiProvider["generateStructured"]>[0]) =>
    provider.generateStructured(request);
  const result = await executeDualPipelineProcessing(
    { sessionIds: parsed.sessionIds },
    {
      db,
      initialCoverage,
      conceptDeps: {
        extractCandidates: createProductionIncrementalCandidateExtractor({
          generateStructured,
        }),
        generateStructured,
      },
    },
  );
  console.log(formatExecutionResult(result));
  console.log("");
  console.log(`db: ${getDbPath()}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "execution failed");
  process.exit(1);
});
