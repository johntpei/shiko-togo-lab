import { openReadonlyApplyDb } from "@/lib/concepts/admission/apply-preflight-pilot";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
} from "@/lib/db/concept-queries";
import { getDbPath } from "@/lib/db/client";
import { countObservations } from "@/lib/db/observation-queries";
import { formatThoughtTimelineContextDiagnostic } from "@/lib/thought-timeline/context-diagnostic";
import { loadThoughtTimelineContextAudit } from "@/lib/thought-timeline/context-load";

const HELP = `Usage:
  npm run thought:timeline-context-audit

Read-only Thought Timeline context diagnostic against data/app.db.
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
      "thought-timeline-context-audit is read-only; --apply is not accepted",
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
  const audit = loadThoughtTimelineContextAudit({ db });
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
    console.error("timeline context audit changed DB counts");
    process.exit(1);
  }

  console.log(formatThoughtTimelineContextDiagnostic(audit.diagnostic));
  console.log("");
  console.log(
    `production timeline items: ${audit.timeline.groups.flatMap((group) => group.items).length}`,
  );
  console.log(
    `db counts unchanged: observations ${after.observations} / concepts ${after.concepts} / aliases ${after.aliases} / occurrences ${after.occurrences}`,
  );
}

main();
