import assert from "node:assert/strict";
import test from "node:test";
import { assertTranscriptAnchors } from "./build-transcript.ts";
import { extractCurrentBranch } from "./extract-branch.ts";
import { extractConversation, parseExportJson } from "./parse-export.ts";
import { prepareConversationSessions } from "./index.ts";
import { splitByTimeGap } from "./split-sessions.ts";
import type { ChatGptConversation, ChatGptMappingNode } from "./types.ts";

const T0 = 1_704_067_200;
const T1 = T0 + 600;
const T2 = T1 + 5 * 60 * 60;

function node(
  id: string,
  parent: string | null,
  message: ChatGptMappingNode["message"],
): [string, ChatGptMappingNode] {
  return [id, { id, parent, children: [], message }];
}

function branchedConversation(): ChatGptConversation {
  const mapping = Object.fromEntries([
    node("root", null, null),
    node("sys", "root", {
      id: "m-sys",
      author: { role: "system" },
      create_time: T0,
      content: { content_type: "text", parts: ["system prompt"] },
    }),
    node("u1", "sys", {
      id: "m-u1",
      author: { role: "user" },
      create_time: T0,
      content: { content_type: "text", parts: ["最初の質問です"] },
    }),
    node("a-old", "u1", {
      id: "m-a-old",
      author: { role: "assistant" },
      create_time: T0 + 10,
      content: { content_type: "text", parts: ["使われない古い回答"] },
    }),
    node("a1", "u1", {
      id: "m-a1",
      author: { role: "assistant" },
      create_time: T1,
      content: { content_type: "text", parts: ["現在branchの回答"] },
    }),
    node("u2", "a1", {
      id: "m-u2",
      author: { role: "user" },
      create_time: T2,
      content: {
        content_type: "multimodal_text",
        parts: [
          "この画像を参考にしてください",
          {
            content_type: "image_asset_pointer",
            asset_pointer: "file-service://file-abc",
          },
        ],
      },
      metadata: {
        attachments: [
          {
            id: "file-abc",
            name: "ノーセット.jpg",
            mime_type: "image/jpeg",
            size: 12345,
          },
        ],
      },
    }),
    node("thought", "u2", {
      id: "m-thought",
      author: { role: "assistant" },
      create_time: T2 + 1,
      content: { content_type: "thoughts", parts: ["内部思考"] },
    }),
    node("recap", "thought", {
      id: "m-recap",
      author: { role: "assistant" },
      create_time: T2 + 2,
      content: { content_type: "reasoning_recap", parts: ["要約内部"] },
    }),
    node("empty", "recap", {
      id: "m-empty",
      author: { role: "assistant" },
      create_time: T2 + 3,
      content: { content_type: "text", parts: ["", "   "] },
    }),
    node("a2", "empty", {
      id: "m-a2",
      author: { role: "assistant" },
      create_time: T2 + 4,
      content: { content_type: "text", parts: ["最終回答です"] },
    }),
  ]);

  return {
    id: "conv-internal",
    conversation_id: "conv-123",
    title: "思考統合研究所",
    create_time: T0,
    update_time: T2 + 4,
    current_node: "a2",
    is_archived: false,
    mapping,
  };
}

test("Case A: conversation_id / title / timestampが取得できる", () => {
  const extracted = extractConversation(branchedConversation());
  assert.ok(extracted);
  assert.equal(extracted.externalConversationId, "conv-123");
  assert.equal(extracted.title, "思考統合研究所");
  assert.equal(extracted.sourceCreatedAt, T0);
  assert.equal(extracted.sourceUpdatedAt, T2 + 4);
});

test("Case B: current_nodeからparentを辿り正しい順に復元できる", () => {
  const branch = extractCurrentBranch(branchedConversation());
  assert.deepEqual(
    branch.map((node) => node.id),
    ["root", "sys", "u1", "a1", "u2", "thought", "recap", "empty", "a2"],
  );
});

test("Case C: 現在branch以外のMessageを取り込まない", () => {
  const extracted = extractConversation(branchedConversation());
  assert.ok(extracted);
  const contents = extracted.visibleMessages.map((item) => item.content);
  assert.equal(contents.includes("使われない古い回答"), false);
  assert.ok(contents.includes("現在branchの回答"));
});

