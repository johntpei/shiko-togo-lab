import type { Metadata } from "next";
import { ClosingSection } from "@/components/sections/closing-section";
import { HeroSection } from "@/components/sections/hero-section";
import { MvpSection } from "@/components/sections/mvp-section";
import { ProblemSection } from "@/components/sections/problem-section";
import { SolutionSection } from "@/components/sections/solution-section";
import { VisionSection } from "@/components/sections/vision-section";

export const metadata: Metadata = {
  title: {
    absolute: "思考統合研究所 | ChatGPTとの対話を知見へ",
  },
  description:
    "ChatGPTとの複数の対話を統合・整理し、振り返りと次の行動につながる知見へ変える卒業制作の企画ページです。",
};

export default function ConceptPage() {
  return (
    <main>
      <HeroSection />
      <ProblemSection />
      <SolutionSection />
      <MvpSection />
      <VisionSection />
      <ClosingSection />
    </main>
  );
}
