import { toSessionRef } from "@/lib/ai/evidence-units";
import type {
  StoredReviewEvidence,
  StoredReviewItem,
  StoredReviewPayload,
} from "@/lib/ai/review-schemas";
import type { StoredAnalysisPayload } from "@/lib/ai/schemas";
import { MAX_PACK_USER_FACTS } from "@/lib/ai/limits";
import {
  currentProjectContext,
  type CurrentProjectContext,
} from "@/lib/app/current-context";
import { formatReviewItemIndex, reviewItemSourceRef } from "@/lib/reviews/item-source-ref";
import { isVisibleReviewItem } from "@/lib/reviews/visible-items";
import type { ContextCandidate } from "./schema";

export type ContextPackSessionSource = {
  id: string;
  title: string;
  occurredAt: string;
  analysis: StoredAnalysisPayload | null;
};

export type BuildContextCandidatesInput = {
  reviewId: string;
  reviewPayload: StoredReviewPayload;
  sessions: ContextPackSessionSource[];
  currentContext?: CurrentProjectContext;
};

const USER_FACT_HINTS = [
  "制約",
  "ツール",
  "使用中",
  "使っている",
  "使わない",
  "採用",
  "方針",
  "Cursor",
  "ChatGPT",
  "Claude",
  "MVP",
  "スコープ",
];

export { isVisibleReviewItem };

function hasValidatedUserEvidence(evidence: StoredReviewEvidence[] | undefined) {
  return (evidence ?? []).some(
    (item) => item.validated && item.role === "user",
  );
}

function hasInvalidEvidence(evidence: StoredReviewEvidence[] | undefined) {
  return (evidence ?? []).some(
    (item) =>
      !item.validated &&
      (item.reason === "invalid_evidence_ref" ||
        item.reason === "invalid_message_ref" ||
        item.reason === "quote_not_found"),
  );
}

