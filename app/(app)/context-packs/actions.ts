"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { parseStoredAnalysisPayload } from "@/lib/ai/schemas";
import { parseStoredReviewPayload } from "@/lib/ai/review-schemas";
import { createContextPack } from "@/lib/ai/tasks/context-pack";
import {
  getLatestSessionAnalysis,
  getReviewById,
  listSessionsByReviewId,
} from "@/lib/db/queries";

export type CreateContextPackState = {
  error: string | null;
};

export async function createContextPackAction(
  _prev: CreateContextPackState,
  formData: FormData,
): Promise<CreateContextPackState> {
  const reviewId = String(formData.get("reviewId") ?? "").trim();
  const currentQuestion = String(formData.get("currentQuestion") ?? "");

  if (!reviewId) {
    return { error: "元になるReviewが指定されていません" };
  }

  const review = getReviewById(reviewId);
  if (!review) {
    return { error: "Reviewが見つかりません" };
  }
  const payload = parseStoredReviewPayload(review.payload);
  if (!payload) {
    return { error: "Reviewの内容を読み込めませんでした" };
  }

  const sessions = listSessionsByReviewId(reviewId).map((session) => {
    const latest = getLatestSessionAnalysis(session.id);
    const analysis = latest
      ? parseStoredAnalysisPayload(latest.payload)
      : null;
    return {
      id: session.id,
      title: session.title,
      occurredAt: session.occurredAt,
      analysis,
    };
  });

  const result = await createContextPack({
    reviewId,
    reviewPayload: payload,
    sessions,
    currentQuestion,
  });
  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/context-packs");
  revalidatePath("/");
  revalidatePath(`/reviews/${reviewId}`);
  redirect(`/context-packs/${result.contextPackId}`);
}
