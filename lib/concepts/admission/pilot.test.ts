import assert from "node:assert/strict";
import test from "node:test";
import type { StructuredGenerateRequest } from "@/lib/ai/provider";
import {
  CONCEPT_ADMISSION_PILOT_APPLY_ERROR,
  CONCEPT_ADMISSION_PILOT_DEFAULT_INPUT,
  parseConceptAdmissionPilotArgs,
  runConceptAdmissionPilot,
} from "./pilot";
import { snapshotFromConceptPilotReport } from "./loader";
import {
  reconstructAdmissionUnitTexts,
  withResolvedAdmissionEvidence,
} from "./evidence";
import { buildAdmissionCandidates } from "./candidates";
import type { AdmissionEvidenceSession } from "./evidence";

const SESSION_A = "080a113a-b0b3-4c50-9160-8415203e4a48";
const SESSION_B = "32935f2d-cac9-4c9e-85f3-c9969717ece2";
const SESSION_C = "a6560a0e-3e32-4681-bd59-ca8ff39f0d2b";
const SESSION_D = "c7d43746-2a7c-4d0f-a7ce-8646bb0aebf3";

const USER_A = "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const USER_B = "人間関係を最小限にする道を選びました。高性能についても触れない。";
const USER_C = "高性能だけを褒められても困る。統合支援ツールが欲しい。";
const USER_D = "高性能AIだけで完結させたい。";
const ASSISTANT = "了解しました。人間関係と高性能AIの両方を整理します。";

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
  [SESSION_A, session(SESSION_A, "2026-07-15", USER_A)],
  [SESSION_B, session(SESSION_B, "2026-07-16", USER_B)],
  [SESSION_C, session(SESSION_C, "2026-07-18", USER_C)],
  [SESSION_D, session(SESSION_D, "2026-08-02", USER_D)],
]);

function v4LikeReport() {
  return {
    metadata: {
      generatedAt: "2026-08-21T10:21:19.667Z",
      model: "gpt-4o-mini-2024-07-18",
      promptVersion: "concept-extract-prompt-v4",
      extractionVersion: "concept-extraction-v1",
      selectedSessionIds: [SESSION_A, SESSION_B, SESSION_C, SESSION_D],
      outputPath: "data/concept-pilot-2b-v4.json",
    },
    concepts: [
      {
        ref: "C20",
        canonicalLabel: "人間関係",
        normalizedKey: "人間関係",
        aliases: [],
        occurrenceCount: 2,
        distinctSessionCount: 2,
      },
      {
        ref: "C31",
        canonicalLabel: "高性能",
        normalizedKey: "高性能",
        aliases: [],
        occurrenceCount: 1,
        distinctSessionCount: 1,
      },
      {
        ref: "C42",
        canonicalLabel: "高性能AI",
        normalizedKey: "高性能AI",
        aliases: [],
        occurrenceCount: 1,
        distinctSessionCount: 1,
      },
    ],
    actions: [
      {
        sessionId: SESSION_A,
        evidenceRef: "M001:E01",
        surfaceForm: "人間関係",
        originalAction: "new",
        resolvedAs: "new",
        matchKind: null,
        conceptRef: "C20",
        canonicalLabel: "人間関係",
        aliases: [],
        candidateConceptRef: null,
        existingCanonicalLabel: null,
        rejectReason: null,
      },
      {
        sessionId: SESSION_B,
        evidenceRef: "M001:E01",
        surfaceForm: "人間関係",
        originalAction: "match",
        resolvedAs: "match",
        matchKind: "exact",
        conceptRef: "C20",
        canonicalLabel: "人間関係",
        aliases: [],
        candidateConceptRef: null,
        existingCanonicalLabel: null,
        rejectReason: null,
      },
      {
        sessionId: SESSION_C,
        evidenceRef: "M001:E01",
        surfaceForm: "高性能",
        originalAction: "new",
        resolvedAs: "new",
        matchKind: null,
        conceptRef: "C31",
        canonicalLabel: "高性能",
        aliases: [],
        candidateConceptRef: null,
        existingCanonicalLabel: null,
        rejectReason: null,
      },
      {
        sessionId: SESSION_D,
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        originalAction: "new",
        resolvedAs: "new",
        matchKind: "semantic",
        conceptRef: "C42",
        canonicalLabel: "高性能AI",
        aliases: [],
        candidateConceptRef: null,
        existingCanonicalLabel: null,
        rejectReason: null,
      },
    ],
    suspicious: [{ kind: "generic_surface", conceptRef: "C31" }],
    provisionalMatches: [
      {
        sessionId: SESSION_D,
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        candidateConceptRef: "C31",
        existingCanonicalLabel: "高性能",
      },
    ],
  };
}

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

