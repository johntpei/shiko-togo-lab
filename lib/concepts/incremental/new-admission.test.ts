import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import { CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-admission-assessment";
import type { StructuredGenerateRequest } from "@/lib/ai/provider";
import type { ConceptAssessmentOutput } from "@/lib/ai/concept-admission-assessment-schema";
import { CONCEPT_ADMISSION_ASSESSMENT_VERSION, CONCEPT_ADMISSION_POLICY_VERSION } from "@/lib/concepts/admission/assessment-types";
import { evaluateInitialRegistryGate } from "@/lib/concepts/admission/apply-transaction";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { applySqlMigrations } from "@/lib/db/client";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  insertConcept,
  listConcepts,
} from "@/lib/db/concept-queries";
import * as schema from "@/lib/db/schema";
import { assessIncrementalNewFromIntent } from "./new-admission";
import {
  applyIncrementalNewAdmissionManifest,
  runIncrementalNewAdmissionPreflight,
} from "./new-admission-apply";
import {
  CONCEPT_INCREMENTAL_NEW_ADMISSION_MANIFEST_VERSION,
  CONCEPT_INCREMENTAL_NEW_ADMISSION_MODE,
} from "./new-admission-manifest";
import {
  buildNewAssessmentIntent,
  loadNewAssessmentIntent,
} from "./new-assessment-intent";
import type { NewCandidatePlan } from "./plan";

const SESSION_ID = "session-incremental-new-admission";
const HUMAN_ID = "concept-human-relations";
const USER_BODY =
  "SECRET_USER_BODY_NEW_ADMISSION_睡眠の質と仕事の優先順位について同じ文で考えています。";
const SURFACE_A = "睡眠の質";
const SURFACE_B = "仕事の優先順位";
const FROZEN_OCCURRED_AT = "2026-07-13T00:00:00.000Z";
const SESSION_OCCURRED_AT = "2099-01-01";

const SOURCE = {
  model: "test-extract-model",
  promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
  extractionVersion: CONCEPT_EXTRACTION_VERSION,
  coverageSourceHash: "coverage-hash-fixture",
};

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

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function counts(db: ReturnType<typeof openMemoryDb>) {
  return {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
  };
}

