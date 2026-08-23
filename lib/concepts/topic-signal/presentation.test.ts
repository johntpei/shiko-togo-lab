import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  TOPIC_SIGNAL_VERSION,
  type TopicSignalSet,
} from "./signals";
import {
  TOPIC_SIGNAL_UI_COPY,
  buildTopicSignalPresentation,
} from "./presentation";

const USER =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const UUID = "9bbee31b-7590-40bc-8b59-f39790193937";

function emptySignals(): TopicSignalSet {
  return {
    version: TOPIC_SIGNAL_VERSION,
    asOf: null,
    recentlyObserved: [],
    crossSessionRecurrence: [],
  };
}

function bothGroups(): TopicSignalSet {
  return {
    version: TOPIC_SIGNAL_VERSION,
    asOf: "2026-08-02T18:00:00.000Z",
    recentlyObserved: [
      {
        type: "recently_observed",
        conceptId: "c-recent-a",
        canonicalLabel: "高性能AI",
        lastSeenAt: "2026-08-02",
        recent7d: {
          occurrenceCount: 1,
          distinctSessionCount: 1,
          activeDayCount: 1,
        },
        reasonCode: "recent_occurrence_present",
        reason: { recent7dOccurrenceCount: 1 },
      },
      {
        type: "recently_observed",
        conceptId: "c-recent-b",
        canonicalLabel: "寂しさ",
        lastSeenAt: "2026-08-02",
        recent7d: {
          occurrenceCount: 1,
          distinctSessionCount: 1,
          activeDayCount: 1,
        },
        reasonCode: "recent_occurrence_present",
        reason: { recent7dOccurrenceCount: 1 },
      },
    ],
    crossSessionRecurrence: [
      {
        type: "cross_session_recurrence",
        conceptId: UUID,
        canonicalLabel: "人間関係",
        totalOccurrenceCount: 2,
        distinctSessionCount: 2,
        activeDayCount: 2,
        firstSeenAt: "2026-07-15",
        lastSeenAt: "2026-07-16",
        reasonCode: "observed_in_multiple_sessions",
        reason: { totalOccurrenceCount: 2, distinctSessionCount: 2 },
      },
      {
        type: "cross_session_recurrence",
        conceptId: "c-rec-b",
        canonicalLabel: "両親",
        totalOccurrenceCount: 2,
        distinctSessionCount: 2,
        activeDayCount: 2,
        firstSeenAt: "2026-07-12T22:46:05.674Z",
        lastSeenAt: "2026-07-15",
        reasonCode: "observed_in_multiple_sessions",
        reason: { totalOccurrenceCount: 2, distinctSessionCount: 2 },
      },
    ],
  };
}

function panelSource() {
  return readFileSync(
    resolve(process.cwd(), "components/app/topic-signal-panel.tsx"),
    "utf8",
  );
}

function homeSource() {
  return readFileSync(
    resolve(process.cwd(), "components/app/observatory-home.tsx"),
    "utf8",
  );
}

test("A. both groups render labels and details", () => {
  const model = buildTopicSignalPresentation(bothGroups());
  assert.equal(model.overallEmpty, false);
  assert.deepEqual(
    model.recentlyObserved.map((item) => item.canonicalLabel),
    ["高性能AI", "寂しさ"],
  );
  assert.deepEqual(
    model.recurrence.map((item) => item.canonicalLabel),
    ["人間関係", "両親"],
  );
  assert.equal(model.recentlyObserved[0]?.detail, "2026/08/02 に観測");
  assert.equal(model.recurrence[0]?.detail, "2回・2つの会話");
  assert.match(TOPIC_SIGNAL_UI_COPY.recentlyObservedTitle, /直近7日/);
  assert.match(TOPIC_SIGNAL_UI_COPY.recurrenceTitle, /会話をまたいで/);
});

