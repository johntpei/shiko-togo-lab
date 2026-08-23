import { getDbPath } from "@/lib/db/client";
import { openWritableApplyDb } from "@/lib/concepts/admission/apply-run";
import {
  CONCEPT_INCREMENTAL_EXISTING_APPEND_HELP,
  parseConceptIncrementalExistingAppendArgs,
  REAL_EXISTING_MATCH_ALREADY_PRESENT,
  REAL_EXISTING_MATCH_APPENDED,
  REAL_EXISTING_MATCH_APPENDED_REPORT_FAILED,
  REAL_EXISTING_MATCH_APPEND_PREVIEW,
  runConceptIncrementalExistingAppend,
} from "@/lib/concepts/incremental/existing-append";
import { defaultOpenReadonlyIncrementalPilotDb } from "@/lib/concepts/incremental/pilot-preflight";

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(CONCEPT_INCREMENTAL_EXISTING_APPEND_HELP);
    process.exit(0);
  }

  const parsed = parseConceptIncrementalExistingAppendArgs(argv);
  if (parsed.malformed || !parsed.intentPath) {
    console.error(CONCEPT_INCREMENTAL_EXISTING_APPEND_HELP);
    process.exit(1);
  }

  const dbPath = getDbPath();
  const result = await runConceptIncrementalExistingAppend(argv, {
    openDb: (path) =>
      parsed.apply
        ? openWritableApplyDb(path)
        : defaultOpenReadonlyIncrementalPilotDb(path),
    dbPath,
  });

  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }

  console.log(result.summary);
  console.log("");
  console.log(
    `db before: concepts ${result.result.db.before.concepts} / aliases ${result.result.db.before.conceptAliases} / occurrences ${result.result.db.before.conceptOccurrences} / sessions ${result.result.db.before.sessions} / messages ${result.result.db.before.messages}`,
  );
  console.log(
    `db after:  concepts ${result.result.db.after.concepts} / aliases ${result.result.db.after.conceptAliases} / occurrences ${result.result.db.after.conceptOccurrences} / sessions ${result.result.db.after.sessions} / messages ${result.result.db.after.messages}`,
  );

  if (result.result.classification === REAL_EXISTING_MATCH_APPENDED_REPORT_FAILED) {
    console.error(
      "DB commit済み / result artifact write failed. Do not --apply again.",
    );
    process.exit(2);
  }

  if (
    result.result.classification === REAL_EXISTING_MATCH_APPENDED ||
    result.result.classification === REAL_EXISTING_MATCH_ALREADY_PRESENT ||
    result.result.classification === REAL_EXISTING_MATCH_APPEND_PREVIEW
  ) {
    process.exit(0);
  }

  if (result.result.transactionCommitted) {
    console.error(
      "DB transaction committed. Do not --apply again. Inspect verification / result next.",
    );
  }
  process.exit(1);
}

void main();