function seedSession(
  db: ReturnType<typeof openMemoryDb>,
  content = USER_BODY,
) {
  db.insert(schema.sessions)
    .values({
      id: SESSION_ID,
      title: SESSION_ID,
      occurredAt: SESSION_OCCURRED_AT,
      source: "chatgpt",
      category: "制作",
      rawContent: content,
      status: "parsed",
      sourceConversationId: null,
      importSource: "manual",
      sourceStartAt: null,
      sourceEndAt: null,
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
  db.insert(schema.messages)
    .values({
      id: `${SESSION_ID}-u`,
      sessionId: SESSION_ID,
      index: 0,
      role: "user",
      content,
      charStart: 0,
      charEnd: content.length,
      sourceMessageId: null,
      sourceCreatedAt: FROZEN_OCCURRED_AT,
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
  db.insert(schema.messages)
    .values({
      id: `${SESSION_ID}-a`,
      sessionId: SESSION_ID,
      index: 1,
      role: "assistant",
      content: "SECRET_ASSISTANT_BODY_了解しました。",
      charStart: 0,
      charEnd: 20,
      sourceMessageId: null,
      sourceCreatedAt: null,
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

function provenance(
  overrides: Partial<NewCandidatePlan["provenance"]> = {},
): NewCandidatePlan["provenance"] {
  return {
    sessionId: SESSION_ID,
    messageId: `${SESSION_ID}-u`,
    evidenceRef: "M001:E01",
    occurredAt: FROZEN_OCCURRED_AT,
    surfaceForm: SURFACE_A,
    sourceRole: "user",
    sourceType: "evidence_unit",
    extractionVersion: CONCEPT_EXTRACTION_VERSION,
    ...overrides,
  };
}

function newPlan(
  overrides: Partial<NewCandidatePlan> = {},
): NewCandidatePlan {
  return {
    kind: "new",
    candidateRef: `virtual:${SURFACE_A}:M001:E01:0`,
    canonicalLabel: SURFACE_A,
    normalizedKey: SURFACE_A,
    provenance: provenance(),
    ...overrides,
  };
}

function secondPlan(): NewCandidatePlan {
  return newPlan({
    candidateRef: `virtual:${SURFACE_B}:M001:E01:1`,
    canonicalLabel: SURFACE_B,
    normalizedKey: SURFACE_B,
    provenance: provenance({ surfaceForm: SURFACE_B }),
  });
}

function intentText(plans: NewCandidatePlan[]) {
  const built = buildNewAssessmentIntent({
    sessionId: SESSION_ID,
    plans,
    source: SOURCE,
    now: () => "2026-08-23T00:00:00.000Z",
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    throw new Error(built.detail);
  }
  return JSON.stringify(built.intent);
}

function cover(
  refs: string[],
  form: ConceptAssessmentOutput["assessments"][number]["conceptForm"] = "specific_named_concept",
): ConceptAssessmentOutput {
  return {
    assessments: refs.map((candidateRef) => ({
      candidateRef,
      conceptForm: form,
      evidenceRole: "central" as const,
      longitudinalPotential: "high" as const,
    })),
  };
}

function stubForPlans(
  plans: NewCandidatePlan[],
  form: ConceptAssessmentOutput["assessments"][number]["conceptForm"] = "specific_named_concept",
) {
  const parsed = cover(
    plans.map((plan) => plan.candidateRef),
    form,
  );
  return async (request: StructuredGenerateRequest) => ({
    parsed,
    model: request.model,
  });
}

test("A. single NEW → ADMIT → Concept 1 + Occurrence 1", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    const plan = newPlan();
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText([plan]),
      db,
      generateStructured: stubForPlans([plan]),
    });
    assert.equal(assessed.ok, true);
    if (!assessed.ok) {
      return;
    }
    assert.equal(assessed.manifest.metadata.mode, CONCEPT_INCREMENTAL_NEW_ADMISSION_MODE);
    assert.equal(
      assessed.manifest.metadata.version,
      CONCEPT_INCREMENTAL_NEW_ADMISSION_MANIFEST_VERSION,
    );
    assert.equal(assessed.manifest.admittedCandidates.length, 1);
    const preflight = runIncrementalNewAdmissionPreflight(assessed.manifest, {
      db,
    });
    assert.equal(preflight.status, "ready");
    const applied = applyIncrementalNewAdmissionManifest(assessed.manifest, {
      db,
      createConceptId: () => "created-concept-uuid-a",
      createOccurrenceId: () => "created-occurrence-uuid-a",
    });
    assert.equal(applied.ok, true);
    if (!applied.ok) {
      return;
    }
    assert.equal(applied.status, "applied");
    assert.equal(applied.transactionCommitted, true);
    assert.equal(applied.conceptsCreated, 1);
    assert.equal(applied.occurrencesCreated, 1);
    assert.equal(applied.aliasesCreated, 0);
    assert.equal(applied.mapping[0]?.conceptId, "created-concept-uuid-a");
    assert.notEqual(applied.mapping[0]?.conceptId, plan.candidateRef);
    assert.deepEqual(counts(db), { concepts: 1, aliases: 0, occurrences: 1 });
  });
});

test("B. multiple NEW create multiple Concept / Occurrence", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    const plans = [newPlan(), secondPlan()];
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText(plans),
      db,
      generateStructured: stubForPlans(plans),
    });
    assert.equal(assessed.ok, true);
    if (!assessed.ok) {
      return;
    }
    const applied = applyIncrementalNewAdmissionManifest(assessed.manifest, {
      db,
    });
    assert.equal(applied.ok, true);
    if (!applied.ok) {
      return;
    }
    assert.equal(applied.conceptsCreated, 2);
    assert.equal(applied.occurrencesCreated, 2);
    assert.equal(applied.manifestContentHash, assessed.manifest.metadata.contentHash);
  });
});

