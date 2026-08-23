import { openReadonlyApplyDb } from "@/lib/concepts/admission/apply-preflight-pilot";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
} from "@/lib/db/concept-queries";
import { getDbPath } from "@/lib/db/client";
import { loadTopicSignalSnapshot } from "@/lib/concepts/topic-signal/load";
import {
  buildTopicSignalPreviewReport,
  formatTopicSignalPreviewReport,
} from "@/lib/concepts/topic-signal/preview";

const HELP = `Usage:
  npm run concept:topic-signal-preview

Read-only Topic Signal aggregation against data/app.db.
SELECT only. Does not INSERT / UPDATE / DELETE.
`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }
  if (argv.includes("--apply")) {
    console.error("topic-signal-preview is read-only; --apply is not accepted");
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
    console.error("preview changed DB counts");
    process.exit(1);
  }

  const report = buildTopicSignalPreviewReport(snapshot);
  console.log(formatTopicSignalPreviewReport(report));
  console.log("");
  console.log(
    `db counts unchanged: concepts ${after.concepts} / aliases ${after.aliases} / occurrences ${after.occurrences}`,
  );
}

main();
