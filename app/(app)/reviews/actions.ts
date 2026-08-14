"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ANALYZE_SESSION_PROMPT_V4 } from "@/lib/ai/prompts/analyze-session";
import { parseStoredAnalysisPayload } from "@/lib/ai/schemas";
import { createIntegratedReview } from "@/lib/ai/tasks/integrated-review";
import type { ReviewSessionSource } from "@/lib/ai/review-input";
import {
  getLatestSessionAnalysis,
  listMessagesBySessionId,
  listSessionsByIds,
} from "@/lib/db/queries";
import {
  buildIntegratedReviewTitle,
  isReviewDatePreset,
} from "@/lib/sessions/labels";

export type CreateReviewState = {
  error: string | null;
};

export async function createIntegratedReviewAction(
  _prev: CreateReviewState,
  formData: FormData,
): Promise<CreateReviewState> {
  const requestedIds = [
    ...new Set(
      formData
        .getAll("sessionIds")
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];
  const presetRaw = String(formData.get("preset") ?? "").trim();
  const preset = isReviewDatePreset(presetRaw) ? presetRaw : undefined;

  if (requestedIds.length < 2) {
    return { error: "統合レビューには2件以上のSessionが必要です" };
  }

  const sessions = listSessionsByIds(requestedIds);
  const foundIds = new Set(sessions.map((session) => session.id));
  const missing = requestedIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    return { error: "選択したSessionの一部が見つかりません。" };
  }

  const sources: ReviewSessionSource[] = sessions.map((session) => {
    const latest = getLatestSessionAnalysis(session.id);
    const payload = latest ? parseStoredAnalysisPayload(latest.payload) : null;
    const analysis =
      latest &&
      payload &&
      latest.promptVersion === ANALYZE_SESSION_PROMPT_V4
        ? { promptVersion: latest.promptVersion, payload }
        : null;
    return {
      session,
      messages: listMessagesBySessionId(session.id),
      analysis,
    };
  });

  const title = buildIntegratedReviewTitle({
    preset,
    sessionOccurredAts: sessions.map((session) => session.occurredAt),
  });

  const result = await createIntegratedReview(sources, title);
  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/reviews");
  revalidatePath("/");
  redirect(`/reviews/${result.reviewId}`);
}
