import {
  CONCEPT_ADMISSION_PREFLIGHT_HELP,
  CONCEPT_APPLY_APPLY_ERROR,
  openReadonlyApplyDb,
  runConceptAdmissionPreflight,
} from "@/lib/concepts/admission/apply-preflight-pilot";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
} from "@/lib/db/concept-queries";
import { getDbPath } from "@/lib/db/client";

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--apply")) {
    console.error(CONCEPT_APPLY_APPLY_ERROR);
    process.exit(1);
  }

  const dbPath = getDbPath();
  const db = openReadonlyApplyDb(dbPath);
  const before = {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
  };

  const result = runConceptAdmissionPreflight(argv, {
    openDb: () => db,
    dbPath,
  });

  const after = {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
  };

  if (!result.ok) {
    console.error(result.error === CONCEPT_ADMISSION_PREFLIGHT_HELP
      ? CONCEPT_ADMISSION_PREFLIGHT_HELP
      : result.error);
    process.exit(1);
  }

  console.log(result.summary);
  console.log("");
  console.log(
    `registry before: concepts ${before.concepts} / aliases ${before.aliases} / occurrences ${before.occurrences}`,
  );
  console.log(
    `registry after:  concepts ${after.concepts} / aliases ${after.aliases} / occurrences ${after.occurrences}`,
  );
  if (
    before.concepts !== after.concepts ||
    before.aliases !== after.aliases ||
    before.occurrences !== after.occurrences
  ) {
    console.error("preflight changed registry counts");
    process.exit(1);
  }
  process.exit(result.result.status === "ready" ? 0 : 1);
}

main();
