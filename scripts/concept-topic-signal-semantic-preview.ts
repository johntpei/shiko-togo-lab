import { openReadonlyApplyDb } from "@/lib/concepts/admission/apply-preflight-pilot";
import { loadTopicSignals } from "@/lib/concepts/topic-signal/load";
import { formatTopicSignalSet } from "@/lib/concepts/topic-signal/signals-format";
import { getDbPath } from "@/lib/db/client";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
} from "@/lib/db/concept-queries";

const HELP = `Usage:
  npm run concept:topic-signal-semantic-preview

Read-only Topic Signal v0 against data/app.db.
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
      "topic-signal-semantic-preview is read-only; --apply is not accepted",
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
  const signals = loadTopicSignals({ db });
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
    console.error("semantic preview changed DB counts");
    process.exit(1);
  }

  console.log(formatTopicSignalSet(signals));
  console.log("");
  console.log(
    `db counts unchanged: concepts ${after.concepts} / aliases ${after.aliases} / occurrences ${after.occurrences}`,
  );
}

main();