test("B. compact grouped structure, not independent Concept cards", () => {
  const source = panelSource();
  assert.match(source, /sm:grid-cols-2/);
  assert.match(source, /grid-cols-1/);
  assert.match(source, /function SignalGroup/);
  assert.match(source, /function SignalRow/);
  assert.match(source, /border-t border-line/);
  assert.doesNotMatch(source, /shadow-\[/);
  assert.doesNotMatch(source, /text-base font-black/);
  const home = homeSource();
  const spotlightAt = home.indexOf(
    "<ObservationCard observation={model.spotlight} featured />",
  );
  const panelAt = home.indexOf("<TopicSignalPanel");
  const shiftsAt = home.indexOf('title="最近の変化"');
  assert.ok(spotlightAt >= 0 && panelAt >= 0 && shiftsAt >= 0);
  assert.ok(spotlightAt < panelAt);
  assert.ok(panelAt < shiftsAt);
});

test("C. recently copy is asOf-window, not wall-clock", () => {
  const copy = `${TOPIC_SIGNAL_UI_COPY.recentlyObservedTitle}\n${TOPIC_SIGNAL_UI_COPY.recentlyObservedDescription}`;
  assert.match(copy, /観測データ内の直近7日/);
  assert.doesNotMatch(copy, /今日/);
  assert.doesNotMatch(copy, /今週/);
  assert.doesNotMatch(copy, /現在/);
});

test("D. increase disclaimer is not required in visible helper", () => {
  assert.doesNotMatch(
    TOPIC_SIGNAL_UI_COPY.recentlyObservedDescription,
    /増えていることを意味するものではありません/,
  );
});

test("E. no rising language", () => {
  const copy = [
    TOPIC_SIGNAL_UI_COPY.sectionTitle,
    TOPIC_SIGNAL_UI_COPY.recentlyObservedTitle,
    TOPIC_SIGNAL_UI_COPY.recentlyObservedDescription,
    TOPIC_SIGNAL_UI_COPY.recurrenceTitle,
    TOPIC_SIGNAL_UI_COPY.recurrenceDescription,
  ].join("\n");
  assert.doesNotMatch(copy, /増えている/);
  assert.doesNotMatch(copy, /上昇/);
  assert.doesNotMatch(copy, /急上昇/);
  const source = panelSource();
  assert.doesNotMatch(source, /↑/);
  assert.doesNotMatch(source, /text-green/);
  assert.doesNotMatch(source, /"rising"/);
});

test("F. recurrence copy is multiple conversations only", () => {
  const copy = `${TOPIC_SIGNAL_UI_COPY.recurrenceTitle}\n${TOPIC_SIGNAL_UI_COPY.recurrenceDescription}`;
  assert.match(copy, /複数の会話/);
  assert.doesNotMatch(copy, /重要/);
  assert.doesNotMatch(copy, /関心/);
  assert.doesNotMatch(copy, /根深い/);
  assert.doesNotMatch(copy, /悩んでいる/);
});

test("G. asOf remains visible in the section header row", () => {
  const model = buildTopicSignalPresentation(bothGroups());
  assert.equal(model.asOfLabel, "観測データ: 2026/08/02 まで");
  const source = panelSource();
  assert.match(source, /asOfLabel/);
  assert.match(source, /flex-wrap/);
  assert.match(source, /justify-between/);
});

test("H. overlap: same Concept appears in both groups", () => {
  const signals = bothGroups();
  signals.recentlyObserved = [
    {
      type: "recently_observed",
      conceptId: UUID,
      canonicalLabel: "人間関係",
      lastSeenAt: "2026-08-02",
      recent7d: {
        occurrenceCount: 1,
        distinctSessionCount: 1,
        activeDayCount: 1,
      },
      reasonCode: "recent_occurrence_present",
      reason: { recent7dOccurrenceCount: 1 },
    },
  ];
  signals.crossSessionRecurrence = [
    {
      type: "cross_session_recurrence",
      conceptId: UUID,
      canonicalLabel: "人間関係",
      totalOccurrenceCount: 2,
      distinctSessionCount: 2,
      activeDayCount: 2,
      firstSeenAt: "2026-07-15",
      lastSeenAt: "2026-08-02",
      reasonCode: "observed_in_multiple_sessions",
      reason: { totalOccurrenceCount: 2, distinctSessionCount: 2 },
    },
  ];
  const model = buildTopicSignalPresentation(signals);
  assert.equal(model.recentlyObserved[0]?.canonicalLabel, "人間関係");
  assert.equal(model.recurrence[0]?.canonicalLabel, "人間関係");
});

test("I. empty recent keeps recurrence visible", () => {
  const signals = bothGroups();
  signals.recentlyObserved = [];
  const model = buildTopicSignalPresentation(signals);
  assert.equal(model.recentlyObserved.length, 0);
  assert.equal(model.recurrence.length, 2);
  assert.equal(model.overallEmpty, false);
  assert.match(TOPIC_SIGNAL_UI_COPY.recentlyObservedEmpty, /この期間/);
});

test("J. empty recurrence keeps recent visible", () => {
  const signals = bothGroups();
  signals.crossSessionRecurrence = [];
  const model = buildTopicSignalPresentation(signals);
  assert.equal(model.recentlyObserved.length, 2);
  assert.equal(model.recurrence.length, 0);
  assert.equal(model.overallEmpty, false);
  assert.match(TOPIC_SIGNAL_UI_COPY.recurrenceEmpty, /まだありません/);
});

test("K. both empty is a normal empty state without two group cards", () => {
  const model = buildTopicSignalPresentation(emptySignals());
  assert.equal(model.overallEmpty, true);
  assert.equal(model.recentlyObserved.length, 0);
  assert.equal(model.recurrence.length, 0);
  assert.equal(model.asOfLabel, null);
  assert.match(TOPIC_SIGNAL_UI_COPY.overallEmpty, /会話が蓄積されると/);
  const source = panelSource();
  assert.match(source, /overallEmpty \?/);
  assert.doesNotMatch(TOPIC_SIGNAL_UI_COPY.overallEmpty, /失敗/);
  assert.doesNotMatch(TOPIC_SIGNAL_UI_COPY.overallEmpty, /データ不足/);
});

test("L. raw Concept ID / normalizedKey are not in visible fields", () => {
  const model = buildTopicSignalPresentation(bothGroups());
  const visible = JSON.stringify(model);
  assert.equal(visible.includes(UUID), false);
  assert.equal(visible.includes("normalizedKey"), false);
  assert.equal("conceptId" in model.recentlyObserved[0]!, false);
});

test("M. USER本文なし", () => {
  const signals = bothGroups();
  signals.recentlyObserved[0] = {
    ...signals.recentlyObserved[0]!,
    canonicalLabel: "高性能AI",
  };
  const serialized = JSON.stringify(buildTopicSignalPresentation(signals));
  assert.equal(serialized.includes(USER), false);
  assert.equal(serialized.includes("surfaceForm"), false);
});

test("N. panel markup is wrap-safe, semantic, and does not classify", () => {
  const source = panelSource();
  assert.match(source, /<h2/);
  assert.match(source, /<h3/);
  assert.match(source, /min-w-0/);
  assert.match(source, /break-words/);
  assert.match(source, /overflow-hidden/);
  assert.doesNotMatch(source, /"use client"/);
  assert.doesNotMatch(source, /occurrenceCount\s*>=/);
  assert.doesNotMatch(source, /loadTopicSignals/);
  assert.doesNotMatch(source, /from "\.\/diagnostic"/);
  assert.doesNotMatch(source, /topic-signal-diagnostic/);
  assert.match(source, /TopicSignalPresentationModel/);
  const page = readFileSync(
    resolve(process.cwd(), "app/(app)/page.tsx"),
    "utf8",
  );
  assert.match(page, /loadTopicSignals/);
  assert.doesNotMatch(page, /catch/);
});
