import { ThoughtMapPanel } from "@/components/app/thought-map-panel";
import { getDb } from "@/lib/db/client";
import { loadThoughtMap } from "@/lib/thought-map/load";
import { buildThoughtMapPresentation } from "@/lib/thought-map/presentation";

export const metadata = {
  title: "思考マップ",
};

export const dynamic = "force-dynamic";

export default function ThoughtMapPage() {
  const map = loadThoughtMap({ db: getDb() });
  return <ThoughtMapPanel model={buildThoughtMapPresentation(map)} />;
}
