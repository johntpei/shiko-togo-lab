import assert from "node:assert/strict";
import test from "node:test";
import type { StructuredGenerateRequest } from "@/lib/ai/provider";
import {
  CONCEPT_ASSESSMENT_PILOT_APPLY_ERROR,
  CONCEPT_ASSESSMENT_PILOT_DEFAULT_INPUT,
  CONCEPT_ASSESSMENT_PILOT_DEFAULT_OUTPUT,
  parseConceptAssessmentPilotArgs,
  runConceptAssessmentPilot,
} from "./assessment-pilot";
import type { AdmissionEvidenceSession } from "./evidence";

const SESSION_A = "080a113a-b0b3-4c50-9160-8415203e4a48";
const SESSION_B = "32935f2d-cac9-4c9e-85f3-c9969717ece2";

const LONG_USER = `睡眠の質を改善したいかどうかを自分で判断したい${"あ".repeat(80)}`;
const ASSISTANT = "了解しました。睡眠の質を整理します。";

function session(
  id: string,
  occurredAt: string,
  user: string,
): AdmissionEvidenceSession {
  return {
    sessionId: id,
    occurredAt,
    messages: [
      { id: `${id}-u`, role: "user", content: user },
      { id: `${id}-a`, role: "assistant", content: ASSISTANT },
    ],
  };
}

const SESSIONS = new Map([
  [SESSION_A, session(SESSION_A, "2026-07-15", LONG_USER)],
  [SESSION_B, session(SESSION_B, "2026-07-16", "生活習慣を見直したい。")],
]);

function v4LikeReport() {
  return {
    metadata: {
      generatedAt: "2026-08-21T10:21:19.667Z",
      model: "gpt-4o-mini-2024-07-18",
      promptVersion: "concept-extract-prompt-v4",
      extractionVersion: "concept-extraction-v1",
      selectedSessionIds: [SESSION_A, SESSION_B],
      outputPath: "data/concept-pilot-2b-v4.json",
    },
    concepts: [
      {
        ref: "C80",
        canonicalLabel: "睡眠の質",
        normalizedKey: "睡眠の質",
        aliases: [],
        occurrenceCount: 1,
        distinctSessionCount: 1,
      },
      {
        ref: "C81",
        canonicalLabel: "生活習慣",
        normalizedKey: "生活習慣",
        aliases: [],
        occurrenceCount: 1,
        distinctSessionCount: 1,
      },
    ],
    actions: [
      {
        sessionId: SESSION_A,
        evidenceRef: "M001:E01",
        surfaceForm: "睡眠の質",
        originalAction: "new",
        resolvedAs: "new",
        matchKind: null,
        conceptRef: "C80",
        canonicalLabel: "睡眠の質",
        aliases: [],
        candidateConceptRef: null,
        existingCanonicalLabel: null,
        rejectReason: null,
      },
      {
        sessionId: SESSION_B,
        evidenceRef: "M001:E01",
        surfaceForm: "生活習慣",
        originalAction: "new",
        resolvedAs: "new",
        matchKind: "exact",
        conceptRef: "C81",
        canonicalLabel: "生活習慣",
        aliases: [],
        candidateConceptRef: null,
        existingCanonicalLabel: null,
        rejectReason: null,
      },
    ],
    suspicious: [{ kind: "generic_surface", conceptRef: "C81" }],
    provisionalMatches: [],
  };
}

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

test("CLI 既定 input / custom input / --apply early reject", () => {
  assert.deepEqual(parseConceptAssessmentPilotArgs([]), {
    apply: false,
    inputPath: CONCEPT_ASSESSMENT_PILOT_DEFAULT_INPUT,
    outputPath: CONCEPT_ASSESSMENT_PILOT_DEFAULT_OUTPUT,
  });
  assert.deepEqual(
    parseConceptAssessmentPilotArgs([
      "--input",
      "data/custom.json",
      "--output",
      "data/out.json",
    ]),
    {
      apply: false,
      inputPath: "data/custom.json",
      outputPath: "data/out.json",
    },
  );
  assert.equal(parseConceptAssessmentPilotArgs(["--apply"]).apply, true);
});

