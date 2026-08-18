import { ContextPackSourceList } from "@/components/app/context-pack-source-list";
import { CopyMarkdownButton } from "@/components/app/copy-markdown-button";
import type { StoredContextPackItem, StoredContextPackPayload } from "@/lib/context-pack/schema";

function formatAnalyzedAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ItemList({
  title,
  items,
  reviewId,
  renderText,
}: {
  title: string;
  items: StoredContextPackItem[];
  reviewId?: string | null;
  renderText?: (item: StoredContextPackItem) => string;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="mt-6">
      <h3 className="border-b border-line pb-2 text-sm font-bold text-ink">
        {title}
      </h3>
      <ul className="mt-3 grid gap-4">
        {items.map((item) => (
          <li key={item.sourceRef}>
            <p className="text-sm leading-7 text-ink">
              {renderText ? renderText(item) : item.text}
            </p>
            <ContextPackSourceList item={item} reviewId={reviewId} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ContextPackDetailPanel({
  title,
  model,
  promptVersion,
  createdAt,
  currentQuestion,
  sourceReviewTitle,
  sourceReviewId,
  markdown,
  payload,
}: {
  title: string;
  model: string;
  promptVersion: string;
  createdAt: string;
  currentQuestion: string;
  sourceReviewTitle: string | null;
  sourceReviewId: string | null;
  markdown: string;
  payload: StoredContextPackPayload;
}) {
  const selected = payload.selected;
  const currentContextItems = selected.currentState.filter(
    (item) => item.type === "current_context",
  );
  const locationItems = selected.currentState.filter(
    (item) => item.type !== "current_context",
  );

  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] sm:p-6">
      <p className="text-xs font-bold tracking-[0.18em] text-blue-600">
        CONTEXT PACK
      </p>
      <h2 className="mt-2 text-xl font-black tracking-tight text-ink">
        {title}
      </h2>
      <p className="mt-3 text-[11px] leading-6 text-muted">
        作成 {formatAnalyzedAt(createdAt)}
        {sourceReviewTitle ? (
          <>
            <span className="mx-2 text-line">·</span>
            Review {sourceReviewTitle}
          </>
        ) : null}
      </p>
      <div className="mt-3 rounded-xl border border-line bg-canvas px-3 py-2 text-[11px] leading-6 text-muted">
        <p className="font-bold tracking-[0.16em]">分析情報</p>
        <p className="mt-1">
          {model}
          <span className="mx-2 text-line">·</span>
          {promptVersion}
        </p>
      </div>

      {currentQuestion.trim() ? (
        <section className="mt-6">
          <h3 className="border-b border-line pb-2 text-sm font-bold text-ink">
            今回相談したいこと
          </h3>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-ink">
            {currentQuestion}
          </p>
        </section>
      ) : null}

      <ItemList
        title="現在の前提"
        items={currentContextItems}
        reviewId={sourceReviewId}
        renderText={(item) =>
          item.sourceRef === "C:PROJECT_NAME"
            ? `プロジェクト名：${item.text}`
            : `目的：${item.text}`
        }
      />
      <ItemList title="現在地" items={locationItems} reviewId={sourceReviewId} />
      <ItemList
        title="これまでに確認された方針"
        items={selected.confirmedContext}
        reviewId={sourceReviewId}
      />
      <ItemList
        title="複数Sessionから見えてきたこと"
        items={selected.crossSessionInsights}
        reviewId={sourceReviewId}
        renderText={(item) =>
          item.supportType === "cross_session_interpretation" ||
          item.type === "insight"
            ? `【AIによる横断的な解釈】${item.text}`
            : item.text
        }
      />
      <ItemList
        title="緊張関係・注意点"
        items={selected.tensions}
        reviewId={sourceReviewId}
        renderText={(item) => {
          const sides = [item.sideA ? `A：${item.sideA}` : "", item.sideB ? `B：${item.sideB}` : ""]
            .filter(Boolean)
            .join(" / ");
          return sides ? `${item.text}（${sides}）` : item.text;
        }}
      />
      <ItemList
        title="仮説"
        items={selected.hypotheses}
        reviewId={sourceReviewId}
        renderText={(item) => `【仮説】${item.text}`}
      />
      <ItemList
        title="未解決の問い"
        items={selected.openQuestions}
        reviewId={sourceReviewId}
      />

      <section className="mt-8">
        <h3 className="border-b border-line pb-2 text-sm font-bold text-ink">
          Markdown preview
        </h3>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl border border-line bg-canvas px-4 py-3 text-xs leading-6 text-ink">
          {markdown}
        </pre>
        <div className="mt-4">
          <CopyMarkdownButton markdown={markdown} />
        </div>
      </section>
    </div>
  );
}