test("Case D: user / assistant roleが正しく保持される", () => {
  const extracted = extractConversation(branchedConversation());
  assert.ok(extracted);
  assert.deepEqual(
    extracted.visibleMessages.map((item) => item.role),
    ["user", "assistant", "user", "assistant"],
  );
});

test("Case E: text contentを取得できる", () => {
  const extracted = extractConversation(branchedConversation());
  assert.ok(extracted);
  assert.equal(extracted.visibleMessages[0].content, "最初の質問です");
  assert.equal(extracted.visibleMessages[1].content, "現在branchの回答");
});

test("Case F: multimodal_textから文字列本文を取得できる", () => {
  const extracted = extractConversation(branchedConversation());
  assert.ok(extracted);
  assert.equal(extracted.visibleMessages[2].content, "この画像を参考にしてください");
});

test("Case G: 画像attachment metadataを取得できる", () => {
  const extracted = extractConversation(branchedConversation());
  assert.ok(extracted);
  const attachments = extracted.visibleMessages[2].attachments;
  assert.ok(attachments.some((item) => item.name === "ノーセット.jpg"));
  assert.ok(attachments.some((item) => item.mimeType === "image/jpeg"));
  assert.ok(attachments.some((item) => item.assetPointer === "file-service://file-abc"));
});

test("Case H: thoughts / reasoning_recapを通常Messageに入れない", () => {
  const extracted = extractConversation(branchedConversation());
  assert.ok(extracted);
  const joined = extracted.visibleMessages.map((item) => item.content).join("\n");
  assert.equal(joined.includes("内部思考"), false);
  assert.equal(joined.includes("要約内部"), false);
});

test("Case I: 空assistant Messageを除外できる", () => {
  const extracted = extractConversation(branchedConversation());
  assert.ok(extracted);
  assert.equal(
    extracted.visibleMessages.some((item) => item.sourceMessageId === "m-empty"),
    false,
  );
  assert.equal(extracted.visibleMessages.some((item) => item.content === "最終回答です"), true);
});

test("Case J: 5時間以上のgapでSessionが分割される", () => {
  const extracted = extractConversation(branchedConversation());
  assert.ok(extracted);
  const chunks = splitByTimeGap(extracted.visibleMessages, 5);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 2);
  assert.equal(chunks[1].length, 2);
});

test("5時間のgapは8時間ルールでは分割されない", () => {
  const extracted = extractConversation(branchedConversation());
  assert.ok(extracted);
  const chunks = splitByTimeGap(extracted.visibleMessages, 8);
  assert.equal(chunks.length, 1);
});

test("Case K: 分割しないで1Sessionになる", () => {
  const extracted = extractConversation(branchedConversation());
  assert.ok(extracted);
  const chunks = splitByTimeGap(extracted.visibleMessages, null);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 4);
});

test("Case L: 同じconversation_idを検知できる", () => {
  const [first] = parseExportJson([branchedConversation(), branchedConversation()]);
  const second = extractConversation(branchedConversation());
  assert.equal(first?.conversation_id, "conv-123");
  assert.equal(second?.externalConversationId, "conv-123");
  const imported = new Set(["conv-123"]);
  assert.equal(imported.has(second!.externalConversationId), true);
});

test("Case M: 生成されたrawContentとMessage contentの追跡性が保たれる", () => {
  const extracted = extractConversation(branchedConversation());
  assert.ok(extracted);
  const [session] = prepareConversationSessions(extracted, null);
  assertTranscriptAnchors(session);
  for (const message of session.messages) {
    assert.equal(
      session.rawContent.slice(message.charStart, message.charEnd),
      message.content,
    );
  }
  assert.match(session.rawContent, /^User:\n最初の質問です/);
  assert.match(session.rawContent, /Assistant:\n最終回答です/);
});

test("配列JSONからConversationを読める", () => {
  const parsed = parseExportJson([branchedConversation()]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].conversation_id, "conv-123");
});