test("CLI 既定 input / custom input / --apply early reject", () => {
  assert.deepEqual(parseConceptAdmissionPilotArgs([]), {
    apply: false,
    inputPath: CONCEPT_ADMISSION_PILOT_DEFAULT_INPUT,
    outputPath: "data/concept-admission-pilot-v1.json",
  });
  assert.deepEqual(
    parseConceptAdmissionPilotArgs([
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
  assert.equal(parseConceptAdmissionPilotArgs(["--apply"]).apply, true);
});

test("Pilot report 形式を Candidate builder へ渡せる", () => {
  const loaded = snapshotFromConceptPilotReport(v4LikeReport());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }
  assert.equal(loaded.loaded.extractPromptVersion, "concept-extract-prompt-v4");
  assert.equal(loaded.loaded.extractionVersion, "concept-extraction-v1");
  const built = buildAdmissionCandidates({
    snapshot: loaded.loaded.snapshot,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  assert.equal(built.candidates.length, 3);
  const relation = built.candidates.find((item) => item.candidateRef === "C20");
  assert.equal(relation?.occurrenceCount, 2);
  assert.equal(relation?.distinctSessionCount, 2);
});

test("USER Unit を sessionId/evidenceRef で復元し Assistant を使わない", () => {
  const loaded = snapshotFromConceptPilotReport(v4LikeReport());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }
  const reconstructed = reconstructAdmissionUnitTexts([...SESSIONS.values()]);
  const built = buildAdmissionCandidates({
    snapshot: loaded.loaded.snapshot,
    sessionOccurredAt: reconstructed.sessionOccurredAt,
    unitTexts: reconstructed.unitTexts,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const resolved = withResolvedAdmissionEvidence(
    built.candidates,
    reconstructed.unitTexts,
  );
  assert.equal(resolved.integrity.evidenceUnresolvedCandidates, 0);
  const relation = resolved.candidates.find((item) => item.candidateRef === "C20");
  assert.equal(relation?.representativeEvidence.length, 2);
  assert.equal(relation?.representativeEvidence[0]?.sessionId, SESSION_A);
  assert.equal(relation?.representativeEvidence[1]?.sessionId, SESSION_B);
  assert.match(relation?.representativeEvidence[0]?.shortText ?? "", /人間関係/);
  assert.doesNotMatch(
    relation?.representativeEvidence.map((item) => item.shortText).join(""),
    /了解しました/,
  );
  const specific = resolved.candidates.find((item) => item.candidateRef === "C42");
  const generic = resolved.candidates.find((item) => item.candidateRef === "C31");
  assert.equal(specific?.canonicalLabel, "高性能AI");
  assert.equal(generic?.canonicalLabel, "高性能");
  assert.equal(specific?.candidateRef !== generic?.candidateRef, true);
});

test("unresolved Evidence がある場合 LLM を呼ばず fail する", async () => {
  await withAdmissionEnv(async () => {
    let calls = 0;
    const result = await runConceptAdmissionPilot(
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
    assert.ok(result.report);
    assert.equal(result.report?.evidenceIntegrity.evidenceUnresolvedCandidates, 3);
    assert.equal(result.report?.usage.llmCallsActual, 0);
  });
});

test("--apply は LLM / DB load より前に reject する", async () => {
  let read = 0;
  let load = 0;
  let calls = 0;
  const result = await runConceptAdmissionPilot(["--apply"], {
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
  assert.equal(result.error, CONCEPT_ADMISSION_PILOT_APPLY_ERROR);
  assert.equal(read, 0);
  assert.equal(load, 0);
  assert.equal(calls, 0);
});

test("dry-run は report を書き、USER 全文と shortText を保存しない", async () => {
  await withAdmissionEnv(async () => {
    let written: unknown;
    const result = await runConceptAdmissionPilot(
      ["--input", "data/concept-pilot-2b-v4.json", "--output", "data/out.json"],
      {
        generateStructured: async (request: StructuredGenerateRequest) => {
          assert.match(request.user, /人間関係/);
          assert.doesNotMatch(request.user, /了解しました/);
          return {
            parsed: {
              decisions: [
                {
                  candidateRef: "C20",
                  decision: "admit",
                  reasonCode: "longitudinal_value",
                },
                {
                  candidateRef: "C31",
                  decision: "reject",
                  reasonCode: "generic",
                },
                {
                  candidateRef: "C42",
                  decision: "admit",
                  reasonCode: "specific_named_concept",
                },
              ],
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
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.report.metadata.extractPromptVersion, "concept-extract-prompt-v4");
    assert.equal(result.report.metadata.admissionPromptVersion, "concept-admission-prompt-v1");
    assert.equal(result.report.metadata.admissionVersion, "concept-admission-v1");
    assert.equal(result.report.evidenceIntegrity.evidenceResolvedCandidates, 3);
    assert.equal(result.report.usage.llmCallsActual, 1);
    assert.equal(result.report.usage.totalTokens, 11);
    assert.equal(result.report.totals.admitted, 2);
    const relation = result.report.decisions.find((item) => item.candidateRef === "C20");
    assert.equal(relation?.occurrenceCount, 2);
    assert.equal(relation?.distinctSessionCount, 2);
    assert.equal(relation && "shortText" in relation, false);
    assert.equal(relation && "representativeEvidence" in relation, false);
    const serialized = JSON.stringify(written);
    assert.doesNotMatch(serialized, /これまでの人間関係でなぜ上手くいかないのか理解できないと思った/);
    assert.doesNotMatch(serialized, /了解しました/);
    assert.equal(result.report.invariants.canonicalChanged, 0);
    assert.equal(result.report.invariants.mergedCandidates, 0);
    assert.equal(result.report.invariants.occurrenceChanged, 0);
  });
});
