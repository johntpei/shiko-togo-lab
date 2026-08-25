"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleX, Network, ScanSearch } from "lucide-react";
import { layoutThoughtMap } from "@/lib/thought-map/layout";
import {
  THOUGHT_MAP_PRESENTATION_COPY,
  type ThoughtMapPresentation,
} from "@/lib/thought-map/presentation";

function clampTwoLinesStyle() {
  return {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical" as const,
    WebkitLineClamp: 2,
    overflow: "hidden",
  };
}

function Summary({ model }: { model: ThoughtMapPresentation }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-5 py-4 text-sm leading-7 text-muted">
      <p>{THOUGHT_MAP_PRESENTATION_COPY.trust}</p>
      <p className="mt-1">
        {model.counts.totalConcepts}件のテーマと
        {model.counts.totalObservations}件の観測があり、そのうち
        {model.counts.connectedConcepts}件のテーマと
        {model.counts.connectedObservations}件の観測に現在つながりがあります。
      </p>
    </div>
  );
}

function EmptyState({ model }: { model: ThoughtMapPresentation }) {
  return (
    <>
      <div className="mt-8 rounded-2xl border border-dashed border-line bg-white px-5 py-5 sm:px-6">
        <p className="font-bold text-ink">
          {THOUGHT_MAP_PRESENTATION_COPY.emptyTitle}
        </p>
        <p className="mt-2 text-sm leading-7 text-muted">
          {THOUGHT_MAP_PRESENTATION_COPY.emptyBody}
        </p>
      </div>
      {model.counts.totalConcepts > 0 || model.counts.totalObservations > 0 ? (
        <div className="mt-4">
          <Summary model={model} />
        </div>
      ) : null}
    </>
  );
}

