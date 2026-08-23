import { getDbPath } from "@/lib/db/client";
import {
  CONCEPT_INCREMENTAL_EXISTING_PREFLIGHT_APPLY_ERROR,
  CONCEPT_INCREMENTAL_EXISTING_PREFLIGHT_HELP,
  parseConceptIncrementalExistingPreflightArgs,
  REAL_EXISTING_MATCH_PREFLIGHT_NO_OP,
  REAL_EXISTING_MATCH_PREFLIGHT_READY,
  runConceptIncrementalExistingPreflight,
} from "@/lib/concepts/incremental/existing-preflight";
import { defaultOpenReadonlyIncrementalPilotDb } from "@/lib/concepts/incremental/pilot-preflight";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
} from "@/lib/db/concept-queries";
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
    console.error(CONCEPT_INCREMENTAL_EXISTING_PREFLIGHT_APPLY_ERROR);
    process.exit(1);
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(CONCEPT_INCREMENTAL_EXISTING_PREFLIGHT_HELP);
    process.exit(0);
  }

  const parsed = parseConceptIncrementalExistingPreflightArgs(argv);
  if (parsed.malformed || !parsed.intentPath) {
    console.error(CONCEPT_INCREMENTAL_EXISTING_PREFLIGHT_HELP);
    process.exit(1);
  }

  const dbPath = getDbPath();
  const db = defaultOpenReadonlyIncrementalPilotDb(dbPath);
  const before = snapshot(db);

  const result = await runConceptIncrementalExistingPreflight(argv, {
    openDb: () => db,
    dbPath,
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
    console.error("existing-match preflight changed DB counts");
    process.exit(1);
  }
  process.exit(
    result.report.classification === REAL_EXISTING_MATCH_PREFLIGHT_READY ||
      result.report.classification === REAL_EXISTING_MATCH_PREFLIGHT_NO_OP
      ? 0
      : 1,
  );
}

void main();
