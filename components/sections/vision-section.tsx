import {
  ArrowDown,
  ArrowRight,
  BrainCircuit,
  Database,
  Infinity as InfinityIcon,
} from "lucide-react";
import {
  visionCore,
  visionFeatures,
  visionOptimization,
} from "@/data/content";
import { DiagramCard } from "@/components/ui/diagram-card";
import { SectionHeading } from "@/components/ui/section-heading";

export function VisionSection() {
  const OptimizationIcon = visionOptimization.icon;
  const evolution = [
    "記憶を補う",
    "複数の思考を統合",
    "知識を育てる",
    "AI利用を個人最適化",
  ];

  return (
    <section className="relative overflow-hidden bg-slate-950 text-white">
      <div className="dot-grid absolute inset-0 opacity-[0.08]" />
      <div className="relative mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <SectionHeading
          eyebrow="04 / VISION"
          title="最終的には、巨大な“第2の脳”へ"
          description="日々の対話がその場限りで消えず、つながり、更新され、自分だけの知識資産として長期的に育っていく仕組みを目指します。"
          icon={BrainCircuit}
          tone="indigo"
          inverse
        />

        <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm sm:p-8">
          <div className="mb-7 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold tracking-[0.14em] text-indigo-300">
                KNOWLEDGE GROWTH
              </div>
              <h3 className="mt-2 text-lg font-bold">
                対話が、知識へ育つ中心軸
              </h3>
            </div>
            <Database className="size-6 text-indigo-300" aria-hidden="true" />
          </div>

          <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
            {visionCore.map((item, index) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="contents">
                  <article className="flex flex-1 items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-5">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-indigo-400/10 text-indigo-300 ring-1 ring-indigo-300/20">
                      <Icon className="size-6" aria-hidden="true" />
                    </div>
                    <div>
                      <h4 className="font-black text-white">{item.title}</h4>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        {item.description}
                      </p>
                    </div>
                  </article>
                  {index < visionCore.length - 1 && (
                    <div className="flex justify-center text-indigo-400">
                      <ArrowRight className="hidden size-5 md:block" />
                      <ArrowDown className="size-5 md:hidden" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visionFeatures.map((item) => (
            <DiagramCard key={item.title} {...item} tone="indigo" compact />
          ))}
        </div>

        <div className="mt-5 rounded-[2rem] border border-emerald-300/20 bg-emerald-400/[0.08] p-6 sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex max-w-3xl items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-300/10 text-emerald-300 ring-1 ring-emerald-300/20">
                <OptimizationIcon className="size-6" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-bold tracking-[0.14em] text-emerald-300">
                  BEYOND MEMORY
                </p>
                <h3 className="mt-2 text-2xl font-black leading-tight tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
                  {visionOptimization.title}
                </h3>
                <p className="mt-2 text-sm leading-7 text-slate-300">
                  {visionOptimization.description}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-7 grid gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1.2fr] lg:items-center">
            {evolution.map((step, index) => (
              <div key={step} className="contents">
                <div
                  className={`rounded-xl border px-4 py-3 text-center text-xs font-bold ${
                    index === evolution.length - 1
                      ? "border-emerald-300/30 bg-emerald-300/15 text-emerald-200"
                      : "border-white/10 bg-white/[0.05] text-slate-300"
                  }`}
                >
                  {step}
                </div>
                {index < evolution.length - 1 && (
                  <div className="flex justify-center text-emerald-400/70">
                    <ArrowRight className="hidden size-4 lg:block" />
                    <ArrowDown className="size-4 lg:hidden" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-col items-center justify-between gap-6 rounded-[2rem] border border-indigo-400/20 bg-indigo-500/10 p-6 text-center sm:flex-row sm:p-8 sm:text-left">
          <div>
            <p className="text-xs font-bold tracking-[0.14em] text-indigo-300">
              LONG-TERM VALUE
            </p>
            <h3 className="mt-2 text-2xl font-black leading-tight tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.4)] sm:text-3xl">
              長期的な知識資産化
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300">
              過去の自分の思考を、未来の自分とAIが再利用できる状態へ。
              使うほど、自分への理解が深まる基盤にしていきます。
            </p>
          </div>
          <InfinityIcon
            className="size-12 shrink-0 text-indigo-300"
            aria-hidden="true"
          />
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-5">
            <div className="text-xs font-bold tracking-wider text-emerald-300">
              NOW / 卒業制作
            </div>
            <p className="mt-2 font-bold text-white">
              今週分を振り返れる、小さく実用的なMVP
            </p>
          </div>
          <div className="rounded-2xl border border-indigo-300/20 bg-indigo-400/10 p-5">
            <div className="text-xs font-bold tracking-wider text-indigo-300">
              FUTURE / 将来構想
            </div>
            <p className="mt-2 font-bold text-white">
              人生の対話と知見が育ち続ける、第2の脳
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
