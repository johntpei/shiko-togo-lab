import type { ReviewRelationType } from "@/lib/ai/evidence-groups";
import { thoughtDate } from "./thought-date";
import type { Observation, ReviewObservationKind } from "./types";

export type HomeObservation = Observation & { id: string };

export type ObservationSessionLink = {
  id: string;
  title: string;
  occurredAt: string;
};

export type ObservationCardModel = {
  id: string;
  kind: ReviewObservationKind;
  kindLabel: string;
  spotlightLabel: string;
  title: string;
  body: string;
  thoughtDate: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  sourceReviewId: string;
  sourceReviewTitle: string | null;
  sessions: ObservationSessionLink[];
  shift: {
    before: string;
    after: string;
    interpretation: string;
  } | null;
  connection: {
    text: string;
    relationType: ReviewRelationType | null;
    relationLabel: string | null;
  } | null;
  tension: {
    text: string;
    sideA: string | null;
    sideB: string | null;
  } | null;
};

const KIND_LABEL: Record<ReviewObservationKind, string> = {
  shift: "変化",
  connection: "接続",
  tension: "緊張関係",
};

const SPOTLIGHT_LABEL: Record<ReviewObservationKind, string> = {
  shift: "考え方が変わっています",
  connection: "新しいつながりがあります",
  tension: "まだ揺れている問いがあります",
};

const RELATION_LABEL: Record<ReviewRelationType, string> = {
  repetition: "繰り返し",
  contrast: "対比",
  complement: "補完",
  progression: "進展",
};

export function observationKindLabel(kind: ReviewObservationKind) {
  return KIND_LABEL[kind];
}

export function observationSpotlightLabel(kind: ReviewObservationKind) {
  return SPOTLIGHT_LABEL[kind];
}

export function relationTypeLabel(value: string | undefined) {
  if (!value || !(value in RELATION_LABEL)) {
    return null;
  }
  return RELATION_LABEL[value as ReviewRelationType];
}

export function toObservationCardModel(
  observation: HomeObservation,
  extras?: {
    sessions?: ObservationSessionLink[];
    sourceReviewTitle?: string | null;
  },
): ObservationCardModel {
  return {
    id: observation.id,
    kind: observation.kind,
    kindLabel: observationKindLabel(observation.kind),
    spotlightLabel: observationSpotlightLabel(observation.kind),
    title: observation.title,
    body: observation.body,
    thoughtDate: thoughtDate(observation),
    firstSeenAt: observation.firstSeenAt,
    lastSeenAt: observation.lastSeenAt,
    sourceReviewId: observation.sourceReviewId,
    sourceReviewTitle: extras?.sourceReviewTitle ?? null,
    sessions: extras?.sessions ?? [],
    shift:
      observation.kind === "shift"
        ? {
            before: observation.payload.before,
            after: observation.payload.after,
            interpretation: observation.payload.interpretation,
          }
        : null,
    connection:
      observation.kind === "connection"
        ? {
            text: observation.payload.text,
            relationType: observation.payload.relationType ?? null,
            relationLabel: relationTypeLabel(observation.payload.relationType),
          }
        : null,
    tension:
      observation.kind === "tension"
        ? {
            text: observation.payload.text,
            sideA: observation.payload.sideA?.text ?? null,
            sideB: observation.payload.sideB?.text ?? null,
          }
        : null,
  };
}
