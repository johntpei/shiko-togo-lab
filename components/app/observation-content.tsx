import type { ObservationCardModel } from "@/lib/observations/display";
import { formatThoughtDate } from "@/lib/observations/thought-date";

export function ObservationContent({
  observation,
  compact = false,
}: {
  observation: ObservationCardModel;
  compact?: boolean;
}) {
  if (observation.shift) {
    return (
      <div>
        <p className="text-[11px] font-bold text-muted">以前</p>
        <p className="mt-1 text-sm leading-7 text-ink">{observation.shift.before}</p>
        <p className="mt-3 text-center text-xs font-bold text-muted">↓</p>
        <p className="mt-3 text-[11px] font-bold text-muted">現在</p>
        <p className="mt-1 text-sm leading-7 text-ink">{observation.shift.after}</p>
        {compact ? null : (
          <p className="mt-3 text-sm leading-7 text-muted">
            {observation.shift.interpretation}
          </p>
        )}
      </div>
    );
  }
  if (observation.tension?.sideA || observation.tension?.sideB) {
    return (
      <div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <div className="rounded-xl border border-line bg-canvas px-3 py-3">
            <p className="text-[11px] font-bold text-muted">A</p>
            <p className="mt-1 text-sm leading-7 text-ink">
              {observation.tension.sideA}
            </p>
          </div>
          <p className="text-center text-xs font-bold text-muted">↔</p>
          <div className="rounded-xl border border-line bg-canvas px-3 py-3">
            <p className="text-[11px] font-bold text-muted">B</p>
            <p className="mt-1 text-sm leading-7 text-ink">
              {observation.tension.sideB}
            </p>
          </div>
        </div>
        {compact ? null : (
          <p className="mt-3 text-sm leading-7 text-ink">{observation.tension.text}</p>
        )}
      </div>
    );
  }
  if (observation.connection) {
    return (
      <div>
        {observation.connection.relationLabel ? (
          <p className="text-[11px] font-bold text-muted">
            {observation.connection.relationLabel}
          </p>
        ) : null}
        <p className={`${observation.connection.relationLabel ? "mt-1 " : ""}text-sm leading-7 text-ink`}>
          {observation.connection.text}
        </p>
      </div>
    );
  }
  return <p className="text-sm leading-7 text-ink">{observation.body || observation.title}</p>;
}

export function ObservationThoughtDate({
  observation,
}: {
  observation: ObservationCardModel;
}) {
  const label = formatThoughtDate(observation.thoughtDate);
  if (!label) {
    return null;
  }
  return <p className="text-[11px] font-bold text-muted">{label}</p>;
}
