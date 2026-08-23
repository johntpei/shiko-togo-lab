import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  CONCEPT_APPLY_DEFAULT_ASSESSMENT,
  CONCEPT_APPLY_DEFAULT_CANDIDATES,
  CONCEPT_APPLY_DEFAULT_MANIFEST,
  CONCEPT_APPLY_DEFAULT_RESULT,
  CONCEPT_APPLY_DRY_RUN_REFUSES_APPLY,
  parseConceptAdmissionApplyArgs,
  runConceptAdmissionApply,
} from "./apply-pilot";
import type { AdmissionEvidenceSession } from "./evidence";

const SESSION_A = "080a113a-b0b3-4c50-9160-8415203e4a48";
const SESSION_B = "32935f2d-cac9-4c9e-85f3-c9969717ece2";
const USER_A =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const USER_B =
  "人間関係を最小限にする道を選びました。高性能AIについても触れます。";
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
]);

function candidateReport() {
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

test("CLI 既定 path / custom path / --apply early reject", () => {
  assert.deepEqual(parseConceptAdmissionApplyArgs([]), {
    apply: false,
    candidatesPath: CONCEPT_APPLY_DEFAULT_CANDIDATES,
    assessmentPath: CONCEPT_APPLY_DEFAULT_ASSESSMENT,
    manifestPath: CONCEPT_APPLY_DEFAULT_MANIFEST,
    resultPath: CONCEPT_APPLY_DEFAULT_RESULT,
  });
  assert.deepEqual(
    parseConceptAdmissionApplyArgs([
      "--candidates",
      "data/custom-candidates.json",
      "--assessment",
      "data/custom-assessment.json",
      "--manifest",
      "data/custom-manifest.json",
    ]),
    {
      apply: false,
      candidatesPath: "data/custom-candidates.json",
      assessmentPath: "data/custom-assessment.json",
      manifestPath: "data/custom-manifest.json",
      resultPath: CONCEPT_APPLY_DEFAULT_RESULT,
    },
  );
  assert.equal(parseConceptAdmissionApplyArgs(["--apply"]).apply, true);
});

test("--apply は file read / session load / manifest write より前に reject する", () => {
  let read = 0;
  let load = 0;
  let written = 0;
  let registry = 0;
  const result = runConceptAdmissionApply(["--apply"], {
    loadSession: () => {
      load += 1;
      return null;
    },
    readFile: () => {
      read += 1;
      return "{}";
    },
    writeManifest: () => {
      written += 1;
    },
    loadRegistryCounts: () => {
      registry += 1;
      return { concepts: 0, conceptAliases: 0, conceptOccurrences: 0 };
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.code, "apply");
  assert.equal(result.error, CONCEPT_APPLY_DRY_RUN_REFUSES_APPLY);
  assert.equal(read, 0);
  assert.equal(load, 0);
  assert.equal(written, 0);
  assert.equal(registry, 0);
});

test("dry-run は Manifest を書き Preview して停止し、DB write しない", () => {
  let writtenPath: string | null = null;
  const writes: string[] = [];
  const result = runConceptAdmissionApply(
    [
      "--candidates",
      "data/concept-pilot-2b-v4.json",
      "--assessment",
      "data/concept-admission-assessment-v2-gpt4o.json",
      "--manifest",
      "data/concept-admission-apply-manifest-v1.json",
    ],
    {
      loadSession: (id) => SESSIONS.get(id) ?? null,
      readFile: (path) => {
        if (path.includes("assessment")) {
          return JSON.stringify(assessmentReport());
        }
        return JSON.stringify(candidateReport());
      },
      writeManifest: (path, manifest) => {
        writtenPath = path;
        writes.push(JSON.stringify(manifest));
      },
      loadRegistryCounts: () => ({
        concepts: 0,
        conceptAliases: 0,
        conceptOccurrences: 0,
      }),
      now: () => "2026-08-22T00:00:00.000Z",
    },
  );
  assert.equal(result.ok, true, result.ok ? undefined : `${result.code}: ${result.error}`);
  if (!result.ok) {
    return;
  }
  assert.equal(
    writtenPath,
    "data/concept-admission-apply-manifest-v1.json",
  );
  assert.equal(result.manifest.admittedCandidates.length, 1);
  assert.equal(result.manifest.admittedCandidates[0]?.candidateRef, "C20");
  assert.equal(result.preview.aliasCountToCreate, 0);
  assert.equal(result.preview.conceptCountToCreate, 1);
  assert.equal(result.preview.occurrenceCountToCreate, 2);
  assert.equal(result.preview.registryCounts?.concepts, 0);
  assert.match(result.previewText, /mode: initial/);
  assert.match(result.previewText, /aliases to create: 0/);
  assert.match(result.previewText, /人間関係/);
  assert.doesNotMatch(result.previewText, new RegExp(USER_A));
  assert.equal(writes.length, 1);
  assert.doesNotMatch(writes[0] ?? "", /insertConcept/);

  const sources = [
    "lib/concepts/admission/apply-manifest.ts",
    "lib/concepts/admission/apply-pilot.ts",
  ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));
  for (const source of sources) {
    assert.doesNotMatch(source, /insertConcept\(/);
    assert.doesNotMatch(source, /insertConceptAlias\(/);
    assert.doesNotMatch(source, /insertConceptOccurrence\(/);
    assert.doesNotMatch(source, /applyInitialAdmissionManifest/);
    assert.doesNotMatch(source, /sqlite\.transaction/);
  }
});
