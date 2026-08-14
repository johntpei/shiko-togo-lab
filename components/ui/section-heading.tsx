import type { LucideIcon } from "lucide-react";

type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  tone?: "blue" | "amber" | "emerald" | "indigo";
  align?: "left" | "center";
  inverse?: boolean;
};

const toneClasses = {
  blue: "bg-blue-50 text-blue-700 ring-blue-100",
  amber: "bg-amber-50 text-amber-700 ring-amber-100",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-100",
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  icon: Icon,
  tone = "blue",
  align = "left",
  inverse = false,
}: SectionHeadingProps) {
  const centered = align === "center";

  return (
    <div
      className={`mb-10 max-w-3xl ${centered ? "mx-auto text-center" : ""}`}
    >
      <div
        className={`mb-5 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold tracking-[0.12em] ring-1 ${toneClasses[tone]}`}
      >
        <Icon className="size-4" aria-hidden="true" />
        {eyebrow}
      </div>
      <h2
        className={`font-black leading-tight tracking-tight ${
          inverse
            ? "text-4xl text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)] sm:text-5xl"
            : "text-3xl text-ink sm:text-4xl"
        }`}
      >
        {title}
      </h2>
      <p
        className={`mt-4 text-base leading-8 sm:text-lg ${
          inverse ? "text-slate-300" : "text-muted"
        }`}
      >
        {description}
      </p>
    </div>
  );
}
