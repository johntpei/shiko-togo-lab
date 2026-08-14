import { NextResponse } from "next/server";
import {
  importChatGptConversation,
  listChatGptExternalIds,
  type ChatGptImportPayload,
} from "@/lib/db/import-chatgpt";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ids: listChatGptExternalIds() });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as ChatGptImportPayload;
  if (
    !payload?.conversation?.externalConversationId ||
    !Array.isArray(payload.sessions)
  ) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const result = importChatGptConversation(payload);
  return NextResponse.json(result);
}
