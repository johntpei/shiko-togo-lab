import {
  CONCEPT_ADMISSION_APPLY_HELP,
  runConceptAdmissionApply,
  type AdmissionEvidenceSession,
} from "@/lib/concepts/admission/apply-pilot";
import {
  openWritableApplyDb,
  runConceptAdmissionApplyWrite,
} from "@/lib/concepts/admission/apply-run";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
} from "@/lib/db/concept-queries";
import { getDbPath } from "@/lib/db/client";
import { getSessionById, listMessagesBySessionId } from "@/lib/db/queries";

function loadSession(sessionId: string): AdmissionEvidenceSession | null {
  const session = getSessionById(sessionId);
  if (!session) {
    return null;
  }
  const messages = listMessagesBySessionId(sessionId);
  return {
    sessionId: session.id,
    occurredAt: session.occurredAt,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      sourceCreatedAt: message.sourceCreatedAt,
    })),
  };
}

function loadRegistryCounts() {
  return {
    concepts: countConcepts(),
    conceptAliases: countConceptAliases(),
    conceptOccurrences: countConceptOccurrences(),
  };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--apply")) {
    const dbPath = getDbPath();
    const db = openWritableApplyDb(dbPath);
    const before = {
      concepts: countConcepts(db),
      aliases: countConceptAliases(db),
      occurrences: countConceptOccurrences(db),
    };
    const result = runConceptAdmissionApplyWrite(argv, { db, dbPath });
    const after = {
      concepts: countConcepts(db),
      aliases: countConceptAliases(db),
      occurrences: countConceptOccurrences(db),
    };
    console.log(result.summary);
    console.log("");
    console.log(
      `registry before: concepts ${before.concepts} / aliases ${before.aliases} / occurrences ${before.occurrences}`,
    );
    console.log(
      `registry after:  concepts ${after.concepts} / aliases ${after.aliases} / occurrences ${after.occurrences}`,
    );
    if (result.verdict === "APPLIED") {
      process.exit(0);
    }
    if (result.verdict === "APPLIED_REPORT_FAILED") {
      console.error("DB commit済み / report write failed. Do not --apply again.");
      process.exit(2);
    }
    process.exit(1);
  }

  const result = runConceptAdmissionApply(argv, {
    loadSession,
    loadRegistryCounts,
  });

  if (!result.ok) {
    console.error(
      result.error === CONCEPT_ADMISSION_APPLY_HELP
        ? CONCEPT_ADMISSION_APPLY_HELP
        : result.error,
    );
    process.exit(1);
  }

  console.log(result.previewText);
}

main();
