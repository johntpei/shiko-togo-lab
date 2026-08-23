import { openReadonlyApplyDb } from "@/lib/concepts/admission/apply-preflight-pilot";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  type ConceptQueryDb,
} from "@/lib/db/concept-queries";
import { getDbPath } from "@/lib/db/client";
import { countObservations } from "@/lib/db/observation-queries";
import { formatThoughtMapProvenanceJoinAudit } from "@/lib/thought-map/provenance-join-audit";
import { loadThoughtMapProvenanceJoinAudit } from "@/lib/thought-map/provenance-join-audit-load";

const HELP = `Usage:
  npm run thought:map-provenance-join-audit

Read-only Observation↔Concept provenance join audit against data/app.db.
SELECT only. Does not INSERT / UPDATE / DELETE.
Does not print quotes, Observation bodies, or USER text.
Does not create a production graph or observation_concepts table.
`;

function snapshot(db: ConceptQueryDb) {
  return {
    observations: countObservations(db),
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
  };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }
  if (argv.includes("--apply")) {
    console.error(
      "thought-map-provenance-join-audit is read-only; --apply is not accepted",
    );
    process.exit(1);
  }

  const dbPath = getDbPath();
  const db = openReadonlyApplyDb(dbPath);
  const before = snapshot(db);
  const audit = loadThoughtMapProvenanceJoinAudit({ db });
  const after = snapshot(db);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    console.error("thought map provenance join audit changed DB counts");
    process.exit(1);
  }

  console.log(formatThoughtMapProvenanceJoinAudit(audit));
  console.log("");
  console.log(
    `db counts unchanged: observations ${after.observations} / concepts ${after.concepts} / aliases ${after.aliases} / occurrences ${after.occurrences}`,
  );
}

main();
