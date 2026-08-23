"use server";

import { revalidatePath } from "next/cache";
import { getAiProvider } from "@/lib/ai/provider";
import { createProductionIncrementalCandidateExtractor } from "@/lib/concepts/incremental/extract";
import { getDb } from "@/lib/db/client";
import { listSessionsByIds } from "@/lib/db/queries";
import { executeDualPipelineProcessing } from "@/lib/processing-orchestrator/execute";
import {
  readInitialConceptCoverageFile,
} from "@/lib/processing-orchestrator/load";
import {
  buildProcessingExecutionPresentation,
  buildProcessingPlanPresentation,
  type ProcessingExecutionPresentation,
  type ProcessingPlanPresentation,
} from "@/lib/processing-orchestrator/presentation";
import { uniqueSortedSessionIds } from "@/lib/processing-orchestrator/plan";

export type LoadProcessingPlanState = {
  plan: ProcessingPlanPresentation | null;
  error: string | null;
};

export type ExecuteProcessingState = {
  result: ProcessingExecutionPresentation | null;
  error: string | null;
};

function parseSessionIds(formData: FormData): string[] {
  return uniqueSortedSessionIds(
    formData
      .getAll("sessionIds")
      .map((value) => String(value).trim())
      .filter(Boolean),
  );
}

function sessionTitleMap(sessionIds: readonly string[]) {
  const sessions = listSessionsByIds([...sessionIds]);
  return new Map(sessions.map((session) => [session.id, session.title]));
}

export async function loadProcessingPlanAction(
  _prev: LoadProcessingPlanState,
  formData: FormData,
): Promise<LoadProcessingPlanState> {
  const sessionIds = parseSessionIds(formData);
  if (sessionIds.length === 0) {
    return { plan: null, error: "対話を1件以上選んでください。" };
  }

  try {
    const db = getDb();
    const initialCoverage = readInitialConceptCoverageFile();
    const { loadDualPipelineOrchestratorPlan } = await import(
      "@/lib/processing-orchestrator/load"
    );
    const plan = loadDualPipelineOrchestratorPlan({
      db,
      sessionIds,
      initialCoverage,
    });
    const presentation = buildProcessingPlanPresentation({
      plan,
      sessionTitles: sessionTitleMap(sessionIds),
    });
    return { plan: presentation, error: null };
  } catch {
    return { plan: null, error: "プランの確認に失敗しました。" };
  }
}

export async function executeProcessingAction(
  _prev: ExecuteProcessingState,
  formData: FormData,
): Promise<ExecuteProcessingState> {
  const sessionIds = parseSessionIds(formData);
  if (sessionIds.length === 0) {
    return { result: null, error: "対話を1件以上選んでください。" };
  }

  try {
    const db = getDb();
    const initialCoverage = readInitialConceptCoverageFile();
    const provider = getAiProvider();
    const generateStructured = (request: Parameters<
      ReturnType<typeof getAiProvider>["generateStructured"]
    >[0]) => provider.generateStructured(request);
    const result = await executeDualPipelineProcessing(
      { sessionIds },
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

    revalidatePath("/");
    revalidatePath("/reviews");
    revalidatePath("/reviews/new");
    revalidatePath("/timeline");

    return {
      result: buildProcessingExecutionPresentation(
        result,
        sessionTitleMap(sessionIds),
      ),
      error: null,
    };
  } catch {
    return {
      result: null,
      error: "観測の更新に失敗しました。時間をおいて再度お試しください。",
    };
  }
}
