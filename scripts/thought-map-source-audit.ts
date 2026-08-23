import { openReadonlyApplyDb } from "@/lib/concepts/admission/apply-preflight-pilot";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  type ConceptQueryDb,
} from "@/lib/db/concept-queries";
import { getDbPath } from "@/lib/db/client";
import { countObservations } from "@/lib/db/observation-queries";
import { observationSessions, sessions } from "@/lib/db/schema";
import { formatThoughtMapSourceAudit } from "@/lib/thought-map/source-audit";
import { loadThoughtMapSourceAudit } from "@/lib/thought-map/source-audit-load";

const HELP = `Usage:
  npm run thought:map-source-audit

Read-only Thought Map source audit against data/app.db.
SELECT only. Does not INSERT / UPDATE / DELETE.
Does not print Observation summaries or USER text.
Does not create a production graph contract.
`;

function snapshot(db: ConceptQueryDb) {
  return {
    observations: countObservations(db),
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
    sessions: db.select({ id: sessions.id }).from(sessions).all().length,
    observationSessions: db
      .select({
        observationId: observationSessions.observationId,
        sessionId: observationSessions.sessionId,
      })
      .from(observationSessions)
      .all().length,
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
      "thought-map-source-audit is read-only; --apply is not accepted",
    );
    process.exit(1);
  }

  const dbPath = getDbPath();
  const db = openReadonlyApplyDb(dbPath);
  const before = snapshot(db);
  const audit = loadThoughtMapSourceAudit({ db });
  const after = snapshot(db);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    console.error("thought map source audit changed DB counts");
    process.exit(1);
  }

  console.log(formatThoughtMapSourceAudit(audit));
  console.log("");
  console.log(
    `db counts unchanged: observations ${after.observations} / concepts ${after.concepts} / aliases ${after.aliases} / occurrences ${after.occurrences} / sessions ${after.sessions} / observation_sessions ${after.observationSessions}`,
  );
}

main();
