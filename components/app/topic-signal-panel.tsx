import {
  TOPIC_SIGNAL_UI_COPY,
  type TopicSignalPresentationModel,
} from "@/lib/concepts/topic-signal/presentation";

function EmptyNote({ children }: { children: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-line bg-white px-5 py-4 text-sm leading-7 text-muted">
      {children}
    </p>
  );
}

function SignalItem({
  label,
  detail,
}: {
  label: string;
  detail: string;
}) {
  return (
    <article className="min-w-0 rounded-2xl border border-line bg-white px-5 py-4 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)]">
      <p className="break-words text-base font-black tracking-tight text-ink">
        {label}
      </p>
      <p className="mt-1 break-words text-sm leading-6 text-muted">{detail}</p>
    </article>
  );
}

export function TopicSignalPanel({
  model,
}: {
  model: TopicSignalPresentationModel;
}) {
  return (
    <section className="mt-10 min-w-0">
      <h2 className="text-lg font-black text-ink">
        {TOPIC_SIGNAL_UI_COPY.sectionTitle}
      </h2>
      {model.asOfLabel ? (
        <p className="mt-1 text-xs leading-6 text-muted">{model.asOfLabel}</p>
      ) : null}
      {model.overallEmpty ? (
        <p className="mt-3 text-sm leading-7 text-muted">
          {TOPIC_SIGNAL_UI_COPY.overallEmpty}
        </p>
      ) : null}

      <section className="mt-6 min-w-0">
        <h3 className="text-base font-black text-ink">
          {TOPIC_SIGNAL_UI_COPY.recentlyObservedTitle}
        </h3>
        <p className="mt-1 max-w-2xl text-sm leading-7 text-muted">
          {TOPIC_SIGNAL_UI_COPY.recentlyObservedDescription}
        </p>
        <div className="mt-4 grid min-w-0 gap-3">
          {model.recentlyObserved.length > 0 ? (
            model.recentlyObserved.map((item, index) => (
              <SignalItem
                key={`recently-observed-${index}`}
                label={item.canonicalLabel}
                detail={item.detail}
              />
            ))
          ) : (
            <EmptyNote>{TOPIC_SIGNAL_UI_COPY.recentlyObservedEmpty}</EmptyNote>
          )}
        </div>
      </section>

      <section className="mt-8 min-w-0">
        <h3 className="text-base font-black text-ink">
          {TOPIC_SIGNAL_UI_COPY.recurrenceTitle}
        </h3>
        <p className="mt-1 max-w-2xl text-sm leading-7 text-muted">
          {TOPIC_SIGNAL_UI_COPY.recurrenceDescription}
        </p>
        <div className="mt-4 grid min-w-0 gap-3">
          {model.recurrence.length > 0 ? (
            model.recurrence.map((item, index) => (
              <SignalItem
                key={`cross-session-${index}`}
                label={item.canonicalLabel}
                detail={item.detail}
              />
            ))
          ) : (
            <EmptyNote>{TOPIC_SIGNAL_UI_COPY.recurrenceEmpty}</EmptyNote>
          )}
        </div>
      </section>
    </section>
  );
}
