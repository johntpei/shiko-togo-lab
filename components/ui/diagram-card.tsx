import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type DiagramCardProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  index?: number;
  tone?: "blue" | "amber" | "emerald" | "indigo" | "slate";
  compact?: boolean;
  children?: ReactNode;
};

const tones = {
  blue: {
    icon: "bg-blue-50 text-blue-600 ring-blue-100",
    accent: "text-blue-700",
  },
  amber: {
    icon: "bg-amber-50 text-amber-600 ring-amber-100",
    accent: "text-amber-700",
  },
  emerald: {
    icon: "bg-emerald-50 text-emerald-600 ring-emerald-100",
    accent: "text-emerald-700",
  },
  indigo: {
    icon: "bg-indigo-50 text-indigo-600 ring-indigo-100",
    accent: "text-indigo-700",
  },
  slate: {
    icon: "bg-slate-100 text-slate-600 ring-slate-200",
    accent: "text-slate-700",
  },
};

export function DiagramCard({
  icon: Icon,
  title,
  description,
  index,
  tone = "blue",
  compact = false,
  children,
}: DiagramCardProps) {
  const color = tones[tone];

  return (
    <article
      className={`relative rounded-2xl border border-line bg-white shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] ${
        compact ? "p-4" : "p-6"
      }`}
    >
      {index !== undefined && (
        <span
          className={`absolute right-4 top-4 text-xs font-black tabular-nums ${color.accent}`}
        >
          {String(index).padStart(2, "0")}
        </span>
      )}
      <div
        className={`flex size-11 items-center justify-center rounded-xl ring-1 ${color.icon}`}
      >
        <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
      </div>
      <h3 className={`font-bold text-ink ${compact ? "mt-3 text-sm" : "mt-5"}`}>
        {title}
      </h3>
      <p
        className={`mt-2 leading-6 text-muted ${
          compact ? "text-xs" : "text-sm"
        }`}
      >
        {description}
      </p>
      {children}
    </article>
  );
}
