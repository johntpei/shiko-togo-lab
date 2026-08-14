type ComingSoonProps = {
  title: string;
  description: string;
};

export function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <h1 className="text-2xl font-black tracking-tight text-ink sm:text-3xl">
        {title}
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted sm:text-base">
        {description}
      </p>
      <div className="mt-8 rounded-2xl border border-line bg-white p-6 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)]">
        <p className="text-xs font-bold tracking-[0.12em] text-blue-600">
          COMING NEXT
        </p>
        <p className="mt-2 text-sm leading-7 text-muted">
          この画面の本体は、次の実装STEPで追加します。ナビとページ枠だけ先に置いてあります。
        </p>
      </div>
    </div>
  );
}
