import { toEvidenceRole } from "@/lib/ai/evidence-units";
import { groundSurfaceForm, lookupExtractUnit } from "@/lib/concepts/grounding";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import {
  conceptExtractUnitsByRef,
  prepareUserEvidenceUnits,
  type ConceptExtractUnit,
} from "@/lib/concepts/user-units";
import {
  findConceptByNormalizedKey,
  type ConceptQueryDb,
} from "@/lib/db/concept-queries";
import { messages, sessions } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import type { NewCandidatePlan } from "./plan";

export type IncrementalNewSessionEvidence = {
  sessionId: string;
  sessionOccurredAt: string;
  units: ConceptExtractUnit[];
  unitsByRef: Map<string, ConceptExtractUnit>;
};

export type IncrementalNewCandidateValidation =
  | { ok: true; unit: ConceptExtractUnit }
  | { ok: false; code: string; detail: string };

export function loadIncrementalNewSessionEvidence(
  db: ConceptQueryDb,
  sessionId: string,
):
  | { ok: true; evidence: IncrementalNewSessionEvidence }
  | { ok: false; code: string; detail: string } {
  const session =
    db.select().from(sessions).where(eq(sessions.id, sessionId)).get() ?? null;
  if (!session) {
    return { ok: false, code: "missing_session", detail: sessionId };
  }
  const rows = db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.index))
    .all();
  const units = prepareUserEvidenceUnits({
    sessionId: session.id,
    occurredAt: session.occurredAt,
    messages: rows.map((item) => ({
      id: item.id,
      role: item.role,
      content: item.content,
      sourceCreatedAt: item.sourceCreatedAt,
    })),
  });
  return {
    ok: true,
    evidence: {
      sessionId: session.id,
      sessionOccurredAt: session.occurredAt,
      units,
      unitsByRef: conceptExtractUnitsByRef(units),
    },
  };
}

function findMessage(
  db: ConceptQueryDb,
  messageId: string,
  sessionId: string,
) {
  return (
    db
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.sessionId, sessionId)))
      .get() ?? null
  );
}

/**
 * Frozen NEW Candidate を Server Evidence から再解決し、Grounding / provenance を再確認する。
 * Intent を無条件には信用しない。
 */
export function validateIncrementalNewCandidateAgainstDb(
  plan: NewCandidatePlan,
  sessionId: string,
  db: ConceptQueryDb,
  evidence?: IncrementalNewSessionEvidence,
): IncrementalNewCandidateValidation {
  if (plan.kind !== "new") {
    return { ok: false, code: "provisional_not_allowed", detail: plan.kind };
  }
  if (plan.provenance.sessionId !== sessionId) {
    return {
      ok: false,
      code: "session_invariant",
      detail: `${plan.provenance.sessionId}!=${sessionId}`,
    };
  }
  if (plan.provenance.sourceRole !== "user") {
    return {
      ok: false,
      code: "provenance_mismatch",
      detail: `sourceRole=${plan.provenance.sourceRole}`,
    };
  }
  if (plan.provenance.sourceType !== "evidence_unit") {
    return {
      ok: false,
      code: "provenance_mismatch",
      detail: `sourceType=${plan.provenance.sourceType}`,
    };
  }
  if (plan.provenance.extractionVersion !== CONCEPT_EXTRACTION_VERSION) {
    return {
      ok: false,
      code: "invalid_extraction_version",
      detail: plan.provenance.extractionVersion,
    };
  }

  const loaded =
    evidence ??
    (() => {
      const result = loadIncrementalNewSessionEvidence(db, sessionId);
      return result.ok ? result.evidence : null;
    })();
  if (!loaded) {
    return { ok: false, code: "missing_session", detail: sessionId };
  }

  const message = findMessage(db, plan.provenance.messageId, sessionId);
  if (!message) {
    const anyMessage =
      db
        .select()
        .from(messages)
        .where(eq(messages.id, plan.provenance.messageId))
        .get() ?? null;
    if (anyMessage && anyMessage.sessionId !== sessionId) {
      return {
        ok: false,
        code: "message_session_mismatch",
        detail: plan.provenance.messageId,
      };
    }
    return {
      ok: false,
      code: "missing_message",
      detail: plan.provenance.messageId,
    };
  }
  if (toEvidenceRole(message.role) !== "user") {
    return {
      ok: false,
      code: "message_not_user",
      detail: plan.provenance.messageId,
    };
  }

  const lookup = lookupExtractUnit(
    plan.provenance.evidenceRef,
    loaded.unitsByRef,
  );
  if (!lookup.ok) {
    return {
      ok: false,
      code:
        lookup.reason === "invalid_evidence_ref"
          ? "invalid_evidence_ref"
          : "evidence_ref_unresolved",
      detail: plan.provenance.evidenceRef,
    };
  }
  if (lookup.unit.messageId !== plan.provenance.messageId) {
    return {
      ok: false,
      code: "evidence_message_mismatch",
      detail: `${plan.provenance.evidenceRef}:${plan.provenance.messageId}`,
    };
  }

  const grounded = groundSurfaceForm({
    evidenceRef: plan.provenance.evidenceRef,
    surfaceForm: plan.provenance.surfaceForm,
    unitsByRef: loaded.unitsByRef,
  });
  if (!grounded.ok) {
    return {
      ok: false,
      code: grounded.reason,
      detail: plan.provenance.evidenceRef,
    };
  }

  return { ok: true, unit: grounded.unit };
}

export function findNormalizedKeyConflict(
  db: ConceptQueryDb,
  normalizedKey: string,
) {
  return findConceptByNormalizedKey(normalizedKey, db);
}
