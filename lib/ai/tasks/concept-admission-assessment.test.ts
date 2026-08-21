import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { StructuredGenerateRequest } from "@/lib/ai/provider";
import { runConceptAssessment } from "./concept-admission-assessment";
import type { ConceptAssessmentOutput } from "../concept-admission-assessment-schema";
import type { AdmissionCandidate } from "@/lib/concepts/admission/types";
import { unitTextKey } from "@/lib/concepts/admission/candidates";

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function withAssessmentEnv(run: () => Promise<void>) {
  const prev = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.AI_MODEL,
    provider: process.env.AI_PROVIDER,
  };
  process.env.OPENAI_API_KEY = "sk-test-not-used";
  process.env.AI_MODEL = "test-model";
  process.env.AI_PROVIDER = "openai";
  try {
    await run();
  } finally {
    restore("OPENAI_API_KEY", prev.key);
    restore("AI_MODEL", prev.model);
    restore("AI_PROVIDER", prev.provider);
  }
}

const LONG_USER = `睡眠の質を改善したいかどうかを自分で判断したい${"あ".repeat(80)}`;

function candidate(ref: string, label: string): AdmissionCandidate {
  return {
    candidateRef: ref,
    canonicalLabel: label,
    normalizedKey: label,
    occurrenceCount: 5,
    distinctSessionCount: 3,
    firstSeenAt: "2099-01-01",
    lastSeenAt: "2099-12-31",
    sessionIds: ["session-secret-id"],
    evidenceRefs: ["M001:E01"],
    suspiciousFlags: ["clause_like"],
    matchKindsSeen: ["exact"],
    representativeEvidence: [
      {
        sessionId: "session-secret-id",
        evidenceRef: "M001:E01",
        occurredAt: "2099-01-01",
        shortText: label.slice(0, 4),
      },
    ],
    provisionalHints: [
      {
        otherCandidateRef: "CX",
        otherCanonicalLabel: "merge-me",
        surfaceForm: label,
        evidenceRef: "M001:E01",
      },
    ],
  };
}

function unitTextsFor() {
  return {
    [unitTextKey("session-secret-id", "M001:E01")]: LONG_USER,
  };
}

function cover(
  refs: string[],
): ConceptAssessmentOutput {
  return {
    assessments: refs.map((candidateRef) => ({
      candidateRef,
      conceptForm: "stable_topic" as const,
      evidenceRole: "central" as const,
      longitudinalPotential: "high" as const,
    })),
  };
}