test("C. Policy reject does not create Concept", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    const plan = newPlan();
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText([plan]),
      db,
      generateStructured: stubForPlans([plan], "generic_head"),
    });
    assert.equal(assessed.ok, true);
    if (!assessed.ok) {
      return;
    }
    assert.equal(assessed.manifest.admittedCandidates.length, 0);
    assert.equal(assessed.manifest.notAdmitted[0]?.reasonCode, "hard_generic");
    const applied = applyIncrementalNewAdmissionManifest(assessed.manifest, {
      db,
    });
    assert.equal(applied.ok, true);
    if (!applied.ok) {
      return;
    }
    assert.equal(applied.status, "no_op");
    assert.equal(applied.transactionCommitted, false);
    assert.deepEqual(counts(db), { concepts: 0, aliases: 0, occurrences: 0 });
  });
});

test("D. all non-ADMIT is no_op and starts no transaction", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    const plans = [newPlan(), secondPlan()];
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText(plans),
      db,
      generateStructured: stubForPlans(plans, "generic_head"),
    });
    assert.equal(assessed.ok, true);
    if (!assessed.ok) {
      return;
    }
    const preflight = runIncrementalNewAdmissionPreflight(assessed.manifest, {
      db,
    });
    assert.equal(preflight.status, "no_op");
    const applied = applyIncrementalNewAdmissionManifest(assessed.manifest, {
      db,
    });
    assert.equal(applied.ok, true);
    if (applied.ok) {
      assert.equal(applied.status, "no_op");
      assert.equal(applied.code, "no_admitted_candidates");
    }
    assert.deepEqual(counts(db), { concepts: 0, aliases: 0, occurrences: 0 });
  });
});

test("E. Assessment provider failure → write 0, Policy 0, Manifest 0", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText([newPlan()]),
      db,
      generateStructured: async () => {
        throw new Error("provider down");
      },
    });
    assert.equal(assessed.ok, false);
    if (!assessed.ok) {
      assert.equal(assessed.stage, "assessment");
    }
    assert.equal("manifest" in assessed, false);
    assert.deepEqual(counts(db), { concepts: 0, aliases: 0, occurrences: 0 });
  });
});

test("F. malformed Assessment → write 0", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText([newPlan()]),
      db,
      generateStructured: async () => ({
        parsed: { assessments: [] },
        model: "test-model",
      }),
    });
    assert.equal(assessed.ok, false);
    if (!assessed.ok) {
      assert.equal(assessed.stage, "assessment");
    }
    assert.deepEqual(counts(db), { concepts: 0, aliases: 0, occurrences: 0 });
  });
});

test("G. normalizedKey conflict with existing Registry → blocked / rollback", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    insertConcept(
      {
        id: HUMAN_ID,
        canonicalLabel: SURFACE_A,
        createdAt: "2026-08-18T00:00:00.000Z",
      },
      db,
    );
    const before = counts(db);
    const plan = newPlan();
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText([plan]),
      db,
      generateStructured: stubForPlans([plan]),
    });
    assert.equal(assessed.ok, true);
    if (!assessed.ok) {
      return;
    }
    const applied = applyIncrementalNewAdmissionManifest(assessed.manifest, {
      db,
    });
    assert.equal(applied.ok, false);
    if (!applied.ok) {
      assert.equal(applied.code, "normalized_key_conflict");
      assert.equal(applied.transactionCommitted, false);
    }
    assert.deepEqual(counts(db), before);
  });
});

test("H. TOCTOU: preflight ready then same key inserted → transaction reject", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    const plan = newPlan();
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText([plan]),
      db,
      generateStructured: stubForPlans([plan]),
    });
    assert.equal(assessed.ok, true);
    if (!assessed.ok) {
      return;
    }
    const preflight = runIncrementalNewAdmissionPreflight(assessed.manifest, {
      db,
    });
    assert.equal(preflight.status, "ready");
    insertConcept(
      {
        id: "raced-in",
        canonicalLabel: SURFACE_A,
        createdAt: "2026-08-18T00:00:00.000Z",
      },
      db,
    );
    const applied = applyIncrementalNewAdmissionManifest(assessed.manifest, {
      db,
    });
    assert.equal(applied.ok, false);
    if (!applied.ok) {
      assert.equal(applied.code, "normalized_key_conflict");
      assert.equal(applied.transactionCommitted, false);
    }
    assert.equal(countConcepts(db), 1);
    assert.equal(countConceptOccurrences(db), 0);
  });
});

