import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { StructuredGenerateRequest } from "@/lib/ai/provider";
import type { ConceptExtractOutput } from "@/lib/ai/concept-extract-schema";
import {
  CONCEPT_PILOT_APPLY_ERROR,
  parseConceptPilotArgs,
  runConceptPilot,
  sortPilotSessions,
  type ConceptPilotSessionRecord,
} from "./pilot";
import { prepareUserEvidenceUnits } from "./user-units";

const LONG_USER =
  "高性能AIについて詳しく話したいと思っています。距離感の話も続けます。";

function session(
  id: string,
  occurredAt: string,
): ConceptPilotSessionRecord {
  return {
    sessionId: id,
    occurredAt,
    messages: [{ id: `${id}-u`, role: "user", content: LONG_USER }],
  };
}

function coverSession(
  record: ConceptPilotSessionRecord,
  patches: Record<string, ConceptExtractOutput["units"][number]>,
): ConceptExtractOutput {
  const units = prepareUserEvidenceUnits(record);
  return {
    units: units.map((unit) => {
      const patch = patches[unit.evidenceRef];
      if (patch) {
        return patch;
      }
      return {
        evidenceRef: unit.evidenceRef,
        disposition: "skip" as const,
        concepts: [],
      };
    }),
  };
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function withExtractEnv(run: () => Promise<void>) {
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

test("CLI 指定順が違っても occurredAt それから id でソートする", () => {
  const ordered = sortPilotSessions([
    session("b", "2026-08-03"),
    session("a", "2026-08-01"),
    session("c", "2026-08-01"),
  ]);
  assert.deepEqual(
    ordered.map((item) => item.sessionId),
    ["a", "c", "b"],
  );
});

test("Session 0件ならエラー、--apply は明示拒否する", async () => {
  assert.deepEqual(parseConceptPilotArgs(["--session", "abc"]).sessionIds, [
    "abc",
  ]);
  const empty = await runConceptPilot([], {
    generateStructured: async () => ({ parsed: { items: [] }, model: "x" }),
    loadSession: () => null,
    writeReport: () => {
      throw new Error("should not write");
    },
  });
  assert.equal(empty.ok, false);
  if (!empty.ok) {
    assert.equal(empty.code, "no_sessions");
  }

  const apply = await runConceptPilot(["--apply", "--session", "abc"], {
    generateStructured: async () => ({ parsed: { items: [] }, model: "x" }),
    loadSession: () => {
      throw new Error("should not load");
    },
    writeReport: () => {
      throw new Error("should not write");
    },
  });
  assert.equal(apply.ok, false);
  if (!apply.ok) {
    assert.equal(apply.error, CONCEPT_PILOT_APPLY_ERROR);
  }
});

test("Session A の NEW が Session B の catalog に存在する", async () => {
  await withExtractEnv(async () => {
    const sessions = new Map([
      ["session-a", session("session-a", "2026-08-01")],
      ["session-b", session("session-b", "2026-08-02")],
    ]);
    const prompts: string[] = [];
    const result = await runConceptPilot(
      ["--session", "session-b", "--session", "session-a"],
      {
        generateStructured: async (request: StructuredGenerateRequest) => {
          prompts.push(request.user);
          if (prompts.length === 1) {
            return {
              parsed: coverSession(sessions.get("session-a")!, {
                "M001:E01": {
                  evidenceRef: "M001:E01",
                  disposition: "extracted",
                  concepts: [
                    {
                      action: "new",
                      surfaceForm: "高性能AI",
                    },
                  ],
                },
              }),
              model: "test-model",
            };
          }
          return {
            parsed: coverSession(sessions.get("session-b")!, {
              "M001:E01": {
                evidenceRef: "M001:E01",
                disposition: "extracted",
                concepts: [
                  {
                    action: "match",
                    surfaceForm: "高性能AI",
                    existingConceptRef: "C01",
                  },
                ],
              },
            }),
            model: "test-model",
          };
        },
        loadSession: (id) => sessions.get(id) ?? null,
        now: () => "2026-08-21T00:00:00.000Z",
        writeReport: () => undefined,
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.match(prompts[1] ?? "", /C01 \| 高性能AI/);
    assert.equal(result.report.concepts[0]?.canonicalLabel, "高性能AI");
    assert.equal(result.report.concepts[0]?.distinctSessionCount, 2);
    assert.equal(result.report.totals.new, 1);
    assert.equal(result.report.totals.match, 1);
    assert.equal(result.report.metadata.selectedSessionIds[0], "session-b");
    assert.equal(result.report.metadata.promptVersion, "concept-extract-prompt-v4");
    assert.equal(result.report.metadata.extractionVersion, "concept-extraction-v1");
  });
});

test("1 Session 失敗でも次を処理し、Unit 全文は JSON に入れない", async () => {
  await withExtractEnv(async () => {
    const sessions = new Map([
      ["session-a", session("session-a", "2026-08-01")],
      ["session-b", session("session-b", "2026-08-02")],
      ["session-c", session("session-c", "2026-08-03")],
    ]);
    let calls = 0;
    const result = await runConceptPilot(
      ["--session", "session-a", "--session", "session-b", "--session", "session-c"],
      {
        generateStructured: async () => {
          calls += 1;
          if (calls === 2) {
            throw new Error("boom");
          }
          return {
            parsed: coverSession(sessions.get("session-a")!, {
              "M001:E01": {
                evidenceRef: "M001:E01",
                disposition: "extracted",
                concepts: [
                  {
                    action: "new",
                    surfaceForm: "高性能AI",
                  },
                ],
              },
            }),
            model: "test-model",
            usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
          };
        },
        loadSession: (id) => sessions.get(id) ?? null,
        now: () => "2026-08-21T00:00:00.000Z",
        writeReport: () => undefined,
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(calls, 3);
    assert.equal(result.report.failedSessions.length, 1);
    assert.equal(result.report.failedSessions[0]?.sessionId, "session-b");
    assert.equal(result.report.totals.apiCalls, 3);
    assert.equal(result.report.totals.llmCallsActual, 3);
    assert.equal(result.report.totals.retryCalls, 0);
    const json = JSON.stringify(result.report);
    assert.doesNotMatch(json, /高性能AIについて詳しく話したい/);
    assert.equal("units" in result.report, false);
    assert.equal("text" in (result.report.actions[0] ?? {}), false);
  });
});

test("dry-run 実装は Concept insert を呼ばない", () => {
  const pilot = readFileSync("lib/concepts/pilot.ts", "utf8");
  const script = readFileSync("scripts/concept-pilot.ts", "utf8");
  const task = readFileSync("lib/ai/tasks/concept-extract.ts", "utf8");
  for (const source of [pilot, script, task]) {
    assert.doesNotMatch(source, /insertConcept/);
    assert.doesNotMatch(source, /insertConceptAlias/);
    assert.doesNotMatch(source, /insertConceptOccurrence/);
  }
});
