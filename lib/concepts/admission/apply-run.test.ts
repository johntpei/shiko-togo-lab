import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { applySqlMigrations } from "@/lib/db/client";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  insertConcept,
} from "@/lib/db/concept-queries";
import * as schema from "@/lib/db/schema";
import {
  CONCEPT_APPLY_DEFAULT_ASSESSMENT,
  CONCEPT_APPLY_DEFAULT_CANDIDATES,
  CONCEPT_APPLY_DEFAULT_MANIFEST,
  buildApplyManifest,
} from "./apply-manifest";
import {
  CONCEPT_APPLY_WRITE_REQUIRES_FLAG,
  parseConceptAdmissionApplyWriteArgs,
  runConceptAdmissionApplyWrite,
} from "./apply-run";
import type { AdmissionEvidenceSession } from "./evidence";
import type { ConceptAdmissionApplyResult } from "./apply-result";
import {
  applyInitialAdmissionManifest,
  type InitialApplyResult,
} from "./apply-transaction";

const SESSION_A = "080a113a-b0b3-4c50-9160-8415203e4a48";
const SESSION_B = "32935f2d-cac9-4c9e-85f3-c9969717ece2";
const USER_A =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const USER_B =
  "人間関係を最小限にする道を選びました。高性能AIについても触れます。";
const ASSISTANT = "了解しました。人間関係と高性能AIの両方を整理します。";

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

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

const EVIDENCE_SESSIONS = [
  session(SESSION_A, "2026-07-15", USER_A),
  session(SESSION_B, "2026-07-16", USER_B),
];

function v4LikeReport() {
  return {
    metadata: {
      generatedAt: "2026-08-21T10:21:19.667Z",
      model: "gpt-4o-mini-2024-07-18",
      promptVersion: "concept-extract-prompt-v4",
      extractionVersion: "concept-extraction-v1",
      selectedSessionIds: [SESSION_A, SESSION_B],
    },
    concepts: [
      {
        ref: "C20",
        canonicalLabel: "人間関係",
        normalizedKey: "人間関係",
        aliases: [],
      },
      {
        ref: "C42",
        canonicalLabel: "高性能AI",
        normalizedKey: "高性能ai",
        aliases: [],
      },
      {
        ref: "C31",
        canonicalLabel: "高性能",
        normalizedKey: "高性能",
        aliases: [],
      },
    ],
    actions: [
      {
        sessionId: SESSION_A,
        evidenceRef: "M001:E01",
        surfaceForm: "人間関係",
        resolvedAs: "new",
        matchKind: null,
        conceptRef: "C20",
      },
      {
        sessionId: SESSION_B,
        evidenceRef: "M001:E01",
        surfaceForm: "人間関係",
        resolvedAs: "match",
        matchKind: "exact",
        conceptRef: "C20",
      },
      {
        sessionId: SESSION_B,
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        resolvedAs: "new",
        matchKind: null,
        conceptRef: "C42",
      },
      {
        sessionId: SESSION_B,
        evidenceRef: "M001:E01",
        surfaceForm: "高性能",
        resolvedAs: "new",
        matchKind: null,
        conceptRef: "C31",
      },
    ],
    suspicious: [{ kind: "generic_surface", conceptRef: "C31" }],
    provisionalMatches: [],
  };
}

function assessmentReport() {
  return {
    metadata: {
      assessmentPromptVersion: "concept-admission-assessment-prompt-v2",
      assessmentVersion: "concept-admission-assessment-v2",
      model: "gpt-4o-2024-08-06",
    },
    assessments: [
      {
        candidateRef: "C20",
        canonicalLabel: "人間関係",
        conceptForm: "specific_named_concept",
        evidenceRole: "central",
        longitudinalPotential: "high",
        serverSignals: {
          occurrenceCount: 2,
          distinctSessionCount: 2,
          hasExactRecurrence: true,
          hasObservedAliasRecurrence: false,
          suspiciousFlags: [],
        },
      },
      {
        candidateRef: "C42",
        canonicalLabel: "高性能AI",
        conceptForm: "stable_topic",
        evidenceRole: "supporting",
        longitudinalPotential: "high",
        serverSignals: {
          occurrenceCount: 1,
          distinctSessionCount: 1,
          hasExactRecurrence: false,
          hasObservedAliasRecurrence: false,
          suspiciousFlags: [],
        },
      },
      {
        candidateRef: "C31",
        canonicalLabel: "高性能",
        conceptForm: "generic_head",
        evidenceRole: "incidental",
        longitudinalPotential: "low",
        serverSignals: {
          occurrenceCount: 1,
          distinctSessionCount: 1,
          hasExactRecurrence: false,
          hasObservedAliasRecurrence: false,
          suspiciousFlags: ["generic_surface"],
        },
      },
    ],
  };
}