test("task は applyAdmissionPolicy を呼ばない", () => {
  const source = readFileSync(
    new URL("./concept-admission-assessment.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /applyAdmissionPolicy/);
  assert.doesNotMatch(source, /evaluatePolicyCalibration/);
});

test("mini-batch は coverage を満たし frequency を LLM に渡さない", async () => {
  await withAssessmentEnv(async () => {
    const refs = Array.from({ length: 13 }, (_, index) =>
      `R${String(index + 1).padStart(2, "0")}`,
    );
    const candidates = refs.map((ref) => candidate(ref, `label-${ref}`));
    let calls = 0;
    const result = await runConceptAssessment(
      { candidates, unitTexts: unitTextsFor() },
      {
        generateStructured: async (request: StructuredGenerateRequest) => {
          calls += 1;
          assert.ok(request.user.includes(LONG_USER));
          assert.doesNotMatch(request.user, /occurrenceCount/);
          assert.doesNotMatch(request.user, /distinctSessionCount/);
          assert.doesNotMatch(request.user, /session-secret-id/);
          assert.doesNotMatch(request.user, /clause_like/);
          assert.doesNotMatch(request.user, /merge-me/);
          assert.doesNotMatch(request.user, /了解しました/);
          assert.doesNotMatch(request.system, /admit \/ defer \/ reject を1件返す/);
          const required = [...request.user.matchAll(/^- (R\d{2})$/gm)].map(
            (match) => match[1]!,
          );
          return {
            parsed: cover(required),
            model: "test-model",
            usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
          };
        },
      },
    );
    assert.equal(result.ok, true, result.ok ? undefined : `${result.code}: ${result.error}`);
    if (!result.ok) {
      return;
    }
    assert.equal(result.promptVersion, "concept-admission-assessment-prompt-v2");
    assert.equal(result.assessmentVersion, "concept-admission-assessment-v2");
    assert.equal(result.usage.totalBatches, 2);
    assert.equal(result.usage.successfulBatches, 2);
    assert.equal(result.usage.failedBatches, 0);
    assert.equal(calls, 2);
    assert.equal(result.usage.llmCallsActual, 2);
    assert.equal(result.usage.retryCalls, 0);
    assert.equal(result.usage.totalTokens, 28);
    assert.equal(result.assessments.length, 13);
    assert.equal(result.assessments[0]?.candidateRef, refs[0]);
    assert.equal(candidates[0]?.occurrenceCount, 5);
  });
});

test("coverage duplicate は 1 回 repair し、成功すれば採用する", async () => {
  await withAssessmentEnv(async () => {
    const candidates = [
      candidate("R01", "睡眠の質"),
      candidate("R02", "生活習慣"),
    ];
    let calls = 0;
    const result = await runConceptAssessment(
      {
        candidates,
        unitTexts: {
          [unitTextKey("session-secret-id", "M001:E01")]: LONG_USER,
        },
      },
      {
        generateStructured: async () => {
          calls += 1;
          if (calls === 1) {
            return {
              parsed: cover(["R01", "R01"]),
              model: "test-model",
              usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
            };
          }
          return {
            parsed: cover(["R01", "R02"]),
            model: "test-model",
            usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
          };
        },
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(calls, 2);
    assert.equal(result.usage.retryCalls, 1);
    assert.equal(result.usage.repairedBatches, 1);
    assert.equal(result.usage.totalTokens, 11);
    assert.equal(result.batches[0]?.repaired, true);
  });
});

test("repair 後も coverage 失敗なら全 run failed で usage は加算する", async () => {
  await withAssessmentEnv(async () => {
    const candidates = [
      candidate("R01", "睡眠の質"),
      candidate("R02", "生活習慣"),
    ];
    const result = await runConceptAssessment(
      {
        candidates,
        unitTexts: {
          [unitTextKey("session-secret-id", "M001:E01")]: LONG_USER,
        },
      },
      {
        generateStructured: async () => ({
          parsed: cover(["C99"]),
          model: "test-model",
          usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        }),
      },
    );
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.code, "coverage");
    assert.equal(result.coverageFailed, true);
    assert.equal(result.apiCalls, 2);
    assert.equal(result.retryCalls, 1);
    assert.equal(result.usage?.totalTokens, 6);
    assert.equal(result.usage?.failedBatches, 1);
  });
});

test("2つ目の batch が失敗したら partial を成功扱いにしない", async () => {
  await withAssessmentEnv(async () => {
    const refs = Array.from({ length: 13 }, (_, index) =>
      `R${String(index + 1).padStart(2, "0")}`,
    );
    const candidates = refs.map((ref) => candidate(ref, `label-${ref}`));
    let calls = 0;
    const result = await runConceptAssessment(
      { candidates, unitTexts: unitTextsFor() },
      {
        generateStructured: async (request: StructuredGenerateRequest) => {
          calls += 1;
          const required = [...request.user.matchAll(/^- (R\d{2})$/gm)].map(
            (match) => match[1]!,
          );
          if (calls === 1) {
            return {
              parsed: cover(required),
              model: "test-model",
              usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
            };
          }
          return {
            parsed: cover(["C99"]),
            model: "test-model",
            usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
          };
        },
      },
    );
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.code, "coverage");
    assert.ok((result.apiCalls ?? 0) >= 2);
    assert.equal("assessments" in result, false);
  });
});

test("不正 schema は retry せず拒否する", async () => {
  await withAssessmentEnv(async () => {
    let calls = 0;
    const result = await runConceptAssessment(
      {
        candidates: [candidate("R01", "睡眠の質")],
        unitTexts: {
          [unitTextKey("session-secret-id", "M001:E01")]: LONG_USER,
        },
      },
      {
        generateStructured: async () => {
          calls += 1;
          return {
            parsed: { decisions: [] },
            model: "test-model",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        },
      },
    );
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.code, "schema");
    assert.equal(calls, 1);
    assert.equal(result.retryCalls, 0);
  });
});
