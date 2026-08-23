import { ObservatoryHome } from "@/components/app/observatory-home";
import { loadTopicSignals } from "@/lib/concepts/topic-signal/load";
import { buildTopicSignalPresentation } from "@/lib/concepts/topic-signal/presentation";
import {
  countReviews,
  listContextPacksWithSessionCount,
  countSessionsInDateRange,
  listRecentSessions,
  listReviewsWithSessionCount,
} from "@/lib/db/queries";
import { getDb } from "@/lib/db/client";
import { loadObservatoryHome } from "@/lib/observations/home";
import { currentWeekRange } from "@/lib/sessions/labels";

export const dynamic = "force-dynamic";

export default function ObservatoryHomePage() {
  const week = currentWeekRange();
  const model = loadObservatoryHome();
  const topicSignals = buildTopicSignalPresentation(
    loadTopicSignals({ db: getDb() }),
  );

  return (
    <ObservatoryHome
      model={model}
      topicSignals={topicSignals}
      week={week}
      weekCount={countSessionsInDateRange(week.start, week.end)}
      reviewCount={countReviews()}
      recentReviews={listReviewsWithSessionCount().slice(0, 3)}
      recentPacks={listContextPacksWithSessionCount().slice(0, 3)}
      recentSessions={listRecentSessions(5)}
    />
  );
}
