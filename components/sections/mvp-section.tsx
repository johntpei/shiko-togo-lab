import {
  ArrowDown,
  ArrowRight,
  Braces,
  CalendarCheck,
  Check,
  PackageCheck,
} from "lucide-react";
import { mvpOutputs, mvpSteps } from "@/data/content";
import { SectionHeading } from "@/components/ui/section-heading";

export function MvpSection() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
      <SectionHeading
        eyebrow="03 / MVP"
        title="まずは「今週」を振り返れるようにする"
        description="卒業制作で最初から第2の脳を完成させるのではなく、いま一番困っている場面に、最小限の機能で価値を届けます。"
        icon={PackageCheck}
        tone="emerald"
      />

      <div className="overflow-hidden rounded-[2rem] border border-line bg-white shadow-[0_30px_80px_-55px_rgba(15,23,42,0.45)]">
        <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
          <div className="border-b border-line bg-slate-50 p-6 sm:p-8 lg:border-b-0 lg:border-r">
            <div className="mb-6 flex items-center gap-2 text-xs font-bold tracking-[0.12em] text-muted">
              <Braces className="size-4" aria-hidden="true" />
              MINIMUM FLOW
            </div>
            <div className="flex flex-col">
              {mvpSteps.map((item, index) => {
                const Icon = item.icon;
                return (
                  <div key={item.title}>
                    <div className="flex gap-4 rounded-2xl border border-line bg-white p-4">
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                        <Icon className="size-5" aria-hidden="true" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-ink">
                          {index + 1}. {item.title}
                        </div>
                        <p className="mt-1 text-xs leading-6 text-muted">
                          {item.description}
                        </p>
                      </div>
                    </div>
                    {index < mvpSteps.length - 1 && (
                      <div className="ml-[2.15rem] h-6 border-l-2 border-dashed border-emerald-200" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-6 sm:p-8">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold tracking-[0.12em] text-emerald-700">
                  INTEGRATED REVIEW
                </div>
                <h3 className="mt-2 text-xl font-black text-ink">
                  一度のレビューで見えること
                </h3>
              </div>
              <div className="hidden size-12 items-center justify-center rounded-2xl bg-emerald-600 text-white sm:flex">
                <Check className="size-6" aria-hidden="true" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {mvpOutputs.map((item, index) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className={`flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 ${
                      index === mvpOutputs.length - 1
                        ? "sm:col-span-2"
                        : ""
                    }`}
                  >
                    <Icon
                      className="size-4 shrink-0 text-emerald-600"
                      aria-hidden="true"
                    />
                    <div>
                      <div className="text-sm font-bold text-ink">
                        {item.title}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted">
                        {item.description}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-emerald-100 bg-emerald-50 px-6 py-5 text-center sm:flex-row sm:text-left">
          <div className="flex items-center gap-3">
            <CalendarCheck
              className="size-5 shrink-0 text-emerald-700"
              aria-hidden="true"
            />
            <p className="text-sm font-bold text-emerald-950">
              MVPの価値：まずは今週のChatGPT対話を、週末にまとめて振り返れる
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-700">
            小さく作る
            <ArrowRight className="hidden size-4 sm:block" />
            <ArrowDown className="size-4 sm:hidden" />
            すぐ使う
          </div>
        </div>
      </div>
    </section>
  );
}
