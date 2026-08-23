import { getAiConfig } from "@/lib/ai/config";
import { getAiProvider } from "@/lib/ai/provider";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONCEPT_INCREMENTAL_NEW_CAPTURE_APPLY_ERROR,
  CONCEPT_INCREMENTAL_NEW_CAPTURE_HELP,
  NEW_ASSESSMENT_INTENT_TARGET_EXISTS,
  parseConceptIncrementalCaptureNewIntentArgs,
  REAL_FROZEN_NEW_ASSESSMENT_INTENT_BLOCKED,
  REAL_FROZEN_NEW_ASSESSMENT_INTENT_READY,
  REAL_FROZEN_NEW_ASSESSMENT_NO_NEW_CANDIDATES,
  runConceptIncrementalCaptureNewIntent,
} from "@/lib/concepts/incremental/capture-new-intent";
import { defaultOpenReadonlyIncrementalPilotDb } from "@/lib/concepts/incremental/pilot-preflight";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
} from "@/lib/db/concept-queries";
import { getDbPath } from "@/lib/db/client";
import { messages, sessions } from "@/lib/db/schema";

function snapshot(db: ReturnType<typeof defaultOpenReadonlyIncrementalPilotDb>) {
  return {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
    sessions: db.select().from(sessions).all().length,
    messages: db.select().from(messages).all().length,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--apply")) {
    console.error(CONCEPT_INCREMENTAL_NEW_CAPTURE_APPLY_ERROR);
    process.exit(1);
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(CONCEPT_INCREMENTAL_NEW_CAPTURE_HELP);
    process.exit(0);
  }

  const parsed = parseConceptIncrementalCaptureNewIntentArgs(argv);
  if (parsed.malformed || !parsed.sessionId) {
    console.error(CONCEPT_INCREMENTAL_NEW_CAPTURE_HELP);
    process.exit(1);
  }

  if (existsSync(resolve(parsed.intentPath))) {
    console.log(REAL_FROZEN_NEW_ASSESSMENT_INTENT_BLOCKED);
    console.error(NEW_ASSESSMENT_INTENT_TARGET_EXISTS);
    console.error(`intent target already exists: ${parsed.intentPath}`);
    process.exit(1);
  }

  const config = getAiConfig();
  if (!config.apiKey || !config.model || config.provider !== "openai") {
    console.error("AI provider is not configured.");
    process.exit(1);
  }

  const dbPath = getDbPath();
  const db = defaultOpenReadonlyIncrementalPilotDb(dbPath);
  const before = snapshot(db);
  const provider = getAiProvider();

  const result = await runConceptIncrementalCaptureNewIntent(argv, {
    openDb: () => db,
    generateStructured: (request) => provider.generateStructured(request),
    dbPath,
    model: config.model,
  });

  const after = snapshot(db);

  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }

  console.log(result.summary);
  console.log("");
  console.log(
    `db before: concepts ${before.concepts} / aliases ${before.aliases} / occurrences ${before.occurrences} / sessions ${before.sessions} / messages ${before.messages}`,
  );
  console.log(
    `db after:  concepts ${after.concepts} / aliases ${after.aliases} / occurrences ${after.occurrences} / sessions ${after.sessions} / messages ${after.messages}`,
  );
  if (
    before.concepts !== after.concepts ||
    before.aliases !== after.aliases ||
    before.occurrences !== after.occurrences ||
    before.sessions !== after.sessions ||
    before.messages !== after.messages
  ) {
    console.error("NEW intent capture changed DB counts");
    process.exit(1);
  }
  process.exit(
    result.report.classification === REAL_FROZEN_NEW_ASSESSMENT_INTENT_READY ||
      result.report.classification === REAL_FROZEN_NEW_ASSESSMENT_NO_NEW_CANDIDATES
      ? 0
      : 1,
  );
}

void main();