test("I. provenance mismatch → Assessment 0 / rollback", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    let llmCalls = 0;
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText([
        newPlan({
          provenance: provenance({ messageId: "not-this-message" }),
        }),
      ]),
      db,
      generateStructured: async (request) => {
        llmCalls += 1;
        return { parsed: cover([]), model: request.model };
      },
    });
    assert.equal(assessed.ok, false);
    if (!assessed.ok) {
      assert.equal(assessed.stage, "evidence");
      assert.equal(assessed.code, "missing_message");
    }
    assert.equal(llmCalls, 0);
    assert.deepEqual(counts(db), { concepts: 0, aliases: 0, occurrences: 0 });
  });
});

test("J. surfaceForm mismatch → Assessment 0", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    let llmCalls = 0;
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText([
        newPlan({
          provenance: provenance({ surfaceForm: "存在しない表層XYZ" }),
        }),
      ]),
      db,
      generateStructured: async () => {
        llmCalls += 1;
        throw new Error("should not call");
      },
    });
    assert.equal(assessed.ok, false);
    if (!assessed.ok) {
      assert.equal(assessed.code, "surface_not_in_unit");
    }
    assert.equal(llmCalls, 0);
  });
});

test("K. occurredAt preservation uses Frozen value", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    const plan = newPlan();
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText([plan]),
      db,
      generateStructured: stubForPlans([plan]),
    });
    assert.equal(assessed.ok, true);
    if (!assessed.ok) {
      return;
    }
    assert.equal(
      assessed.manifest.admittedCandidates[0]?.provenance.occurredAt,
      FROZEN_OCCURRED_AT,
    );
    applyIncrementalNewAdmissionManifest(assessed.manifest, { db });
    const occurrence = db.select().from(schema.conceptOccurrences).all()[0];
    assert.equal(occurrence?.occurredAt, FROZEN_OCCURRED_AT);
    assert.notEqual(occurrence?.occurredAt, SESSION_OCCURRED_AT);
  });
});

test("L. same Evidence multi NEW Concept is legal", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    const plans = [newPlan(), secondPlan()];
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText(plans),
      db,
      generateStructured: stubForPlans(plans),
    });
    assert.equal(assessed.ok, true);
    if (!assessed.ok) {
      return;
    }
    const refs = assessed.manifest.admittedCandidates.map(
      (item) => item.provenance.evidenceRef,
    );
    assert.deepEqual(refs, ["M001:E01", "M001:E01"]);
    const applied = applyIncrementalNewAdmissionManifest(assessed.manifest, {
      db,
    });
    assert.equal(applied.ok, true);
    if (applied.ok) {
      assert.equal(applied.conceptsCreated, 2);
    }
  });
});

test("M. Alias create = 0", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    const plan = newPlan();
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText([plan]),
      db,
      generateStructured: stubForPlans([plan]),
    });
    assert.equal(assessed.ok, true);
    if (!assessed.ok) {
      return;
    }
    assert.equal(assessed.manifest.aliasesToCreate, 0);
    applyIncrementalNewAdmissionManifest(assessed.manifest, { db });
    assert.equal(countConceptAliases(db), 0);
  });
});

test("N. Concept UUID is newly issued, not candidateRef", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    const plan = newPlan();
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText([plan]),
      db,
      generateStructured: stubForPlans([plan]),
    });
    assert.equal(assessed.ok, true);
    if (!assessed.ok) {
      return;
    }
    const applied = applyIncrementalNewAdmissionManifest(assessed.manifest, {
      db,
      createConceptId: () => "fresh-uuid-not-candidate-ref",
    });
    assert.equal(applied.ok, true);
    if (!applied.ok) {
      return;
    }
    assert.equal(applied.mapping[0]?.conceptId, "fresh-uuid-not-candidate-ref");
    assert.notEqual(applied.mapping[0]?.conceptId, plan.candidateRef);
    assert.equal(listConcepts(db)[0]?.id, "fresh-uuid-not-candidate-ref");
  });
});

