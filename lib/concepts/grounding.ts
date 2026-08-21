import { parseEvidenceRef } from "@/lib/ai/evidence-units";
import { quoteExistsInContent } from "@/lib/ai/evidence";
import type { ConceptExtractUnit } from "./user-units";

export const SURFACE_GROUNDING_FAILURE_REASONS = [
  "empty_surface",
  "invalid_evidence_ref",
  "ref_not_in_batch",
  "surface_not_in_unit",
] as const;

export type SurfaceGroundingFailureReason =
  (typeof SURFACE_GROUNDING_FAILURE_REASONS)[number];

export type UnitLookupFailureReason =
  | "invalid_evidence_ref"
  | "ref_not_in_batch";

export type UnitLookupResult =
  | { ok: true; unit: ConceptExtractUnit }
  | { ok: false; reason: UnitLookupFailureReason };

export type SurfaceGroundingResult =
  | { ok: true; unit: ConceptExtractUnit }
  | { ok: false; reason: SurfaceGroundingFailureReason };

export function lookupExtractUnit(
  evidenceRef: string,
  unitsByRef: Map<string, ConceptExtractUnit>,
): UnitLookupResult {
  if (!parseEvidenceRef(evidenceRef)) {
    return { ok: false, reason: "invalid_evidence_ref" };
  }
  const unit = unitsByRef.get(evidenceRef);
  if (!unit) {
    return { ok: false, reason: "ref_not_in_batch" };
  }
  return { ok: true, unit };
}

/**
 * surfaceForm は指定 Unit.text 内の連続した実在文字列であること。
 * 意味的な一致だけでは通さない。canonicalLabel の存在は要求しない。
 */
export function groundSurfaceForm(input: {
  evidenceRef: string;
  surfaceForm: string;
  unitsByRef: Map<string, ConceptExtractUnit>;
}): SurfaceGroundingResult {
  const lookup = lookupExtractUnit(input.evidenceRef, input.unitsByRef);
  if (!lookup.ok) {
    return lookup;
  }
  if (!input.surfaceForm.trim()) {
    return { ok: false, reason: "empty_surface" };
  }
  if (!quoteExistsInContent(lookup.unit.text, input.surfaceForm)) {
    return { ok: false, reason: "surface_not_in_unit" };
  }
  return { ok: true, unit: lookup.unit };
}
