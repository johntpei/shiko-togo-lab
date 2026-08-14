import { ArrowRight, BrainCircuit, MessagesSquare } from "lucide-react";

export function ClosingSection() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="relative overflow-hidden rounded-[2rem] bg-blue-600 px-6 py-14 text-center text-white shadow-2xl shadow-blue-600/20 sm:px-12 sm:py-20">
          <div className="dot-grid absolute inset-0 opacity-10" />
          <div className="relative">
            <div className="mx-auto flex w-fit items-center gap-3 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold">
              <MessagesSquare className="size-4" aria-hidden="true" />
              高性能AI
              <ArrowRight className="size-4 text-blue-200" aria-hidden="true" />
              <BrainCircuit className="size-4" aria-hidden="true" />
              受け取れる利益を最大化
            </div>
            <h2 className="mx-auto mt-8 max-w-5xl text-3xl font-black leading-tight tracking-tight sm:text-5xl sm:leading-tight">
              AIそのものを、さらに
              <br className="hidden sm:block" />
              賢くするツールではない。
              <br />
              <span className="mt-1 block text-blue-100 sm:whitespace-nowrap sm:text-[clamp(1.8rem,4vw,3rem)]">
                AIから受け取れる利益を最大化する。
              </span>
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-sm leading-8 text-blue-100 sm:text-base">
              AIはこれからも賢くなる。だから、対話から生まれた知見を失わず、
              過去と現在をつなぎ、その人に合った形で次の思考へ活かす。
              <br className="hidden sm:block" />
              思考統合研究所は、そのための統合支援ツールを目指します。
            </p>
          </div>
        </div>

        <footer className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-line pt-8 text-xs text-slate-400 sm:flex-row">
          <div className="flex items-center gap-2 font-bold text-slate-600">
            <BrainCircuit className="size-4 text-blue-600" aria-hidden="true" />
            思考統合研究所
          </div>
          <p>Graduation Project Concept / 2026</p>
        </footer>
      </div>
    </section>
  );
}