function DetailPanel({
  model,
  selectedId,
  onSelect,
  onClear,
}: {
  model: ThoughtMapPresentation;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  const nodeById = useMemo(
    () => new Map(model.nodes.map((node) => [node.id, node])),
    [model.nodes],
  );
  const selected = selectedId ? nodeById.get(selectedId) : null;

  if (!selected) {
    return (
      <aside className="rounded-2xl border border-line bg-white p-5 lg:sticky lg:top-6 lg:self-start">
        <p className="text-xs font-bold tracking-[0.14em] text-blue-600">
          詳細
        </p>
        <p className="mt-3 text-sm leading-7 text-muted">
          テーマまたは観測を選ぶと、つながりを詳しく確認できます。
        </p>
      </aside>
    );
  }

  const neighbors = selected.neighborIds.flatMap((id) => {
    const node = nodeById.get(id);
    return node ? [node] : [];
  });

  return (
    <aside className="rounded-2xl border border-blue-100 bg-white p-5 shadow-[0_12px_40px_-30px_rgba(37,99,235,0.45)] lg:sticky lg:top-6 lg:self-start">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.14em] text-blue-600">
            {selected.kind === "concept" ? "選択したテーマ" : "選択した観測"}
          </p>
          {selected.kind === "observation" ? (
            <p className="mt-2 text-[11px] font-bold text-muted">
              {selected.kindLabel}
            </p>
          ) : null}
          <h2 className="mt-2 break-words text-lg font-black leading-7 text-ink">
            {selected.kind === "concept" ? selected.label : selected.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-line text-muted hover:bg-canvas hover:text-ink"
          aria-label="選択を解除"
        >
          <CircleX className="size-4" aria-hidden="true" />
        </button>
      </div>

      {selected.kind === "observation" ? (
        <p className="mt-4 break-words text-sm leading-7 text-ink">
          {selected.summary}
        </p>
      ) : null}

      <section className="mt-5 border-t border-line pt-4">
        <h3 className="text-xs font-bold text-muted">
          {selected.kind === "concept" ? "つながっている観測" : "つながっているテーマ"}
          <span className="ml-1 tabular-nums">{neighbors.length}</span>
        </h3>
        <ul className="mt-2 grid gap-2">
          {neighbors.map((neighbor) => (
            <li key={neighbor.id}>
              <button
                type="button"
                onClick={() => onSelect(neighbor.id)}
                className="w-full rounded-xl bg-canvas px-3 py-2 text-left text-sm font-bold text-blue-700 hover:bg-brand-soft"
              >
                {neighbor.kind === "concept" ? neighbor.label : neighbor.title}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function RelationshipList({
  model,
  onSelect,
}: {
  model: ThoughtMapPresentation;
  onSelect: (id: string) => void;
}) {
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  return (
    <section className="mt-8 rounded-2xl border border-line bg-white p-5 sm:p-6">
      <h2 className="text-lg font-black text-ink">つながりの一覧</h2>
      <p className="mt-2 text-sm leading-7 text-muted">
        グラフと同じつながりを、一覧でも確認できます。
      </p>
      <ul className="mt-5 grid gap-4">
        {model.relationships.map((relationship) => {
          const concept = nodeById.get(relationship.conceptNodeId);
          if (!concept || concept.kind !== "concept") {
            return null;
          }
          return (
            <li key={concept.id} className="rounded-xl bg-canvas px-4 py-3">
              <button
                type="button"
                onClick={() => onSelect(concept.id)}
                className="font-bold text-ink hover:text-blue-700 hover:underline"
              >
                テーマ: {concept.label}
              </button>
              <ul className="mt-2 grid gap-1 border-l border-line pl-4">
                {relationship.observationNodeIds.map((id) => {
                  const observation = nodeById.get(id);
                  if (!observation || observation.kind !== "observation") {
                    return null;
                  }
                  return (
                    <li key={observation.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(observation.id)}
                        className="text-left text-sm leading-6 text-blue-700 hover:underline"
                      >
                        {observation.kindLabel}: {observation.title}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ThoughtMapPanel({ model }: { model: ThoughtMapPresentation }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const layout = useMemo(
    () => layoutThoughtMap({ nodes: model.nodes, edges: model.edges }),
    [model.edges, model.nodes],
  );
  const nodeById = useMemo(
    () => new Map(model.nodes.map((node) => [node.id, node])),
    [model.nodes],
  );
  const positionById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.nodeId, node])),
    [layout.nodes],
  );
  const activeNodeIds = useMemo(() => {
    if (!selectedId) {
      return null;
    }
    const selected = nodeById.get(selectedId);
    return new Set([selectedId, ...(selected?.neighborIds ?? [])]);
  }, [nodeById, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const clearOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", clearOnEscape);
    return () => window.removeEventListener("keydown", clearOnEscape);
  }, [selectedId]);

  const selectNode = (id: string) => {
    setSelectedId((current) => (current === id ? null : id));
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <p className="text-xs font-bold tracking-[0.18em] text-blue-600">
        {THOUGHT_MAP_PRESENTATION_COPY.eyebrow}
      </p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-ink sm:text-4xl">
        {THOUGHT_MAP_PRESENTATION_COPY.title}
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted sm:text-base">
        {THOUGHT_MAP_PRESENTATION_COPY.description}
      </p>

      {model.edges.length === 0 ? (
        <EmptyState model={model} />
      ) : (
        <>
          <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
            <section className="min-w-0 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)]">
              <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-xs font-bold text-muted">
                <Network className="size-4 text-blue-600" aria-hidden="true" />
                {model.counts.edges}件のつながり
              </div>
              <div className="overflow-x-auto">
                <div
                  className="relative"
                  style={{ width: layout.width, height: layout.height }}
                >
                  <p
                    className="absolute top-5 text-xs font-bold tracking-[0.12em] text-muted"
                    style={{
                      left: layout.columns.concept.x,
                      width: layout.columns.concept.width,
                    }}
                  >
                    テーマ
                  </p>
                  <p
                    className="absolute top-5 text-xs font-bold tracking-[0.12em] text-muted"
                    style={{
                      left: layout.columns.observation.x,
                      width: layout.columns.observation.width,
                    }}
                  >
                    観測
                  </p>
                  <svg
                    className="pointer-events-none absolute inset-0"
                    width={layout.width}
                    height={layout.height}
                    viewBox={`0 0 ${layout.width} ${layout.height}`}
                    aria-hidden="true"
                  >
                    {layout.edges.map((edge) => {
                      const active =
                        !selectedId ||
                        edge.conceptNodeId === selectedId ||
                        edge.observationNodeId === selectedId;
                      return (
                        <line
                          key={edge.edgeId}
                          x1={edge.x1}
                          y1={edge.y1}
                          x2={edge.x2}
                          y2={edge.y2}
                          stroke={active && selectedId ? "#2563eb" : "#cbd5e1"}
                          strokeWidth="2"
                          opacity={active ? 1 : 0.2}
                        />
                      );
                    })}
                  </svg>

                  {model.nodes.map((node) => {
                    const position = positionById.get(node.id);
                    if (!position) {
                      return null;
                    }
                    const selected = selectedId === node.id;
                    const dimmed = activeNodeIds ? !activeNodeIds.has(node.id) : false;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        aria-pressed={selected}
                        aria-label={
                          node.kind === "concept"
                            ? `テーマ: ${node.label}`
                            : `観測（${node.kindLabel}）: ${node.title}`
                        }
                        onClick={() => selectNode(node.id)}
                        className={`absolute rounded-2xl border px-4 py-3 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                          node.kind === "concept"
                            ? "bg-brand-soft"
                            : "bg-white"
                        } ${
                          selected
                            ? "border-blue-600 ring-2 ring-blue-200"
                            : "border-line hover:border-blue-300"
                        } ${dimmed ? "opacity-35" : "opacity-100"}`}
                        style={{
                          left: position.x,
                          top: position.y,
                          width: position.width,
                          height: position.height,
                        }}
                      >
                        {node.kind === "concept" ? (
                          <span
                            className="block break-words text-sm font-bold leading-6 text-ink"
                            style={clampTwoLinesStyle()}
                          >
                            {node.label}
                          </span>
                        ) : (
                          <>
                            <span className="flex items-center gap-1.5 text-[11px] font-bold text-blue-700">
                              <ScanSearch className="size-3.5" aria-hidden="true" />
                              {node.kindLabel}
                            </span>
                            <span
                              className="mt-1.5 block break-words text-sm font-bold leading-6 text-ink"
                              style={clampTwoLinesStyle()}
                            >
                              {node.title}
                            </span>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <DetailPanel
              model={model}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onClear={() => setSelectedId(null)}
            />
          </div>

          <div className="mt-5">
            <Summary model={model} />
          </div>
          <RelationshipList model={model} onSelect={setSelectedId} />
        </>
      )}
    </div>
  );
}
