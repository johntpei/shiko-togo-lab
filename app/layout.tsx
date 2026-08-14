import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import "./globals.css";

const notoSansJp = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "思考統合研究所",
    template: "%s | 思考統合研究所",
  },
  description:
    "ChatGPTとの対話を取りこぼさず、振り返りと次の対話へ再利用できる思考資産へ変える個人ツールです。",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${notoSansJp.variable} scroll-smooth`}>
      <body>{children}</body>
    </html>
  );
}
