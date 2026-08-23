import { getDb } from "@/lib/db/client";
import {
  OBSERVATION_CONCEPT_RELATION_CLI_HELP,
  formatObservationConceptRelationCliResult,
  runObservationConceptRelationCli,
} from "@/lib/observations/observation-concept-relation-cli";

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(OBSERVATION_CONCEPT_RELATION_CLI_HELP);
    process.exit(0);
  }
  const result = runObservationConceptRelationCli(argv, { db: getDb() });
  const text = formatObservationConceptRelationCliResult(result);
  if (!result.ok) {
    console.error(text);
    process.exit(1);
  }
  console.log(text);
}

main();
