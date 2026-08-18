import { getReviewById, listSessionsByIds } from "@/lib/db/queries";
import {
  listObservationSessionIdsByObservationIds,
  listObservations,
} from "@/lib/db/observation-queries";
import type { ObservationCardModel, HomeObservation } from "./display";
import { toObservationCardModel } from "./display";
import { observationFromRecord } from "./from-record";
import { pickSpotlight } from "./spotlight";
import { thoughtDateSortKey } from "./thought-date";
import type { ReviewObservationKind } from "./types";

export const HOME_OBSERVATION_LIMIT = 5;

export const HOME_DATA_ACTIONS = [
  {
    href: "/sessions/new",
    title: "手動で貼り付ける",
    body: "対話のテキストや .md / .txt を登録する",
  },
  {
    href: "/imports/chatgpt",
    title: "ChatGPTデータを読み込む",
    body: "公式エクスポートの JSON から取り込む",
  },
  {
    href: "/reviews/new?preset=this-week",
    title: "今週をレビューする",
    body: "複数の Session を選んで統合レビューする",
  },
] as const;

export type ObservatoryHomeModel = {
  spotlight: ObservationCardModel | null;
  shifts: ObservationCardModel[];
  connections: ObservationCardModel[];
  tensions: ObservationCardModel[];
  totalCount: number;
};

function compareHomeList(left: HomeObservation, right: HomeObservation) {
  const byDate = thoughtDateSortKey(right).localeCompare(
    thoughtDateSortKey(left),
  );
  if (byDate !== 0) {
    return byDate;
  }
  return left.id.localeCompare(right.id);
}

export function buildObservatoryHomeModel(
  observations: HomeObservation[],
  extras: {
    sessionsById: Map<string, { id: string; title: string; occurredAt: string }>;
    reviewTitleById: Map<string, string>;
    now?: Date;
  },
): ObservatoryHomeModel {
  const now = extras.now ?? new Date();
  const toModel = (observation: HomeObservation) =>
    toObservationCardModel(observation, {
      sessions: observation.sessionIds.flatMap((id) => {
        const session = extras.sessionsById.get(id);
        return session ? [session] : [];
      }),
      sourceReviewTitle: extras.reviewTitleById.get(observation.sourceReviewId) ?? null,
    });

  const spotlight = pickSpotlight(observations, now);
  const byKind = (kind: ReviewObservationKind) =>
    observations
      .filter((item) => item.kind === kind)
      .sort(compareHomeList)
      .slice(0, HOME_OBSERVATION_LIMIT)
      .map(toModel);

  return {
    spotlight: spotlight ? toModel(spotlight) : null,
    shifts: byKind("shift"),
    connections: byKind("connection"),
    tensions: byKind("tension"),
    totalCount: observations.length,
  };
}

export function loadObservatoryHome(now = new Date()): ObservatoryHomeModel {
  const records = listObservations();
  const sessionIdsByObservation = listObservationSessionIdsByObservationIds(
    records.map((record) => record.id),
  );
  const observations: HomeObservation[] = [];
  for (const record of records) {
    const parsed = observationFromRecord(
      record,
      sessionIdsByObservation.get(record.id) ?? [],
    );
    if (parsed) {
      observations.push({ ...parsed, id: record.id });
    }
  }
  const sessionIds = [
    ...new Set(observations.flatMap((item) => item.sessionIds)),
  ];
  const sessionsById = new Map(
    listSessionsByIds(sessionIds).map((session) => [
      session.id,
      {
        id: session.id,
        title: session.title,
        occurredAt: session.occurredAt,
      },
    ]),
  );
  const reviewTitleById = new Map<string, string>();
  for (const reviewId of new Set(
    observations.map((item) => item.sourceReviewId),
  )) {
    const review = getReviewById(reviewId);
    if (review) {
      reviewTitleById.set(review.id, review.title);
    }
  }
  return buildObservatoryHomeModel(observations, {
    sessionsById,
    reviewTitleById,
    now,
  });
}