test("unresolved Evidence がある場合 LLM を呼ばず fail する", async () => {
  await withAssessmentEnv(async () => {
    let calls = 0;
    const result = await runConceptAssessmentPilot(
      ["--input", "memory.json", "--output", "memory-out.json"],
      {
        generateStructured: async () => {
          calls += 1;
          throw new Error("should not call LLM");
        },
        loadSession: () => null,
        readInputFile: () => JSON.stringify(v4LikeReport()),
        writeReport: () => undefined,
        now: () => "2026-08-21T00:00:00.000Z",
      },
    );
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.code, "evidence");
    assert.equal(calls, 0);
    assert.equal(result.report?.usage.llmCallsActual, 0);
    assert.equal(result.report?.assessments.length, 0);
  });
});

test("--apply は LLM / DB load より前に reject する", async () => {
  let read = 0;
  let load = 0;
  let calls = 0;
  const result = await runConceptAssessmentPilot(["--apply"], {
    generateStructured: async () => {
      calls += 1;
      throw new Error("no");
    },
    loadSession: () => {
      load += 1;
      return null;
    },
    readInputFile: () => {
      read += 1;
      return "{}";
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.code, "apply");
  assert.equal(result.error, CONCEPT_ASSESSMENT_PILOT_APPLY_ERROR);
  assert.equal(read, 0);
  assert.equal(load, 0);
  assert.equal(calls, 0);
});

test("dry-run は raw assessment だけ書き、USER 全文と decision を保存しない", async () => {
  await withAssessmentEnv(async () => {
    let written: unknown;
    const result = await runConceptAssessmentPilot(
      [
        "--input",
        "data/concept-pilot-2b-v4.json",
        "--output",
        "data/concept-admission-assessment-v2.json",
      ],
      {
        generateStructured: async (request: StructuredGenerateRequest) => {
          assert.ok(request.user.includes(LONG_USER));
          assert.doesNotMatch(request.user, /了解しました/);
          assert.doesNotMatch(request.user, /occurrenceCount/);
          const required = [...request.user.matchAll(/^- (C\d+)$/gm)].map(
            (match) => match[1]!,
          );
          return {
            parsed: {
              assessments: required.map((candidateRef) => ({
                candidateRef,
                conceptForm: "stable_topic",
                evidenceRole: "central",
                longitudinalPotential: "high",
              })),
            },
            model: "test-model",
            usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
          };
        },
        loadSession: (id) => SESSIONS.get(id) ?? null,
        readInputFile: () => JSON.stringify(v4LikeReport()),
        writeReport: (_path, report) => {
          written = report;
        },
        now: () => "2026-08-21T00:00:00.000Z",
      },
    );
    assert.equal(result.ok, true, result.ok ? undefined : `${result.code}: ${result.error}`);
    if (!result.ok) {
      return;
    }
    assert.equal(
      result.report.metadata.extractPromptVersion,
      "concept-extract-prompt-v4",
    );
    assert.equal(
      result.report.metadata.assessmentPromptVersion,
      "concept-admission-assessment-prompt-v2",
    );
    assert.equal(
      result.report.metadata.assessmentVersion,
      "concept-admission-assessment-v2",
    );
    assert.equal(result.report.metadata.batchStrategy.kind, "hash_balanced");
    assert.equal(result.report.assessments.length, 2);
    assert.equal(result.report.assessments[0]?.conceptForm, "stable_topic");
    assert.equal(
      result.report.assessments[0] && "decision" in result.report.assessments[0],
      false,
    );
    assert.ok(result.report.assessments[0]?.serverSignals);
    assert.equal(
      typeof result.report.assessments[0]?.serverSignals.distinctSessionCount,
      "number",
    );
    const serialized = JSON.stringify(written);
    assert.doesNotMatch(serialized, new RegExp(LONG_USER));
    assert.doesNotMatch(serialized, /了解しました/);
    assert.doesNotMatch(serialized, /"decision"/);
    assert.doesNotMatch(serialized, /"admit"/);
    assert.doesNotMatch(serialized, /classAAdmitRate/);
    assert.equal(result.report.invariants.canonicalChanged, 0);
    assert.equal(result.report.invariants.mergedCandidates, 0);
    assert.equal(result.report.invariants.occurrenceChanged, 0);
  });
});