test("O. non-empty Registry can receive Incremental NEW (no Initial empty gate)", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    insertConcept(
      {
        id: HUMAN_ID,
        canonicalLabel: "人間関係",
        createdAt: "2026-08-18T00:00:00.000Z",
      },
      db,
    );
    assert.equal(evaluateInitialRegistryGate(db).ok, false);
    const plan = newPlan();
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText([plan]),
      db,
      generateStructured: stubForPlans([plan]),
    });
    assert.equal(assessed.ok, true);
    if (!assessed.ok) {
      return;
    }
    const applied = applyIncrementalNewAdmissionManifest(assessed.manifest, {
      db,
    });
    assert.equal(applied.ok, true);
    if (applied.ok) {
      assert.equal(applied.status, "applied");
    }
    assert.equal(countConcepts(db), 2);
  });
});

test("P. Initial Apply empty gate is unchanged", () => {
  const db = openMemoryDb();
  assert.equal(evaluateInitialRegistryGate(db).ok, true);
  insertConcept(
    {
      id: HUMAN_ID,
      canonicalLabel: "人間関係",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  assert.equal(evaluateInitialRegistryGate(db).ok, false);
  const source = readFileSync(
    resolve(process.cwd(), "lib/concepts/admission/apply-transaction.ts"),
    "utf8",
  );
  assert.match(source, /evaluateInitialRegistryGate/);
  assert.match(source, /initial_registry_not_empty/);
  const incremental = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/new-admission-apply.ts"),
    "utf8",
  );
  assert.doesNotMatch(incremental, /evaluateInitialRegistryGate/);
  assert.doesNotMatch(incremental, /initial_registry_not_empty/);
});

test("Q. provisional cannot enter Intent / pipeline", () => {
  const loaded = loadNewAssessmentIntent(
    JSON.stringify({
      metadata: {
        version: "concept-incremental-new-assessment-intent-v1",
        mode: "new_candidate_assessment",
        sessionId: SESSION_ID,
        source: SOURCE,
        generatedAt: "2026-08-23T00:00:00.000Z",
        contentHash: "x",
      },
      candidates: [
        {
          kind: "provisional_new",
          candidateRef: "p1",
          canonicalLabel: SURFACE_A,
          normalizedKey: SURFACE_A,
          provisionalReason: "semantic",
          provenance: provenance(),
        },
      ],
    }),
  );
  assert.equal(loaded.ok, false);
  if (!loaded.ok) {
    assert.equal(loaded.code, "invalid_plan");
  }
});

test("R. Calibration is not imported", () => {
  const files = [
    "lib/concepts/incremental/new-admission.ts",
    "lib/concepts/incremental/new-admission-apply.ts",
    "lib/concepts/incremental/new-admission-manifest.ts",
    "lib/concepts/incremental/new-admission-validate.ts",
  ];
  for (const file of files) {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(source, /evaluatePolicyCalibration/);
    assert.doesNotMatch(source, /calibrationClass/);
    assert.doesNotMatch(source, /AdmissionCalibrationFixture/);
    assert.doesNotMatch(source, /負の連鎖/);
  }
});

test("S. USER full text is not stored in Manifest / apply result", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    const plan = newPlan();
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText([plan]),
      db,
      generateStructured: stubForPlans([plan]),
    });
    assert.equal(assessed.ok, true);
    if (!assessed.ok) {
      return;
    }
    const applied = applyIncrementalNewAdmissionManifest(assessed.manifest, {
      db,
    });
    const serialized = `${JSON.stringify(assessed.manifest)}${JSON.stringify(applied)}`;
    assert.equal(serialized.includes(USER_BODY), false);
    assert.doesNotMatch(serialized, /SECRET_USER_BODY/);
    assert.doesNotMatch(serialized, /SECRET_ASSISTANT_BODY/);
    assert.doesNotMatch(serialized, /"occurrenceCount"/);
    assert.doesNotMatch(serialized, /"rawContent"/);
  });
});

