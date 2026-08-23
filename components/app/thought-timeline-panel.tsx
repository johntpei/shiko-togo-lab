import {
  THOUGHT_TIMELINE_PRESENTATION_COPY,
  type ThoughtTimelinePresentation,
  type ThoughtTimelinePresentationObservation,
  type ThoughtTimelinePresentationTheme,
} from "@/lib/thought-timeline/presentation";

function ObservationBlock({
  observation,
}: {
  observation: ThoughtTimelinePresentationObservation;
}) {
  return (
    <article className="min-w-0 rounded-2xl border border-line bg-white px-4 py-3">
      <p className="text-[11px] font-bold tracking-[0.16em] text-blue-600">
        {observation.typeLabel}
      </p>
      <p className="mt-2 break-words text-sm leading-7 text-ink">
        {observation.summary}
      </p>
      {observation.sessionCount >= 2 ? (
        <p className="mt-2 text-xs leading-5 text-muted">
          {observation.sessionCount}つの会話から
        </p>
      ) : null}
    </article>
  );
}

function ThemeChip({ theme }: { theme: ThoughtTimelinePresentationTheme }) {
  const countLabel =
    theme.occurrenceCount > 1 ? ` ×${theme.occurrenceCount}` : "";
  return (
    <li className="min-w-0">
      <span className="inline-flex max-w-full break-words rounded-full border border-line bg-canvas px-3 py-1 text-xs leading-5 text-muted">
        {theme.canonicalLabel}
        {countLabel}
      </span>
    </li>
  );
}

export function ThoughtTimelinePanel({
  model,
}: {
  model: ThoughtTimelinePresentation;
}) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <p className="text-xs font-bold tracking-[0.18em] text-blue-600">
        {THOUGHT_TIMELINE_PRESENTATION_COPY.eyebrow}
      </p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-ink sm:text-4xl">
        {THOUGHT_TIMELINE_PRESENTATION_COPY.title}
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted sm:text-base">
        {THOUGHT_TIMELINE_PRESENTATION_COPY.subtitle}
      </p>
      {model.rangeLabel ? (
        <p className="mt-2 text-xs leading-6 text-muted">{model.rangeLabel}</p>
      ) : null}

      {model.groups.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line bg-white px-5 py-4">
          <p className="font-bold text-ink">
            {THOUGHT_TIMELINE_PRESENTATION_COPY.emptyTitle}
          </p>
          <p className="mt-2 text-sm leading-7 text-muted">
            {THOUGHT_TIMELINE_PRESENTATION_COPY.emptyBody}
          </p>
        </div>
      ) : (
        <ol className="mt-10 grid min-w-0 gap-10">
          {model.groups.map((group) => (
            <li key={group.date} className="min-w-0">
              <section className="min-w-0">
                <h2 className="text-lg font-black text-ink">{group.dateLabel}</h2>
                <div className="mt-4 min-w-0 border-l border-line pl-4 sm:pl-5">
                  {group.observations.length > 0 ? (
                    <div className="grid min-w-0 gap-3">
                      {group.observations.map((observation) => (
                        <ObservationBlock
                          key={observation.observationId}
                          observation={observation}
                        />
                      ))}
                    </div>
                  ) : null}
                  {group.themes.length > 0 ? (
                    <section
                      className={
                        group.observations.length > 0 ? "mt-4 min-w-0" : "min-w-0"
                      }
                    >
                      <h3 className="text-xs font-bold tracking-[0.12em] text-muted">
                        {THOUGHT_TIMELINE_PRESENTATION_COPY.themeHeading}
                      </h3>
                      <ul className="mt-2 flex min-w-0 flex-wrap gap-2">
                        {group.themes.map((theme) => (
                          <ThemeChip
                            key={`${group.date}-${theme.canonicalLabel}`}
                            theme={theme}
                          />
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </div>
              </section>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
