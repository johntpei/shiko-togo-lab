import { AlertTriangle, Gauge, Sparkles } from "lucide-react";
import { problemGrowth, problemLosses } from "@/data/content";
import { DiagramCard } from "@/components/ui/diagram-card";
import { FlowConnector } from "@/components/ui/flow-connector";
import { SectionHeading } from "@/components/ui/section-heading";

export function ProblemSection() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
      <SectionHeading
        eyebrow="01 / PROBLEM"
        title="便利になったのに、取りこぼしが増えた"
        description="以前なら得られなかった深い気づきが、制作・仕事・学習など複数の分野で大量かつ高速に生まれるようになった。一方で、それを整理する人間側の処理は追いついていません。"
        icon={AlertTriangle}
        tone="amber"
      />

      <div className="rounded-[2rem] border border-line bg-canvas p-5 sm:p-8">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
          {problemGrowth.map((item, index) => (
            <div key={item.title} className="contents">
              <div className="flex-1">
                <DiagramCard
                  {...item}
                  index={index + 1}
                  tone="blue"
                  compact
                />
              </div>
              {index < problemGrowth.length - 1 && (
                <FlowConnector tone="blue" />
              )}
            </div>
          ))}
        </div>

        <div className="my-6 flex flex-col items-center text-center">
          <div className="h-8 border-l-2 border-dashed border-amber-300" />
          <div className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800">
            <Gauge className="size-4" aria-hidden="true" />
            量とスピードに、自分の整理が追いつかない
          </div>
          <div className="h-8 border-l-2 border-dashed border-amber-300" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {problemLosses.map((item) => (
            <DiagramCard key={item.title} {...item} tone="amber" compact />
          ))}
        </div>
      </div>

      <div className="mt-8 flex items-start gap-4 rounded-2xl border-2 border-amber-200 bg-amber-50 p-6 shadow-[0_18px_50px_-38px_rgba(217,119,6,0.65)] sm:p-8">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <Sparkles className="size-6" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-bold tracking-[0.12em] text-amber-700">
            この企画を作りたい理由
          </p>
          <p className="mt-2 text-lg font-black leading-8 text-amber-950 sm:text-xl sm:leading-9">
            一番残念なのは、気づきが生まれないことではない。
            <br className="hidden sm:block" />
            せっかく生まれた良い気づきを、
            <span className="text-amber-700">次の思考に活かせないこと。</span>
          </p>
        </div>
      </div>
    </section>
  );
}
