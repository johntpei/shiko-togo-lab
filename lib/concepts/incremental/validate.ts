import { toEvidenceRole } from "@/lib/ai/evidence-units";
import { classifyServerIdentity } from "@/lib/concepts/identity";
import {
  conceptOccurrenceIdentity,
  validateConceptOccurrence,
} from "@/lib/concepts/occurrence";
import { prepareUserEvidenceUnits } from "@/lib/concepts/user-units";
import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import {
  conceptOccurrences,
  concepts,
  messages,
  sessions,
} from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import {
  INCREMENTAL_MATCH_REASONS,
  type ExistingMatchPlan,
  type IncrementalCandidateProvenance,
  type IncrementalMatchReason,
} from "./plan";
import { loadConceptRegistrySnapshot } from "./registry";

export type ExistingMatchAppendDb = ConceptQueryDb;

export type ExistingMatchOccurrenceClassification =
  | { status: "insertable" }
  | { status: "already_present" }
  | { status: "conflict"; code: "occurrence_conflict"; detail: string }
  | { status: "blocked"; code: string; detail: string };

export type ExistingMatchOccurrenceRow = {
  sessionId: string;
  messageId: string;
  evidenceRef: string;
  occurredAt: string;
  sourceRole: string;
  sourceType: string;
  extractionVersion: string;
  conceptId: string;
};

function isAllowedMatchReason(value: string): value is IncrementalMatchReason {
  return (INCREMENTAL_MATCH_REASONS as readonly string[]).includes(value);
}

export function existingMatchOccurrenceIdentityKey(plan: ExistingMatchPlan) {
  const identity = conceptOccurrenceIdentity({
    extractionVersion: plan.provenance.extractionVersion,
    sourceType: plan.provenance.sourceType,
    messageId: plan.provenance.messageId,
    evidenceRef: plan.provenance.evidenceRef,
    conceptId: plan.conceptId,
  });
  return `${identity.extractionVersion}:${identity.sourceType}:${identity.messageId}:${identity.evidenceRef}:${identity.conceptId}`;
}

export function existingMatchProvenanceMatchesRow(
  row: ExistingMatchOccurrenceRow,
  plan: ExistingMatchPlan,
) {
  const provenance = plan.provenance;
  return (
    row.conceptId === plan.conceptId &&
    row.sessionId === provenance.sessionId &&
    row.messageId === provenance.messageId &&
    row.evidenceRef === provenance.evidenceRef &&
    row.occurredAt === provenance.occurredAt &&
    row.sourceRole === provenance.sourceRole &&
    row.sourceType === provenance.sourceType &&
    row.extractionVersion === provenance.extractionVersion
  );
}

function findConcept(db: ExistingMatchAppendDb, conceptId: string) {
  return (
    db.select().from(concepts).where(eq(concepts.id, conceptId)).get() ?? null
  );
}

export function findExistingMatchOccurrenceByIdentity(
  db: ExistingMatchAppendDb,
  plan: ExistingMatchPlan,
) {
  return (
    db
      .select()
      .from(conceptOccurrences)
      .where(
        and(
          eq(conceptOccurrences.extractionVersion, plan.provenance.extractionVersion),
          eq(conceptOccurrences.sourceType, plan.provenance.sourceType),
          eq(conceptOccurrences.messageId, plan.provenance.messageId),
          eq(conceptOccurrences.evidenceRef, plan.provenance.evidenceRef),
          eq(conceptOccurrences.conceptId, plan.conceptId),
        ),
      )
      .get() ?? null
  );
}

function findSession(db: ExistingMatchAppendDb, sessionId: string) {
  return (
    db.select().from(sessions).where(eq(sessions.id, sessionId)).get() ?? null
  );
}

function findMessageById(db: ExistingMatchAppendDb, messageId: string) {
  return (
    db.select().from(messages).where(eq(messages.id, messageId)).get() ?? null
  );
}

function listMessages(db: ExistingMatchAppendDb, sessionId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.index))
    .all();
}

function blocked(code: string, detail: string): ExistingMatchOccurrenceClassification {
  return { status: "blocked", code, detail };
}

function checkPlanKind(plan: ExistingMatchPlan, index: number) {
  if (plan.kind !== "existing_match") {
    return blocked(
      "unsupported_plan_kind",
      `${index}:${String((plan as { kind?: string }).kind)}`,
    );
  }
  if (!isAllowedMatchReason(plan.matchReason)) {
    return blocked(
      "unsupported_match_reason",
      `${plan.candidateRef}:${plan.matchReason}`,
    );
  }
  return null;
}