function validatedManifest() {
  const candidateReport = v4LikeReport();
  const assessment = assessmentReport();
  const built = buildApplyManifest({
    sourceCandidateReportPath: CONCEPT_APPLY_DEFAULT_CANDIDATES,
    assessmentReportPath: CONCEPT_APPLY_DEFAULT_ASSESSMENT,
    candidateReportText: JSON.stringify(candidateReport),
    assessmentReportText: JSON.stringify(assessment),
    candidateReportRaw: candidateReport,
    assessmentReportRaw: assessment,
    sessions: EVIDENCE_SESSIONS,
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(built.ok, true, built.ok ? undefined : JSON.stringify(built.errors));
  if (!built.ok) {
    throw new Error("fixture manifest failed");
  }
  return built.manifest;
}

function seedSession(
  db: ReturnType<typeof openMemoryDb>,
  id: string,
  occurredAt: string,
) {
  db.insert(schema.sessions)
    .values({
      id,
      title: id,
      occurredAt,
      source: "chatgpt",
      category: "制作",
      rawContent: "x",
      status: "parsed",
      sourceConversationId: null,
      importSource: "manual",
      sourceStartAt: null,
      sourceEndAt: null,
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
}

function seedMessage(
  db: ReturnType<typeof openMemoryDb>,
  input: {
    id: string;
    sessionId: string;
    role?: string;
    content?: string;
    index?: number;
  },
) {
  const content = input.content ?? USER_A;
  db.insert(schema.messages)
    .values({
      id: input.id,
      sessionId: input.sessionId,
      index: input.index ?? 0,
      role: input.role ?? "user",
      content,
      charStart: 0,
      charEnd: content.length,
      sourceMessageId: null,
      sourceCreatedAt: "2019-01-01T00:00:00.000Z",
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

function seedProvenance(db: ReturnType<typeof openMemoryDb>) {
  seedSession(db, SESSION_A, "2099-01-01");
  seedSession(db, SESSION_B, "2099-01-02");
  seedMessage(db, {
    id: `${SESSION_A}-u`,
    sessionId: SESSION_A,
    content: USER_A,
    index: 0,
  });
  seedMessage(db, {
    id: `${SESSION_A}-a`,
    sessionId: SESSION_A,
    role: "assistant",
    content: ASSISTANT,
    index: 1,
  });
  seedMessage(db, {
    id: `${SESSION_B}-u`,
    sessionId: SESSION_B,
    content: USER_B,
    index: 0,
  });
  seedMessage(db, {
    id: `${SESSION_B}-a`,
    sessionId: SESSION_B,
    role: "assistant",
    content: ASSISTANT,
    index: 1,
  });
}

function files(overrides?: {
  candidateText?: string;
  assessmentText?: string;
  manifestText?: string;
}) {
  const manifest = validatedManifest();
  const map = new Map<string, string>([
    [CONCEPT_APPLY_DEFAULT_CANDIDATES, overrides?.candidateText ?? JSON.stringify(v4LikeReport())],
    [CONCEPT_APPLY_DEFAULT_ASSESSMENT, overrides?.assessmentText ?? JSON.stringify(assessmentReport())],
    [CONCEPT_APPLY_DEFAULT_MANIFEST, overrides?.manifestText ?? JSON.stringify(manifest)],
  ]);
  return {
    manifest,
    readFile: (path: string) => {
      const text = map.get(path);
      if (text === undefined) {
        throw new Error(`unexpected path ${path}`);
      }
      return text;
    },
  };
}

function runWrite(
  db: ReturnType<typeof openMemoryDb>,
  argv: string[],
  options?: {
    candidateText?: string;
    assessmentText?: string;
    manifestText?: string;
    writeResult?: (path: string, payload: ConceptAdmissionApplyResult) => void;
    applyManifest?: (manifest: ReturnType<typeof validatedManifest>, deps: { db: typeof db }) => InitialApplyResult;
  },
) {
  const fs = files(options);
  let applied = 0;
  let written: ConceptAdmissionApplyResult | null = null;
  const result = runConceptAdmissionApplyWrite(argv, {
    db,
    dbPath: ":memory:",
    readFile: fs.readFile,
    assertResultWritable: () => undefined,
    writeResult: (path, payload) => {
      written = payload;
      options?.writeResult?.(path, payload);
    },
    applyManifest: (manifest, deps) => {
      applied += 1;
      if (options?.applyManifest) {
        return options.applyManifest(manifest, deps);
      }
      return applyInitialAdmissionManifest(manifest, deps);
    },
    now: () => "2026-08-22T12:00:00.000Z",
  });
  return { result, applied, written, manifest: fs.manifest };
}

test("CLI parse: --apply と malformed options", () => {
  assert.equal(parseConceptAdmissionApplyWriteArgs([]).apply, false);
  assert.equal(parseConceptAdmissionApplyWriteArgs(["--apply"]).apply, true);
  assert.equal(
    parseConceptAdmissionApplyWriteArgs(["--apply", "--manifest"]).malformed,
    "missing_value:--manifest",
  );
  assert.equal(
    parseConceptAdmissionApplyWriteArgs(["--apply", "--explode"]).malformed,
    "unknown_option:--explode",
  );
  assert.equal(
    parseConceptAdmissionApplyWriteArgs(["--result", "data/out.json"]).resultPath,
    "data/out.json",
  );
});

test("no --apply は write 0", () => {
  const db = openMemoryDb();
  seedProvenance(db);
  const { result, applied } = runWrite(db, []);
  assert.equal(result.verdict, "PREWRITE_BLOCKED");
  assert.equal(result.transactionCommitted, false);
  if (result.verdict === "PREWRITE_BLOCKED") {
    assert.equal(result.error, CONCEPT_APPLY_WRITE_REQUIRES_FLAG);
  }
  assert.equal(applied, 0);
  assert.equal(countConcepts(db), 0);
  assert.equal(countConceptOccurrences(db), 0);
});

test("malformed options は write しない", () => {
  const db = openMemoryDb();
  seedProvenance(db);
  const { result, applied } = runWrite(db, ["--apply", "--nope"]);
  assert.equal(result.verdict, "PREWRITE_BLOCKED");
  assert.equal(applied, 0);
  assert.equal(countConcepts(db), 0);
});

test("source / assessment / manifest hash mismatch は write 前停止", () => {
  const cases = [
    { candidateText: JSON.stringify({ ...v4LikeReport(), nonce: "tamper" }) },
    { assessmentText: JSON.stringify({ ...assessmentReport(), nonce: "tamper" }) },
    {
      manifestText: JSON.stringify({
        ...validatedManifest(),
        metadata: { ...validatedManifest().metadata, contentHash: "deadbeef" },
      }),
    },
  ];
  for (const overrides of cases) {
    const isolated = openMemoryDb();
    seedProvenance(isolated);
    const { result, applied } = runWrite(isolated, ["--apply"], overrides);
    assert.equal(result.verdict, "PREWRITE_BLOCKED");
    assert.equal(applied, 0);
    assert.equal(countConcepts(isolated), 0);
    assert.equal(countConceptOccurrences(isolated), 0);
  }
});

test("Policy mismatch / Registry non-empty / normalizedKey conflict / provenance failure は write 前停止", () => {
  const policyDb = openMemoryDb();
  seedProvenance(policyDb);
  const mutated = structuredClone(validatedManifest());
  mutated.admittedCandidates[0]!.policyRuleId = "wrong_rule";
  const policy = runWrite(policyDb, ["--apply"], {
    manifestText: JSON.stringify(mutated),
  });
  assert.equal(policy.result.verdict, "PREWRITE_BLOCKED");
  assert.equal(policy.applied, 0);
  assert.equal(countConcepts(policyDb), 0);

  const nonempty = openMemoryDb();
  seedProvenance(nonempty);
  insertConcept(
    {
      id: "existing",
      canonicalLabel: "既存概念ラベル",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    nonempty,
  );
  const blockedEmpty = runWrite(nonempty, ["--apply"]);
  assert.equal(blockedEmpty.result.verdict, "PREWRITE_BLOCKED");
  assert.equal(blockedEmpty.applied, 0);
  assert.equal(countConcepts(nonempty), 1);

  const conflict = openMemoryDb();
  seedProvenance(conflict);
  insertConcept(
    {
      id: "human-existing",
      canonicalLabel: "人間関係",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    conflict,
  );
  const conflicted = runWrite(conflict, ["--apply"]);
  assert.equal(conflicted.result.verdict, "PREWRITE_BLOCKED");
  assert.equal(conflicted.applied, 0);

  const missing = openMemoryDb();
  const provenance = runWrite(missing, ["--apply"]);
  assert.equal(provenance.result.verdict, "PREWRITE_BLOCKED");
  assert.equal(provenance.applied, 0);
  assert.equal(countConcepts(missing), 0);
});

test("explicit --apply は counts / mapping / USER本文なし / aliases 0", () => {
  const db = openMemoryDb();
  seedProvenance(db);
  const { result, applied, written, manifest } = runWrite(db, ["--apply"]);
  assert.equal(result.verdict, "APPLIED", result.ok ? undefined : result.error);
  assert.equal(applied, 1);
  assert.equal(result.transactionCommitted, true);
  if (result.verdict !== "APPLIED" || !written) {
    return;
  }
  const predictedConcepts = manifest.admittedCandidates.length;
  const predictedOccurrences = manifest.admittedCandidates.reduce(
    (sum, item) => sum + item.occurrences.length,
    0,
  );
  assert.equal(written.conceptsCreated, predictedConcepts);
  assert.equal(written.occurrencesCreated, predictedOccurrences);
  assert.equal(written.aliasesCreated, 0);
  assert.equal(written.skipped, 0);
  assert.equal(written.conflicts, 0);
  assert.equal(Object.keys(written.candidateConceptMap).length, predictedConcepts);
  assert.equal(written.postWriteVerification.ok, true);
  assert.equal(countConcepts(db), predictedConcepts);
  assert.equal(countConceptOccurrences(db), predictedOccurrences);
  assert.equal(countConceptAliases(db), 0);
  assert.equal(written.candidateConceptMap.C20 !== undefined, true);
  const reportText = JSON.stringify(written);
  assert.doesNotMatch(reportText, new RegExp(USER_A));
  assert.doesNotMatch(reportText, new RegExp(USER_B));
  assert.doesNotMatch(result.summary, new RegExp(USER_A));

  const second = runWrite(db, ["--apply"]);
  assert.equal(second.result.verdict, "PREWRITE_BLOCKED");
  assert.equal(second.applied, 0);
  assert.equal(countConcepts(db), predictedConcepts);
  assert.equal(countConceptOccurrences(db), predictedOccurrences);
});

test("DB commit後の result write failure は transactionCommitted=true を失わない", () => {
  const db = openMemoryDb();
  seedProvenance(db);
  const { result, applied, manifest } = runWrite(db, ["--apply"], {
    writeResult: () => {
      throw new Error("ENOSPC");
    },
  });
  assert.equal(result.verdict, "APPLIED_REPORT_FAILED");
  assert.equal(result.transactionCommitted, true);
  assert.equal(applied, 1);
  if (result.verdict !== "APPLIED_REPORT_FAILED") {
    return;
  }
  assert.match(result.summary, /Do not --apply again/);
  assert.equal(countConcepts(db), manifest.admittedCandidates.length);
  assert.equal(countConceptAliases(db), 0);
});

test("result report の atomic write は USER本文を含まない", () => {
  const db = openMemoryDb();
  seedProvenance(db);
  const dir = mkdtempSync(join(tmpdir(), "concept-apply-"));
  const resultPath = join(dir, "concept-admission-apply-result-v1.json");
  const fs = files();
  const result = runConceptAdmissionApplyWrite(
    ["--apply", "--result", resultPath],
    {
      db,
      dbPath: ":memory:",
      readFile: fs.readFile,
      applyManifest: applyInitialAdmissionManifest,
      now: () => "2026-08-22T12:00:00.000Z",
    },
  );
  assert.equal(result.verdict, "APPLIED");
  const saved = readFileSync(resultPath, "utf8");
  assert.doesNotMatch(saved, new RegExp(USER_A));
  assert.doesNotMatch(saved, /負の連鎖/);
  const parsed = JSON.parse(saved) as ConceptAdmissionApplyResult;
  assert.equal(parsed.transactionCommitted, true);
  assert.equal(parsed.resultVersion, "concept-admission-apply-result-v1");
});

test("write path は getDb / calibration / 負の連鎖 / openai を使わない", () => {
  const sources = [
    "lib/concepts/admission/apply-run.ts",
    "lib/concepts/admission/apply-result.ts",
    "scripts/concept-admission-apply.ts",
  ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));
  for (const source of sources) {
    assert.doesNotMatch(source, /getDb\(/);
    assert.doesNotMatch(source, /from "\.\/calibration"/);
    assert.doesNotMatch(source, /負の連鎖/);
    assert.doesNotMatch(source, /openai/);
    assert.doesNotMatch(source, /insertConceptAlias/);
  }
});
