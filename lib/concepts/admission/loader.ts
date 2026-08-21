import type { ConceptPilotReport } from "@/lib/concepts/pilot";
import type { AdmissionPilotSnapshot } from "./candidates";

export type LoadedAdmissionPilotReport = {
  snapshot: AdmissionPilotSnapshot;
  extractPromptVersion: string | null;
  extractionVersion: string | null;
  selectedSessionIds: string[];
};

export function snapshotFromConceptPilotReport(
  raw: unknown,
):
  | { ok: true; loaded: LoadedAdmissionPilotReport }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Pilot report が JSON object ではありません" };
  }
  const report = raw as Partial<ConceptPilotReport>;
  if (!Array.isArray(report.concepts) || !Array.isArray(report.actions)) {
    return { ok: false, error: "Pilot report に concepts / actions がありません" };
  }
  const snapshot: AdmissionPilotSnapshot = {
    concepts: report.concepts.map((item) => ({
      ref: item.ref,
      canonicalLabel: item.canonicalLabel,
      normalizedKey: item.normalizedKey,
    })),
    actions: report.actions.map((item) => ({
      sessionId: item.sessionId,
      evidenceRef: item.evidenceRef,
      surfaceForm: item.surfaceForm,
      resolvedAs: item.resolvedAs,
      matchKind: item.matchKind,
      conceptRef: item.conceptRef,
    })),
    suspicious: (report.suspicious ?? []).map((item) => ({
      kind: item.kind,
      conceptRef: item.conceptRef,
    })),
    provisionalMatches: (report.provisionalMatches ?? []).map((item) => ({
      sessionId: item.sessionId,
      evidenceRef: item.evidenceRef,
      surfaceForm: item.surfaceForm,
      candidateConceptRef: item.candidateConceptRef,
      existingCanonicalLabel: item.existingCanonicalLabel,
    })),
  };
  return {
    ok: true,
    loaded: {
      snapshot,
      extractPromptVersion: report.metadata?.promptVersion ?? null,
      extractionVersion: report.metadata?.extractionVersion ?? null,
      selectedSessionIds: report.metadata?.selectedSessionIds ?? [],
    },
  };
}
