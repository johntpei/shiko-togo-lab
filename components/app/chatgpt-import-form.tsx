"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  extractConversationsFromJson,
  previewConversation,
  toImportPayload,
} from "@/lib/import/chatgpt";
import {
  DEFAULT_SESSION_GAP_HOURS,
  SESSION_GAP_PRESETS,
  type ExtractedConversation,
  type GapHours,
} from "@/lib/import/chatgpt/types";

type ListedConversation = ExtractedConversation & {
  fileName: string;
};

function formatUnix(value: number | null) {
  if (value == null) {
    return "—";
  }
  const date = new Date(value * 1000);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${d} ${hh}:${mm}`;
}

export function ChatGptImportForm({
  initialImportedIds,
}: {
  initialImportedIds: string[];
}) {
  const [items, setItems] = useState<ListedConversation[]>([]);
  const [importedIds, setImportedIds] = useState(new Set(initialImportedIds));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [gapHours, setGapHours] = useState<GapHours>(DEFAULT_SESSION_GAP_HOURS);
  const [gapMode, setGapMode] = useState<"preset" | "custom">("preset");
  const [customHours, setCustomHours] = useState("5");
  const [query, setQuery] = useState("");
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    conversations: number;
    sessions: number;
    messages: number;
    skipped: number;
  } | null>(null);

  async function loadFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }
    setResult(null);
    const next: ListedConversation[] = [];
    const seen = new Set<string>();
    let skipped = 0;

    for (const file of Array.from(fileList)) {
      if (!file.name.toLowerCase().endsWith(".json")) {
        skipped += 1;
        continue;
      }
      const text = await file.text();
      const data = JSON.parse(text) as unknown;
      const extracted = extractConversationsFromJson(data);
      for (const conversation of extracted) {
        if (seen.has(conversation.externalConversationId)) {
          continue;
        }
        seen.add(conversation.externalConversationId);
        next.push({ ...conversation, fileName: file.name });
      }
    }

    setItems(next);
    setSelected(new Set());
    setFileNote(
      skipped > 0
        ? `${next.length}件のConversationを読みました。JSON以外の${skipped}件は無視しました。`
        : `${next.length}件のConversationを読みました。`,
    );
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return items;
    }
    return items.filter((item) => item.title.toLowerCase().includes(q));
  }, [items, query]);

  const selectedItems = items.filter((item) =>
    selected.has(item.externalConversationId),
  );

  function toggleAllFiltered(on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const item of filtered) {
        if (importedIds.has(item.externalConversationId)) {
          continue;
        }
        if (on) {
          next.add(item.externalConversationId);
        } else {
          next.delete(item.externalConversationId);
        }
      }
      return next;
    });
  }

  async function runImport() {
    setBusy(true);
    setResult(null);
    try {
      let conversations = 0;
      let sessions = 0;
      let messages = 0;
      let skipped = 0;
      const newlyImported = new Set(importedIds);

      for (const item of selectedItems) {
        if (newlyImported.has(item.externalConversationId)) {
          skipped += 1;
          continue;
        }
        const payload = toImportPayload(item, gapHours);
        const response = await fetch("/api/imports/chatgpt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = (await response.json()) as {
          status?: string;
          sessionCount?: number;
          messageCount?: number;
        };
        if (body.status === "already_imported") {
          skipped += 1;
          newlyImported.add(item.externalConversationId);
          continue;
        }
        conversations += 1;
        sessions += body.sessionCount ?? 0;
        messages += body.messageCount ?? 0;
        newlyImported.add(item.externalConversationId);
      }

      setImportedIds(newlyImported);
      setSelected(new Set());
      setResult({ conversations, sessions, messages, skipped });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-ink">JSONファイル</h2>
        <p className="mt-1 text-xs leading-6 text-muted">
          conversations-000.json などを複数選べます。datフォルダは不要です。ファイルはブラウザ内で1件ずつ処理します。
        </p>
        <input
          type="file"
          accept=".json,application/json"
          multiple
          className="mt-4 block w-full text-sm text-muted file:mr-3 file:rounded-xl file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-xs file:font-bold file:text-ink"
          onChange={(event) => {
            void loadFiles(event.target.files);
            event.target.value = "";
          }}
        />
        {fileNote ? <p className="mt-3 text-xs text-muted">{fileNote}</p> : null}
      </section>

      {items.length > 0 ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="block min-w-56 flex-1">
              <span className="text-xs font-bold text-muted">タイトル検索</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none ring-blue-600/20 focus:border-blue-300 focus:ring-4"
                placeholder="Conversation名"
              />
            </label>
            <div className="block">
              <span className="text-xs font-bold text-muted">Session分割</span>
              <select
                value={
                  gapHours == null
                    ? "none"
                    : gapMode === "custom"
                      ? "custom"
                      : String(gapHours)
                }
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "none") {
                    setGapMode("preset");
                    setGapHours(null);
                    return;
                  }
                  if (value === "custom") {
                    setGapMode("custom");
                    const parsed = Number(customHours);
                    setGapHours(
                      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SESSION_GAP_HOURS,
                    );
                    return;
                  }
                  setGapMode("preset");
                  setGapHours(Number(value));
                }}
                className="mt-1 rounded-xl border border-line bg-white px-3 py-2 text-sm"
              >
                {SESSION_GAP_PRESETS.map((hours) => (
                  <option key={hours} value={hours}>
                    {hours}時間空いたら分割
                    {hours === DEFAULT_SESSION_GAP_HOURS ? "（推奨）" : ""}
                  </option>
                ))}
                <option value="none">分割しない</option>
                <option value="custom">カスタム</option>
              </select>
              {gapMode === "custom" ? (
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={customHours}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCustomHours(value);
                    const parsed = Number(value);
                    if (Number.isFinite(parsed) && parsed > 0) {
                      setGapHours(parsed);
                    }
                  }}
                  className="mt-2 w-28 rounded-xl border border-line bg-white px-3 py-2 text-sm"
                  aria-label="カスタム分割時間（時間）"
                />
              ) : null}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-bold text-muted hover:text-ink"
              onClick={() => toggleAllFiltered(true)}
            >
              表示中を全選択
            </button>
            <button
              type="button"
              className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-bold text-muted hover:text-ink"
              onClick={() => toggleAllFiltered(false)}
            >
              全解除
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-line bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-line text-xs tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-3">選択</th>
                  <th className="px-3 py-3">タイトル</th>
                  <th className="px-3 py-3">作成</th>
                  <th className="px-3 py-3">更新</th>
                  <th className="px-3 py-3">発言</th>
                  <th className="px-3 py-3">Session</th>
                  <th className="px-3 py-3">状態</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const preview = previewConversation(item, gapHours);
                  const already = importedIds.has(item.externalConversationId);
                  return (
                    <tr key={item.externalConversationId} className="border-t border-line">
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          disabled={already}
                          checked={selected.has(item.externalConversationId)}
                          onChange={(event) => {
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) {
                                next.add(item.externalConversationId);
                              } else {
                                next.delete(item.externalConversationId);
                              }
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td className="px-3 py-3 font-bold text-ink">{item.title}</td>
                      <td className="px-3 py-3 text-xs text-muted">
                        {formatUnix(item.sourceCreatedAt)}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted">
                        {formatUnix(item.sourceUpdatedAt)}
                      </td>
                      <td className="px-3 py-3">{preview.visibleMessageCount}</td>
                      <td className="px-3 py-3">{preview.estimatedSessionCount}</td>
                      <td className="px-3 py-3 text-xs font-bold">
                        {already ? (
                          <span className="text-emerald-700">取り込み済み</span>
                        ) : (
                          <span className="text-muted">未取り込み</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {selectedItems.length > 0 ? (
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-sm font-bold text-ink">Session分割プレビュー</h2>
          <div className="mt-4 grid gap-4">
            {selectedItems.map((item) => {
              const preview = previewConversation(item, gapHours);
              return (
                <article key={item.externalConversationId} className="rounded-xl border border-line p-4">
                  <h3 className="font-bold text-ink">元Conversation：{item.title}</h3>
                  <p className="mt-1 text-xs text-muted">
                    {gapHours == null
                      ? "分割しない"
                      : `${gapHours}時間ルール`}
                    ／ {preview.estimatedSessionCount} Session ／ {preview.visibleMessageCount} 発言
                  </p>
                  <ul className="mt-3 grid gap-2 text-sm">
                    {preview.sessions.map((session) => (
                      <li key={session.index} className="rounded-lg bg-canvas px-3 py-2">
                        Session {session.index + 1}
                        <span className="mt-0.5 block text-xs text-muted">
                          {formatUnix(session.startAt)} 〜 {formatUnix(session.endAt)}
                          <span className="ml-2">{session.messageCount} messages</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runImport()}
            className="mt-5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? "読み込み中…" : "選択したConversationを読み込む"}
          </button>
        </section>
      ) : null}

      {result ? (
        <section className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5">
          <h2 className="text-sm font-bold text-emerald-950">取り込み結果</h2>
          <p className="mt-2 text-sm leading-7 text-emerald-950">
            {result.conversations} Conversationを読み込みました
            <br />
            {result.sessions} Sessionを作成しました
            <br />
            {result.messages} Messageを登録しました
            {result.skipped > 0 ? (
              <>
                <br />
                {result.skipped} 件は取り込み済みのためスキップしました
              </>
            ) : null}
          </p>
          <Link
            href="/sessions"
            className="mt-4 inline-block text-sm font-bold text-blue-700 hover:underline"
          >
            Session一覧を見る
          </Link>
        </section>
      ) : null}
    </div>
  );
}
