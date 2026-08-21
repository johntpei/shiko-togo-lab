import assert from "node:assert/strict";
import test from "node:test";
import type { StructuredGenerateRequest } from "@/lib/ai/provider";
import { runConceptAdmission } from "./concept-admission";
import type { ConceptAdmissionOutput } from "../concept-admission-schema";
import type { AdmissionCandidate } from "@/lib/concepts/admission/types";

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function withAdmissionEnv(run: () => Promise<void>) {
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

function candidate(ref: string, label: string): AdmissionCandidate {
  return {
    candidateRef: ref,
    canonicalLabel: label,
    normalizedKey: label,
    occurrenceCount: 1,
    distinctSessionCount: 1,
    firstSeenAt: "2026-07-15",
    lastSeenAt: "2026-07-15",
    sessionIds: ["session-a"],
    evidenceRefs: ["M001:E01"],
    suspiciousFlags: [],
    matchKindsSeen: ["new"],
    representativeEvidence: [
      {
        sessionId: "session-a",
        evidenceRef: "M001:E01",
        occurredAt: "2026-07-15",
        shortText: label,
      },
    ],
    provisionalHints: [],
  };
}

const CANDIDATES = [
  candidate("C20", "人間関係"),
  candidate("C42", "高性能AI"),
];

function cover(output: ConceptAdmissionOutput["decisions"]): ConceptAdmissionOutput {
  return { decisions: output };
}

test("1 corpus batch は 1 API call で coverage を満たす", async () => {
  await withAdmissionEnv(async () => {
    let calls = 0;
    const result = await runConceptAdmission(
      { candidates: CANDIDATES },
      {
        generateStructured: async (request: StructuredGenerateRequest) => {
          calls += 1;
          assert.match(request.user, /C20/);
          assert.match(request.user, /C42/);
          assert.doesNotMatch(request.user, /provisionalHints/);
          return {
            parsed: cover([
              {
                candidateRef: "C20",
                decision: "admit",
                reasonCode: "longitudinal_value",
              },
              {
                candidateRef: "C42",
                decision: "admit",
                reasonCode: "specific_named_concept",
              },
            ]),
            model: "test-model",
            usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
          };
        },
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(calls, 1);
    assert.equal(result.apiCalls, 1);
    assert.equal(result.retryCalls, 0);
    assert.equal(result.repaired, false);
    assert.equal(result.promptVersion, "concept-admission-prompt-v1");
    assert.equal(result.admissionVersion, "concept-admission-v1");
    assert.equal(result.applied.report.totals.admitted, 2);
    assert.equal(result.usage?.totalTokens, 14);
  });
});

test("coverage duplicate は 1 回 repair し、成功すれば採用する", async () => {
  await withAdmissionEnv(async () => {
    let calls = 0;
    const result = await runConceptAdmission(
      { candidates: CANDIDATES },
      {
        generateStructured: async () => {
          calls += 1;
          if (calls === 1) {
            return {
              parsed: cover([
                {
                  candidateRef: "C20",
                  decision: "admit",
                  reasonCode: "stable_topic",
                },
                {
                  candidateRef: "C20",
                  decision: "admit",
                  reasonCode: "stable_topic",
                },
              ]),
              model: "test-model",
              usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
            };
          }
          return {
            parsed: cover([
              {
                candidateRef: "C20",
                decision: "admit",
                reasonCode: "stable_topic",
              },
              {
                candidateRef: "C42",
                decision: "reject",
                reasonCode: "generic",
              },
            ]),
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
    assert.equal(result.apiCalls, 2);
    assert.equal(result.retryCalls, 1);
    assert.equal(result.repaired, true);
    assert.equal(result.usage?.totalTokens, 11);
    assert.equal(result.applied.judged[0]?.canonicalLabel, "人間関係");
    assert.equal(result.applied.judged[0]?.occurrenceCount, 1);
  });
});

test("repair も coverage 失敗なら batch failed で usage は加算する", async () => {
  await withAdmissionEnv(async () => {
    const result = await runConceptAdmission(
      { candidates: CANDIDATES },
      {
        generateStructured: async () => ({
          parsed: cover([
            {
              candidateRef: "C99",
              decision: "reject",
              reasonCode: "generic",
            },
          ]),
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
  });
});

test("不正 schema は retry せず拒否する", async () => {
  await withAdmissionEnv(async () => {
    let calls = 0;
    const result = await runConceptAdmission(
      { candidates: CANDIDATES },
      {
        generateStructured: async () => {
          calls += 1;
          return {
            parsed: { items: [] },
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

test("Admission は Candidate を merge / rename しない", async () => {
  await withAdmissionEnv(async () => {
    const result = await runConceptAdmission(
      { candidates: CANDIDATES },
      {
        generateStructured: async () => ({
          parsed: cover([
            {
              candidateRef: "C20",
              decision: "admit",
              reasonCode: "stable_topic",
            },
            {
              candidateRef: "C42",
              decision: "admit",
              reasonCode: "specific_named_concept",
            },
          ]),
          model: "test-model",
        }),
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.applied.judged.length, 2);
    assert.equal(result.applied.judged[0]?.canonicalLabel, "人間関係");
    assert.equal(result.applied.judged[1]?.canonicalLabel, "高性能AI");
    assert.equal(CANDIDATES[0]?.canonicalLabel, "人間関係");
  });
});
