import { openReadonlyApplyDb } from "@/lib/concepts/admission/apply-preflight-pilot";
import { buildTopicSignalDiagnostic } from "@/lib/concepts/topic-signal/diagnostic";
import { formatTopicSignalDiagnosticReport } from "@/lib/concepts/topic-signal/diagnostic-format";
import { loadTopicSignalSnapshot } from "@/lib/concepts/topic-signal/load";
import { getDbPath } from "@/lib/db/client";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
} from "@/lib/db/concept-queries";

const HELP = `Usage:
  npm run concept:topic-signal-diagnostic

Read-only Topic Signal diagnostic against data/app.db.
Development aid only. Does not classify Signals.
SELECT only. Does not INSERT / UPDATE / DELETE.
`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }
  if (argv.includes("--apply")) {
    console.error(
      "topic-signal-diagnostic is read-only; --apply is not accepted",
    );
    process.exit(1);
  }

  const dbPath = getDbPath();
  const db = openReadonlyApplyDb(dbPath);
  const before = {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
  };
  const snapshot = loadTopicSignalSnapshot({ db });
  const report = buildTopicSignalDiagnostic(snapshot);
  const after = {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
  };
  if (
    before.concepts !== after.concepts ||
    before.aliases !== after.aliases ||
    before.occurrences !== after.occurrences
  ) {
    console.error("diagnostic changed DB counts");
    process.exit(1);
  }

  console.log(formatTopicSignalDiagnosticReport(report));
  console.log("");
  console.log(
    `db counts unchanged: concepts ${after.concepts} / aliases ${after.aliases} / occurrences ${after.occurrences}`,
  );
}

main();
