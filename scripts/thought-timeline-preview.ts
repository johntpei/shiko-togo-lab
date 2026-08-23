import { openReadonlyApplyDb } from "@/lib/concepts/admission/apply-preflight-pilot";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
} from "@/lib/db/concept-queries";
import { getDbPath } from "@/lib/db/client";
import { countObservations } from "@/lib/db/observation-queries";
import {
  formatThoughtTimelineDiagnostic,
} from "@/lib/thought-timeline/diagnostic";
import {
  loadThoughtTimelineAudit,
  thoughtTimelinePreviewExtras,
} from "@/lib/thought-timeline/load";

const HELP = `Usage:
  npm run thought:timeline-preview

Read-only Thought Timeline v0 against data/app.db.
SELECT only. Does not INSERT / UPDATE / DELETE.
Does not print Observation summaries or USER text.
`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }
  if (argv.includes("--apply")) {
    console.error(
      "thought-timeline-preview is read-only; --apply is not accepted",
    );
    process.exit(1);
  }

  const dbPath = getDbPath();
  const db = openReadonlyApplyDb(dbPath);
  const before = {
    observations: countObservations(db),
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
  };
  const audit = loadThoughtTimelineAudit({ db });
  const after = {
    observations: countObservations(db),
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
  };
  if (
    before.observations !== after.observations ||
    before.concepts !== after.concepts ||
    before.aliases !== after.aliases ||
    before.occurrences !== after.occurrences
  ) {
    console.error("timeline preview changed DB counts");
    process.exit(1);
  }

  console.log(
    formatThoughtTimelineDiagnostic(
      audit.diagnostic,
      thoughtTimelinePreviewExtras(audit.timeline),
    ),
  );
  console.log("");
  console.log(
    `db counts unchanged: observations ${after.observations} / concepts ${after.concepts} / aliases ${after.aliases} / occurrences ${after.occurrences}`,
  );
}

main();
