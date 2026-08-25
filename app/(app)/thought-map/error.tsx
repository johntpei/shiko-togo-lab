"use client";

export default function ThoughtMapError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <p className="text-xs font-bold tracking-[0.18em] text-blue-600">観測</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-ink sm:text-4xl">
        思考マップ
      </h1>
      <div className="mt-8 rounded-2xl border border-red-200 bg-white p-5 sm:p-6">
        <p className="font-bold text-ink">思考マップを読み込めませんでした。</p>
        <p className="mt-2 text-sm leading-7 text-muted">
          時間をおいて再読み込みしてください。
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
        >
          もう一度読み込む
        </button>
      </div>
    </div>
  );
}
