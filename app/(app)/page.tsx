import { ObservatoryHome } from "@/components/app/observatory-home";
import {
  countReviews,
  listContextPacksWithSessionCount,
  countSessionsInDateRange,
  listRecentSessions,
  listReviewsWithSessionCount,
} from "@/lib/db/queries";
import { loadObservatoryHome } from "@/lib/observations/home";
import { currentWeekRange } from "@/lib/sessions/labels";

export const dynamic = "force-dynamic";

export default function ObservatoryHomePage() {
  const week = currentWeekRange();
  const model = loadObservatoryHome();

  return (
    <ObservatoryHome
      model={model}
      week={week}
      weekCount={countSessionsInDateRange(week.start, week.end)}
      reviewCount={countReviews()}
      recentReviews={listReviewsWithSessionCount().slice(0, 3)}
      recentPacks={listContextPacksWithSessionCount().slice(0, 3)}
      recentSessions={listRecentSessions(5)}
    />
  );
}