function sessionIdsFromEvidence(evidence: StoredReviewEvidence[] | undefined) {
  return [
    ...new Set(
      (evidence ?? [])
        .map((item) => item.sessionId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

function packEvidence(
  evidence: Array<{
    messageId: string | null;
    sessionId?: string | null;
    sessionTitle?: string | null;
    occurredAt?: string | null;
    role?: string | null;
    quote?: string;
    validated?: boolean;
  }>,
) {
  return evidence.map((item) => ({
    sessionId: item.sessionId ?? null,
    messageId: item.messageId,
    sessionTitle: item.sessionTitle,
    occurredAt: item.occurredAt,
    role: item.role,
    quote: item.quote,
    validated: item.validated,
  }));
}

function sortSessions(sessions: ContextPackSessionSource[]) {
  return [...sessions].sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt),
  );
}

function looksLikeConstraintOrTool(text: string) {
  return USER_FACT_HINTS.some((hint) => text.includes(hint));
}

function reviewItemCandidate(
  item: StoredReviewItem,
  input: {
    ref: string;
    type: ContextCandidate["type"];
    supportType: ContextCandidate["supportType"];
    reviewId: string;
    extra?: Partial<ContextCandidate>;
  },
): ContextCandidate {
  return {
    ref: input.ref,
    type: input.type,
    text: item.text,
    supportType: input.supportType,
    sourceReviewId: input.reviewId,
    sourceSessionIds: sessionIdsFromEvidence(item.evidence),
    rationale: item.rationale,
    validationIdea: item.validationIdea,
    sideA: item.sideA?.text,
    sideB: item.sideB?.text,
    evidence: packEvidence([
      ...(item.evidence ?? []),
      ...(item.sideA?.evidence ?? []),
      ...(item.sideB?.evidence ?? []),
    ]),
    ...input.extra,
  };
}

export function buildContextCandidates(input: BuildContextCandidatesInput) {
  const context = input.currentContext ?? currentProjectContext;
  const candidates: ContextCandidate[] = [
    {
      ref: "C:PROJECT_NAME",
      type: "current_context",
      text: context.projectName,
      supportType: "confirmed",
    },
    {
      ref: "C:CORE_PURPOSE",
      type: "current_context",
      text: context.corePurpose,
      supportType: "confirmed",
    },
  ];

  const payload = input.reviewPayload;
  candidates.push({
    ref: "R:SUMMARY",
    type: "summary",
    text: payload.summary,
    supportType: "confirmed",
    sourceReviewId: input.reviewId,
  });

  payload.shifts.forEach((item, index) => {
    if (!isVisibleReviewItem(item)) {
      return;
    }
    candidates.push({
      ref: reviewItemSourceRef("shift", index),
      type: "shift",
      text: item.interpretation,
      supportType: "confirmed",
      sourceReviewId: input.reviewId,
      sourceSessionIds: sessionIdsFromEvidence(item.evidence),
      before: item.before,
      after: item.after,
      evidence: packEvidence([
        ...item.beforeEvidence,
        ...item.afterEvidence,
        ...item.evidence,
      ]),
    } satisfies ContextCandidate);
  });

  payload.commonThemes.forEach((item, index) => {
    if (!isVisibleReviewItem(item)) {
      return;
    }
    candidates.push(
      reviewItemCandidate(item, {
        ref: reviewItemSourceRef("theme", index),
        type: "theme",
        supportType: "cross_session_interpretation",
        reviewId: input.reviewId,
      }),
    );
  });

  payload.tensions.forEach((item, index) => {
    if (!isVisibleReviewItem(item)) {
      return;
    }
    candidates.push(
      reviewItemCandidate(item, {
        ref: reviewItemSourceRef("tension", index),
        type: "tension",
        supportType: "cross_session_interpretation",
        reviewId: input.reviewId,
      }),
    );
  });

  payload.crossInsights.forEach((item, index) => {
    if (!isVisibleReviewItem(item)) {
      return;
    }
    candidates.push(
      reviewItemCandidate(item, {
        ref: reviewItemSourceRef("insight", index),
        type: "insight",
        supportType: "cross_session_interpretation",
        reviewId: input.reviewId,
      }),
    );
  });

  payload.hypotheses.forEach((item, index) => {
    if (!isVisibleReviewItem(item)) {
      return;
    }
    candidates.push(
      reviewItemCandidate(item, {
        ref: reviewItemSourceRef("hypothesis", index),
        type: "hypothesis",
        supportType: "hypothesis",
        reviewId: input.reviewId,
      }),
    );
  });

  payload.openQuestions.forEach((item, index) => {
    if (!isVisibleReviewItem(item)) {
      return;
    }
    candidates.push(
      reviewItemCandidate(item, {
        ref: reviewItemSourceRef("open_question", index),
        type: "open_question",
        supportType: "open_question",
        reviewId: input.reviewId,
      }),
    );
  });

  payload.nextQuestions.forEach((item, index) => {
    if (!isVisibleReviewItem(item)) {
      return;
    }
    candidates.push(
      reviewItemCandidate(item, {
        ref: reviewItemSourceRef("next_question", index),
        type: "next_question",
        supportType: "open_question",
        reviewId: input.reviewId,
      }),
    );
  });

  const sessions = sortSessions(input.sessions);
  sessions.forEach((session, sessionIndex) => {
    const sessionRef = toSessionRef(sessionIndex);
    const analysis = session.analysis;
    if (!analysis) {
      return;
    }
    let decisionIndex = 0;
    let factIndex = 0;
    for (const item of analysis.items) {
      if (!isVisibleReviewItem(item) || item.unsupportedClaim) {
        continue;
      }
      if (hasInvalidEvidence(item.evidence)) {
        continue;
      }
      if (item.kind === "decision") {
        if (!hasValidatedUserEvidence(item.evidence)) {
          continue;
        }
        candidates.push({
          ref: `D:${sessionRef}:${formatReviewItemIndex(decisionIndex)}`,
          type: "decision",
          text: item.text,
          supportType: "confirmed",
          sourceReviewId: input.reviewId,
          sourceSessionIds: [session.id],
          occurredAt: session.occurredAt,
          sessionTitle: session.title,
          evidence: packEvidence(
            item.evidence.map((evidence) => ({
              ...evidence,
              sessionId: session.id,
              sessionTitle: session.title,
              occurredAt: session.occurredAt,
            })),
          ),
        });
        decisionIndex += 1;
        continue;
      }
      if (
        item.kind === "fact" &&
        (item.subject === "user" || !item.subject) &&
        hasValidatedUserEvidence(item.evidence) &&
        looksLikeConstraintOrTool(item.text) &&
        factIndex < MAX_PACK_USER_FACTS
      ) {
        candidates.push({
          ref: `F:${sessionRef}:${formatReviewItemIndex(factIndex)}`,
          type: "user_fact",
          text: item.text,
          supportType: "confirmed",
          sourceReviewId: input.reviewId,
          sourceSessionIds: [session.id],
          occurredAt: session.occurredAt,
          sessionTitle: session.title,
          evidence: packEvidence(
            item.evidence.map((evidence) => ({
              ...evidence,
              sessionId: session.id,
              sessionTitle: session.title,
              occurredAt: session.occurredAt,
            })),
          ),
        });
        factIndex += 1;
      }
    }
  });

  return candidates;
}

export function formatContextCandidatesForAi(candidates: ContextCandidate[]) {
  return candidates
    .map((candidate) => {
      const lines = [
        `[${candidate.ref}] type=${candidate.type} support=${candidate.supportType}`,
      ];
      if (candidate.occurredAt) {
        lines.push(`occurredAt=${candidate.occurredAt}`);
      }
      if (candidate.sessionTitle) {
        lines.push(`session=${candidate.sessionTitle}`);
      }
      lines.push(candidate.text);
      if (candidate.before) {
        lines.push(`before: ${candidate.before}`);
      }
      if (candidate.after) {
        lines.push(`after: ${candidate.after}`);
      }
      if (candidate.sideA) {
        lines.push(`sideA: ${candidate.sideA}`);
      }
      if (candidate.sideB) {
        lines.push(`sideB: ${candidate.sideB}`);
      }
      if (candidate.rationale) {
        lines.push(`rationale: ${candidate.rationale}`);
      }
      if (candidate.validationIdea) {
        lines.push(`validationIdea: ${candidate.validationIdea}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

export function candidateMap(candidates: ContextCandidate[]) {
  return new Map(candidates.map((candidate) => [candidate.ref, candidate]));
}

export function toStoredPackItem(candidate: ContextCandidate) {
  return {
    sourceRef: candidate.ref,
    type: candidate.type,
    text: candidate.text,
    supportType: candidate.supportType,
    occurredAt: candidate.occurredAt,
    sourceReviewId: candidate.sourceReviewId,
    sourceSessionIds: candidate.sourceSessionIds,
    rationale: candidate.rationale,
    validationIdea: candidate.validationIdea,
    before: candidate.before,
    after: candidate.after,
    sideA: candidate.sideA,
    sideB: candidate.sideB,
    evidence: candidate.evidence,
  };
}

export function buildContextPackTitle(occurredAts: string[], now = new Date()) {
  const dates = [...occurredAts].filter(Boolean).sort();
  const min = dates[0];
  const max = dates[dates.length - 1];
  const format = (iso: string) => iso.replaceAll("-", "/");
  if (min && max && min !== max) {
    return `Context Pack — ${format(min)}〜${format(max)}`;
  }
  if (min) {
    return `Context Pack — ${format(min)}`;
  }
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `Context Pack — ${year}/${month}/${day}`;
}
