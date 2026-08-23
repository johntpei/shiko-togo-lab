import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openReadonlyApplyDb } from "@/lib/concepts/admission/apply-preflight-pilot";
import { getDbPath } from "@/lib/db/client";
import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
} from "@/lib/db/concept-queries";
import { countObservations } from "@/lib/db/observation-queries";
import {
  conceptProcessingCheckpoints,
  observationConceptEvidenceSupports,
  observationSessions,
  reviewSessions,
  reviews,
  sessions,
} from "@/lib/db/schema";
import {
  formatDualPipelineProcessingCoverageAudit,
} from "@/lib/processing-coverage/audit";
import {
  DEFAULT_INITIAL_CONCEPT_COVERAGE_PATH,
  loadDualPipelineProcessingCoverageAudit,
  loadInitialConceptCoverageFromCandidateText,
} from "@/lib/processing-coverage/load";

const HELP = `Usage:
  npm run processing:coverage-audit

Read-only dual-pipeline processing coverage audit against data/app.db.
SELECT only. Does not INSERT / UPDATE / DELETE.
Does not generate Reviews, Concepts, or relations.
Does not print USER text.
`;

function snapshot(db: ConceptQueryDb) {
  return {
    sessions: db.select({ id: sessions.id }).from(sessions).all().length,
    reviews: db.select({ id: reviews.id }).from(reviews).all().length,
    reviewSessions: db
      .select({
        reviewId: reviewSessions.reviewId,
        sessionId: reviewSessions.sessionId,
      })
      .from(reviewSessions)
      .all().length,
    observations: countObservations(db),
    observationSessions: db
      .select({
        observationId: observationSessions.observationId,
        sessionId: observationSessions.sessionId,
      })
      .from(observationSessions)
      .all().length,
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
    checkpoints: db
      .select({ sessionId: conceptProcessingCheckpoints.sessionId })
      .from(conceptProcessingCheckpoints)
      .all().length,
    supports: db
      .select({
        observationId: observationConceptEvidenceSupports.observationId,
        conceptId: observationConceptEvidenceSupports.conceptId,
      })
      .from(observationConceptEvidenceSupports)
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
      "processing-coverage-audit is read-only; --apply is not accepted",
    );
    process.exit(1);
  }

  const dbPath = getDbPath();
  const db = openReadonlyApplyDb(dbPath);
  const before = snapshot(db);
  const candidateText = readFileSync(
    resolve(process.cwd(), DEFAULT_INITIAL_CONCEPT_COVERAGE_PATH),
    "utf8",
  );
  const initialCoverage = loadInitialConceptCoverageFromCandidateText(
    candidateText,
  );
  const audit = loadDualPipelineProcessingCoverageAudit({
    db,
    initialCoverage,
  });
  const after = snapshot(db);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    console.error("processing coverage audit changed DB counts");
    process.exit(1);
  }

  console.log(formatDualPipelineProcessingCoverageAudit(audit));
  console.log("");
  console.log(
    `initialCoverageStatus: ${
      audit.initialCoverageStatus.ok
        ? `ok ${audit.initialCoverageStatus.sourceHash}`
        : `${audit.initialCoverageStatus.code} ${audit.initialCoverageStatus.detail}`
    }`,
  );
  console.log(
    `db counts unchanged: sessions ${after.sessions} / reviews ${after.reviews} / review_sessions ${after.reviewSessions} / observations ${after.observations} / observation_sessions ${after.observationSessions} / concepts ${after.concepts} / aliases ${after.aliases} / occurrences ${after.occurrences} / checkpoints ${after.checkpoints} / supports ${after.supports}`,
  );
}

main();
