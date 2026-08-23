import {
  TOPIC_SIGNAL_UI_COPY,
  type TopicSignalPresentationItem,
  type TopicSignalPresentationModel,
} from "@/lib/concepts/topic-signal/presentation";

function SignalRow({
  label,
  detail,
}: {
  label: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 px-4 py-2.5">
      <p className="break-words text-sm font-medium text-ink">{label}</p>
      <p className="mt-0.5 break-words text-xs leading-5 text-muted">{detail}</p>
    </div>
  );
}

function SignalGroup({
  title,
  description,
  items,
  empty,
}: {
  title: string;
  description: string;
  items: TopicSignalPresentationItem[];
  empty: string;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-line bg-white">
      <div className="px-4 py-3">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
      </div>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${title}-${index}`} className="border-t border-line">
              <SignalRow label={item.canonicalLabel} detail={item.detail} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-line px-4 py-3 text-sm leading-6 text-muted">
          {empty}
        </p>
      )}
    </section>
  );
}

export function TopicSignalPanel({
  model,
}: {
  model: TopicSignalPresentationModel;
}) {
  return (
    <section className="mt-10 min-w-0">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-black text-ink">
          {TOPIC_SIGNAL_UI_COPY.sectionTitle}
        </h2>
        {model.asOfLabel ? (
          <p className="text-xs leading-6 text-muted">{model.asOfLabel}</p>
        ) : null}
      </div>
      {model.overallEmpty ? (
        <p className="mt-3 text-sm leading-7 text-muted">
          {TOPIC_SIGNAL_UI_COPY.overallEmpty}
        </p>
      ) : (
        <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <SignalGroup
            title={TOPIC_SIGNAL_UI_COPY.recentlyObservedTitle}
            description={TOPIC_SIGNAL_UI_COPY.recentlyObservedDescription}
            items={model.recentlyObserved}
            empty={TOPIC_SIGNAL_UI_COPY.recentlyObservedEmpty}
          />
          <SignalGroup
            title={TOPIC_SIGNAL_UI_COPY.recurrenceTitle}
            description={TOPIC_SIGNAL_UI_COPY.recurrenceDescription}
            items={model.recurrence}
            empty={TOPIC_SIGNAL_UI_COPY.recurrenceEmpty}
          />
        </div>
      )}
    </section>
  );
}
