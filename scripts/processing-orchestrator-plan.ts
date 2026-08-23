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
  DUAL_PIPELINE_ORCHESTRATOR_PLAN_HELP,
  parseDualPipelineOrchestratorPlanArgs,
} from "@/lib/processing-orchestrator/args";
import {
  formatDualPipelineOrchestratorPlan,
} from "@/lib/processing-orchestrator/plan";
import {
  loadDualPipelineOrchestratorPlan,
  loadInitialConceptCoverageFromCandidateText,
} from "@/lib/processing-orchestrator/load";

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
  const parsed = parseDualPipelineOrchestratorPlanArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`${parsed.code}: ${parsed.detail}`);
    console.error(DUAL_PIPELINE_ORCHESTRATOR_PLAN_HELP);
    process.exit(1);
  }
  if (parsed.help) {
    console.log(DUAL_PIPELINE_ORCHESTRATOR_PLAN_HELP);
    process.exit(0);
  }

  const dbPath = getDbPath();
  const db = openReadonlyApplyDb(dbPath);
  const before = snapshot(db);
  const candidateText = readFileSync(resolve(process.cwd(), parsed.candidatesPath), "utf8");
  const initialCoverage = loadInitialConceptCoverageFromCandidateText(candidateText);
  const plan = loadDualPipelineOrchestratorPlan({
    db,
    sessionIds: parsed.sessionIds,
    initialCoverage,
  });
  const after = snapshot(db);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    console.error("processing orchestrator plan changed DB counts");
    process.exit(1);
  }

  console.log(formatDualPipelineOrchestratorPlan(plan));
  console.log("");
  console.log(
    `initialCoverageStatus: ${
      plan.initialCoverageStatus.ok
        ? `ok ${plan.initialCoverageStatus.sourceHash}`
        : `${plan.initialCoverageStatus.code} ${plan.initialCoverageStatus.detail}`
    }`,
  );
  console.log(
    `db counts unchanged: sessions ${after.sessions} / reviews ${after.reviews} / review_sessions ${after.reviewSessions} / observations ${after.observations} / observation_sessions ${after.observationSessions} / concepts ${after.concepts} / aliases ${after.aliases} / occurrences ${after.occurrences} / checkpoints ${after.checkpoints} / supports ${after.supports}`,
  );
}

main();