function checkConceptIdentity(db: ExistingMatchAppendDb, plan: ExistingMatchPlan) {
  const concept = findConcept(db, plan.conceptId);
  if (!concept) {
    return blocked("missing_concept", plan.conceptId);
  }
  if (concept.normalizedKey !== plan.normalizedKey) {
    return blocked("identity_mismatch", `${plan.candidateRef}:normalizedKey`);
  }
  if (concept.canonicalLabel !== plan.canonicalLabel) {
    return blocked("identity_mismatch", `${plan.candidateRef}:canonicalLabel`);
  }

  const snapshot = loadConceptRegistrySnapshot(db);
  const identity = classifyServerIdentity(snapshot, plan.provenance.surfaceForm);
  if (plan.matchReason === "exact_canonical") {
    if (identity.kind !== "exact" || identity.entry.conceptId !== plan.conceptId) {
      return blocked("identity_mismatch", `${plan.candidateRef}:exact_canonical`);
    }
    return null;
  }
  if (
    identity.kind !== "observed_alias" ||
    identity.entry.conceptId !== plan.conceptId
  ) {
    return blocked(
      "identity_mismatch",
      `${plan.candidateRef}:unique_observed_alias`,
    );
  }
  return null;
}

function checkProvenance(db: ExistingMatchAppendDb, plan: ExistingMatchPlan) {
  const provenance: IncrementalCandidateProvenance = plan.provenance;
  if (provenance.sourceRole !== "user") {
    return blocked("non_user_source_role", plan.candidateRef);
  }
  if (provenance.sourceType !== "evidence_unit") {
    return blocked("unsupported_source_type", plan.candidateRef);
  }

  const occurrenceCheck = validateConceptOccurrence({
    conceptId: plan.conceptId,
    sessionId: provenance.sessionId,
    messageId: provenance.messageId,
    evidenceRef: provenance.evidenceRef,
    occurredAt: provenance.occurredAt,
    sourceRole: provenance.sourceRole,
    sourceType: provenance.sourceType,
    extractionVersion: provenance.extractionVersion,
  });
  if (!occurrenceCheck.ok) {
    return blocked(occurrenceCheck.reason, plan.candidateRef);
  }

  const session = findSession(db, provenance.sessionId);
  if (!session) {
    return blocked("missing_session", provenance.sessionId);
  }
  const message = findMessageById(db, provenance.messageId);
  if (!message) {
    return blocked("missing_message", provenance.messageId);
  }
  if (message.sessionId !== provenance.sessionId) {
    return blocked(
      "message_session_mismatch",
      `${provenance.sessionId}:${provenance.messageId}`,
    );
  }
  if (toEvidenceRole(message.role) !== "user") {
    return blocked("message_not_user", provenance.messageId);
  }

  const units = prepareUserEvidenceUnits({
    sessionId: session.id,
    occurredAt: session.occurredAt,
    messages: listMessages(db, session.id).map((item) => ({
      id: item.id,
      role: item.role,
      content: item.content,
      sourceCreatedAt: item.sourceCreatedAt,
    })),
  });
  const unit = units.find((item) => item.evidenceRef === provenance.evidenceRef);
  if (!unit) {
    return blocked(
      "evidence_ref_unresolved",
      `${plan.candidateRef}:${provenance.evidenceRef}`,
    );
  }
  if (unit.messageId !== provenance.messageId) {
    return blocked("evidence_message_mismatch", plan.candidateRef);
  }
  return null;
}

function classifyAgainstKnownRow(
  row: ExistingMatchOccurrenceRow,
  plan: ExistingMatchPlan,
): ExistingMatchOccurrenceClassification {
  if (!existingMatchProvenanceMatchesRow(row, plan)) {
    return {
      status: "conflict",
      code: "occurrence_conflict",
      detail: `${plan.candidateRef}:${existingMatchOccurrenceIdentityKey(plan)}`,
    };
  }
  return { status: "already_present" };
}

/**
 * existing_match Occurrence の read-only 分類。
 * Preflight と write transaction が同じ判定を使う。
 * insert はしない。
 */
export function classifyExistingMatchOccurrencePlan(
  plan: ExistingMatchPlan,
  index: number,
  db: ExistingMatchAppendDb,
  seen: ReadonlyMap<string, ExistingMatchPlan>,
): ExistingMatchOccurrenceClassification {
  const kind = checkPlanKind(plan, index);
  if (kind) {
    return kind;
  }
  const identity = checkConceptIdentity(db, plan);
  if (identity) {
    return identity;
  }
  const provenance = checkProvenance(db, plan);
  if (provenance) {
    return provenance;
  }

  const key = existingMatchOccurrenceIdentityKey(plan);
  const prior = seen.get(key);
  if (prior) {
    return classifyAgainstKnownRow(
      {
        conceptId: prior.conceptId,
        sessionId: prior.provenance.sessionId,
        messageId: prior.provenance.messageId,
        evidenceRef: prior.provenance.evidenceRef,
        occurredAt: prior.provenance.occurredAt,
        sourceRole: prior.provenance.sourceRole,
        sourceType: prior.provenance.sourceType,
        extractionVersion: prior.provenance.extractionVersion,
      },
      plan,
    );
  }

  const existing = findExistingMatchOccurrenceByIdentity(db, plan);
  if (existing) {
    return classifyAgainstKnownRow(existing, plan);
  }
  return { status: "insertable" };
}
