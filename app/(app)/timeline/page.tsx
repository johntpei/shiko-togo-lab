import { ThoughtTimelinePanel } from "@/components/app/thought-timeline-panel";
import { getDb } from "@/lib/db/client";
import { loadThoughtTimelinePresentation } from "@/lib/thought-timeline/presentation-load";

export const metadata = {
  title: "思考のタイムライン",
};

export const dynamic = "force-dynamic";

export default function ThoughtTimelinePage() {
  const model = loadThoughtTimelinePresentation({ db: getDb() });
  return <ThoughtTimelinePanel model={model} />;
}
