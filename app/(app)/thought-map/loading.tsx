export default function ThoughtMapLoading() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="h-3 w-16 animate-pulse rounded bg-blue-100" />
      <div className="mt-4 h-10 w-48 animate-pulse rounded-xl bg-slate-200" />
      <div className="mt-4 h-5 max-w-xl animate-pulse rounded bg-slate-100" />
      <div className="mt-8 rounded-2xl border border-line bg-white p-5">
        <div className="grid min-h-80 grid-cols-2 gap-16">
          <div className="grid content-center gap-6">
            <div className="h-20 animate-pulse rounded-2xl bg-blue-50" />
            <div className="h-20 animate-pulse rounded-2xl bg-blue-50" />
          </div>
          <div className="grid content-center gap-6">
            <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          </div>
        </div>
      </div>
    </div>
  );
}
