import {
  ArrowDown,
  ArrowRight,
  BrainCircuit,
  Lightbulb,
  MessagesSquare,
  ScanSearch,
} from "lucide-react";
import Link from "next/link";

const summary = [
  {
    label: "散在する対話",
    note: "複数のChatGPT Session",
    icon: MessagesSquare,
    color: "bg-slate-50 text-slate-600 ring-slate-200",
  },
  {
    label: "統合レビュー",
    note: "比較・発見・問い直す",
    icon: ScanSearch,
    color: "bg-blue-50 text-blue-600 ring-blue-100",
  },
  {
    label: "育つ知見",
    note: "次の思考と行動へ",
    icon: Lightbulb,
    color: "bg-emerald-50 text-emerald-600 ring-emerald-100",
  },
];

export function HeroSection() {
  return (
    <section className="relative overflow-hidden border-b border-line bg-white">
      <div className="dot-grid absolute inset-0 opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent_80%)]" />
      <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-8 sm:px-8 sm:pb-28">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 font-bold text-ink">
            <span className="flex size-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
              <BrainCircuit className="size-5" aria-hidden="true" />
            </span>
            <span className="text-sm tracking-wide">思考統合研究所</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-xs font-bold text-blue-600 hover:underline"
            >
              ツールを開く
            </Link>
            <span className="rounded-full border border-line bg-white/80 px-3 py-1 text-[11px] font-bold tracking-[0.14em] text-muted backdrop-blur">
              GRADUATION PROJECT
            </span>
          </div>
        </div>

        <div className="mx-auto mt-16 max-w-4xl text-center sm:mt-20">
          <p className="mb-5 text-xs font-bold tracking-[0.22em] text-blue-600 sm:text-sm">
            AIとの対話を、思考資産へ
          </p>
          <h1 className="text-5xl font-black tracking-[-0.05em] text-ink sm:text-7xl">
            思考統合研究所
          </h1>
          <p className="mx-auto mt-7 max-w-3xl text-2xl font-black leading-[1.55] tracking-tight text-ink sm:text-4xl sm:leading-[1.45]">
            AIが考える速度は上がった。
            <br />
            <span className="text-blue-600">
              次に必要なのは、
              <br />
              人間がその知見を取りこぼさない仕組み。
            </span>
          </p>
          <p className="mx-auto mt-7 max-w-3xl text-base font-bold leading-8 text-slate-700 sm:text-xl sm:leading-9">
            ChatGPTとの複数の対話を、取りこぼさず、
            <br className="hidden sm:block" />
            次につながる知見へ変える統合支援ツール
          </p>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-muted sm:text-base sm:leading-8">
            AIが賢くなった結果、人間側の整理が追いつかなくなった。
            <br />
            だから、対話から生まれた気づきを統合し、
            振り返りや次の行動に活かせる形に残す。
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-5xl rounded-[2rem] border border-blue-100 bg-white/90 p-5 shadow-[0_30px_90px_-45px_rgba(37,99,235,0.4)] backdrop-blur sm:p-8">
          <p className="mb-7 text-center text-sm font-bold text-ink">
            <span className="block">ひとことで言えば</span>
            <span className="mt-2 block text-xl text-blue-600 sm:text-2xl">
              「対話の点」を「知見の線」へ変える
            </span>
          </p>
          <div className="flex flex-col items-stretch justify-center gap-2 md:flex-row md:items-center">
            {summary.map((item, index) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="contents"
                >
                  <div className="flex flex-1 items-center gap-4 rounded-2xl border border-line bg-white p-4 sm:p-5">
                    <div
                      className={`flex size-12 shrink-0 items-center justify-center rounded-xl ring-1 ${item.color}`}
                    >
                      <Icon className="size-6" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="font-bold text-ink">{item.label}</div>
                      <div className="mt-0.5 text-xs text-muted">{item.note}</div>
                    </div>
                  </div>
                  {index < summary.length - 1 && (
                    <div className="flex justify-center text-blue-400">
                      <ArrowRight className="hidden size-5 md:block" />
                      <ArrowDown className="size-5 md:hidden" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
