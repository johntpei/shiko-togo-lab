import { ArrowDown, ArrowRight } from "lucide-react";

type FlowConnectorProps = {
  label?: string;
  tone?: "blue" | "amber" | "emerald";
};

const toneClasses = {
  blue: "text-blue-400",
  amber: "text-amber-400",
  emerald: "text-emerald-400",
};

export function FlowConnector({
  label,
  tone = "blue",
}: FlowConnectorProps) {
  return (
    <div
      className={`flex shrink-0 flex-col items-center justify-center gap-1 px-1 py-2 ${toneClasses[tone]}`}
      aria-hidden="true"
    >
      {label && (
        <span className="text-[10px] font-bold tracking-wider">{label}</span>
      )}
      <ArrowRight className="hidden size-5 lg:block" />
      <ArrowDown className="size-5 lg:hidden" />
    </div>
  );
}
