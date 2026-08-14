"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  getSessionById,
  insertSession,
  rebuildMessages,
} from "@/lib/db/queries";
import { analyzeSession } from "@/lib/ai/tasks/analyze-session";
import {
  SESSION_SOURCES,
  type SessionSource,
} from "@/lib/sessions/constants";

export type CreateSessionState = {
  error: string | null;
};

function isSource(value: string): value is SessionSource {
  return (SESSION_SOURCES as readonly string[]).includes(value);
}

export async function createSession(
  _prev: CreateSessionState,
  formData: FormData,
): Promise<CreateSessionState> {
  const title = String(formData.get("title") ?? "").trim();
  const occurredAt = String(formData.get("occurredAt") ?? "").trim();
  const source = String(formData.get("source") ?? "");
  const category = String(formData.get("category") ?? "").trim();
  const rawContent = formData.get("rawContent");

  if (!title) {
    return { error: "タイトルを入力してください。" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredAt)) {
    return { error: "対話日を入力してください。" };
  }
  if (!isSource(source)) {
    return { error: "元サービスを選んでください。" };
  }
  if (typeof rawContent !== "string" || rawContent.length === 0) {
    return { error: "対話本文を入力してください。" };
  }

  const session = insertSession({
    title,
    occurredAt,
    source,
    category,
    rawContent,
  });

  redirect(`/sessions/${session.id}`);
}

export async function reparseSession(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const session = getSessionById(sessionId);
  if (!session) {
    notFound();
  }

  try {
    rebuildMessages(session.id, session.rawContent);
  } catch (error) {
    console.error("Failed to reparse session messages:", error);
  }

  redirect(`/sessions/${session.id}`);
}

export type AnalyzeSessionState = {
  error: string | null;
};

export async function analyzeSessionAction(
  _prev: AnalyzeSessionState,
  formData: FormData,
): Promise<AnalyzeSessionState> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const session = getSessionById(sessionId);
  if (!session) {
    notFound();
  }

  const result = await analyzeSession(sessionId);
  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath(`/sessions/${sessionId}`);
  return { error: null };
}
