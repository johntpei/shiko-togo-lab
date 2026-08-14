import { ArrowDown, ArrowRight, Combine } from "lucide-react";
import { solutionSteps } from "@/data/content";
import { SectionHeading } from "@/components/ui/section-heading";

export function SolutionSection() {
  return (
    <section className="border-y border-blue-100 bg-blue-50/50">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <SectionHeading
          eyebrow="02 / APPROACH"
          title="対話を、まとめて読む"
          description="一つひとつのチャットを要約するだけではなく、複数の対話を横断して比較することで、思考のつながりと変化を発見します。"
          icon={Combine}
          tone="blue"
          align="center"
        />

        <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-stretch">
          {solutionSteps.map((item, index) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="contents">
                <article className="relative flex flex-col rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                  <span className="mb-5 text-xs font-black text-blue-300">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                    <Icon className="size-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-4 text-sm font-bold leading-6 text-ink">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-xs leading-6 text-muted">
                    {item.description}
                  </p>
                </article>
                {index < solutionSteps.length - 1 && (
                  <div
                    className="flex items-center justify-center text-blue-300"
                    aria-hidden="true"
                  >
                    <ArrowRight className="hidden size-4 lg:block" />
                    <ArrowDown className="size-4 lg:hidden" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mx-auto mt-8 max-w-3xl rounded-2xl bg-blue-600 px-6 py-5 text-center text-sm font-bold leading-7 text-white shadow-xl shadow-blue-600/15 sm:text-base">
          <span className="mr-2 inline-flex rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] tracking-wider text-blue-50">
            要約で終わらない
          </span>
          整理の終点は「きれいな要約」ではなく、
          <span className="text-blue-100">
            次に考える問いが見つかること
          </span>
        </div>
      </div>
    </section>
  );
}