test("T. no real DB / OpenAI SDK / getDb in Incremental NEW modules", () => {
  const files = [
    "lib/concepts/incremental/new-admission.ts",
    "lib/concepts/incremental/new-admission-apply.ts",
    "lib/concepts/incremental/new-admission-manifest.ts",
    "lib/concepts/incremental/new-admission-validate.ts",
  ];
  for (const file of files) {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(source, /getDb\(/);
    assert.doesNotMatch(source, /getAiProvider/);
    assert.doesNotMatch(source, /from "openai"/);
    assert.doesNotMatch(source, /app\.db/);
    assert.doesNotMatch(source, /102a1678-dbe6-47a3-a064-a8b898425b06/);
    assert.doesNotMatch(source, /f8e1629b-2726-4b19-8b89-ecd1176e2b43/);
  }
});

test("idempotent second apply stops on identity conflict without duplicate Concept", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    const plan = newPlan();
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText([plan]),
      db,
      generateStructured: stubForPlans([plan]),
    });
    assert.equal(assessed.ok, true);
    if (!assessed.ok) {
      return;
    }
    const first = applyIncrementalNewAdmissionManifest(assessed.manifest, { db });
    assert.equal(first.ok, true);
    const second = applyIncrementalNewAdmissionManifest(assessed.manifest, {
      db,
    });
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.code, "normalized_key_conflict");
      assert.equal(second.transactionCommitted, false);
      assert.notEqual(second.code, "initial_registry_not_empty");
    }
    assert.deepEqual(counts(db), { concepts: 1, aliases: 0, occurrences: 1 });
  });
});

test("invalid Intent skips Assessment and Policy", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    let llmCalls = 0;
    const assessed = await assessIncrementalNewFromIntent({
      intentText: "{not-json",
      db,
      generateStructured: async () => {
        llmCalls += 1;
        throw new Error("should not call");
      },
    });
    assert.equal(assessed.ok, false);
    if (!assessed.ok) {
      assert.equal(assessed.stage, "intent");
    }
    assert.equal(llmCalls, 0);
  });
});

test("Assessment LLM input has no frequency / Calibration / Policy", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    const plan = newPlan();
    let user = "";
    await assessIncrementalNewFromIntent({
      intentText: intentText([plan]),
      db,
      generateStructured: async (request) => {
        user = request.user;
        return {
          parsed: cover([plan.candidateRef]),
          model: request.model,
        };
      },
    });
    assert.match(user, /canonicalLabel: 睡眠の質/);
    assert.doesNotMatch(user, /occurrenceCount/);
    assert.doesNotMatch(user, /distinctSessionCount/);
    assert.doesNotMatch(user, /firstSeenAt/);
    assert.doesNotMatch(user, /named_or_high/);
    assert.doesNotMatch(user, /calibrationClass/);
  });
});

test("canonical identity comes from Frozen plan, not Assessment", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedSession(db);
    const plan = newPlan();
    const assessed = await assessIncrementalNewFromIntent({
      intentText: intentText([plan]),
      db,
      generateStructured: stubForPlans([plan]),
    });
    assert.equal(assessed.ok, true);
    if (!assessed.ok) {
      return;
    }
    assert.equal(
      assessed.manifest.admittedCandidates[0]?.canonicalLabel,
      plan.canonicalLabel,
    );
    assert.equal(
      assessed.manifest.admittedCandidates[0]?.normalizedKey,
      plan.normalizedKey,
    );
    assert.equal(
      assessed.manifest.metadata.source.assessmentPromptVersion,
      CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION,
    );
    assert.equal(
      assessed.manifest.metadata.source.assessmentVersion,
      CONCEPT_ADMISSION_ASSESSMENT_VERSION,
    );
    assert.equal(
      assessed.manifest.metadata.admissionPolicyVersion,
      CONCEPT_ADMISSION_POLICY_VERSION,
    );
  });
});
