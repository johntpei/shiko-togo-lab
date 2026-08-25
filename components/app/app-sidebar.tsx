"use client";

import {
  BrainCircuit,
  CalendarClock,
  House,
  MessagesSquare,
  Network,
  Package,
  ScanSearch,
  ScrollText,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/app/identity";

const nav = [
  { href: "/", label: "ホーム", icon: House },
  { href: "/timeline", label: "Timeline", icon: CalendarClock },
  { href: "/thought-map", label: "思考マップ", icon: Network },
  { href: "/sessions", label: "Session", icon: MessagesSquare },
  { href: "/imports/chatgpt", label: "ChatGPT読込", icon: Upload },
  { href: "/reviews", label: "レビュー", icon: ScanSearch },
  { href: "/context-packs", label: "Context Pack", icon: Package },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="border-b border-line bg-white md:flex md:w-60 md:shrink-0 md:flex-col md:border-b-0 md:border-r">
      <div className="flex items-center justify-between gap-3 px-4 py-4 md:block md:px-5 md:py-6">
        <Link href="/" className="flex items-center gap-2.5 font-bold text-ink">
          <span className="flex size-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
            <BrainCircuit className="size-5" aria-hidden="true" />
          </span>
          <span className="text-sm tracking-wide">{APP_NAME}</span>
        </Link>
      </div>

      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:px-3 md:pb-0">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-bold whitespace-nowrap ${
                active
                  ? "bg-brand-soft text-blue-700"
                  : "text-muted hover:bg-canvas hover:text-ink"
              }`}
            >
              <Icon className="size-4" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line p-3 md:block">
        <Link
          href="/concept"
          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-bold text-muted hover:bg-canvas hover:text-ink"
        >
          <ScrollText className="size-4" aria-hidden="true" />
          企画ページ
        </Link>
      </div>
    </aside>
  );
}
