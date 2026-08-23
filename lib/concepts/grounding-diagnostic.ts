import { hashArtifactText } from "@/lib/concepts/admission/canonical-json";

export const SURFACE_NOT_IN_UNIT_DIAGNOSTIC_CODE = "surface_not_in_unit" as const;

export type SurfaceNotInUnitDiagnosticMatches = {
  trimmed: boolean;
  nfkc: boolean;
  whitespaceNormalized: boolean;
  outerQuoteStripped: boolean;
};

/**
 * persistent diagnostic 用。surfaceForm / Evidence 本文は含めない。
 * transformation flags は diagnosis only。acceptance には使わない。
 */
export type SurfaceNotInUnitDiagnostic = {
  code: typeof SURFACE_NOT_IN_UNIT_DIAGNOSTIC_CODE;
  actionIndex: number;
  evidenceRef: string;
  surfaceFormLength: number;
  evidenceUnitLength: number;
  surfaceFormHash: string;
  evidenceUnitHash: string;
  exactMatch: boolean;
  diagnosticMatches: SurfaceNotInUnitDiagnosticMatches;
};

const OUTER_QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["「", "」"],
  ["『", "』"],
  ['"', '"'],
  ["'", "'"],
  ["\u201c", "\u201d"],
  ["\u2018", "\u2019"],
];

function containsExact(haystack: string, needle: string) {
  return needle.length > 0 && haystack.includes(needle);
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function stripOuterQuotes(text: string) {
  for (const [open, close] of OUTER_QUOTE_PAIRS) {
    if (
      text.startsWith(open) &&
      text.endsWith(close) &&
      text.length > open.length + close.length
    ) {
      return text.slice(open.length, text.length - close.length);
    }
  }
  return text;
}

/**
 * exact contiguous substring 以外の「もし変換したら一致するか」を観測する。
 * 結果を groundSurfaceForm の accept に使ってはいけない。
 */
export function diagnoseSurfaceNotInUnit(input: {
  actionIndex: number;
  evidenceRef: string;
  surfaceForm: string;
  unitText: string;
}): SurfaceNotInUnitDiagnostic {
  const surface = input.surfaceForm;
  const unitText = input.unitText;
  const exactMatch = containsExact(unitText, surface);
  const trimmed = surface.trim();
  const nfkcSurface = surface.normalize("NFKC");
  const nfkcUnit = unitText.normalize("NFKC");
  const wsSurface = normalizeWhitespace(surface);
  const wsUnit = normalizeWhitespace(unitText);
  const unquoted = stripOuterQuotes(surface);

  return {
    code: SURFACE_NOT_IN_UNIT_DIAGNOSTIC_CODE,
    actionIndex: input.actionIndex,
    evidenceRef: input.evidenceRef,
    surfaceFormLength: surface.length,
    evidenceUnitLength: unitText.length,
    surfaceFormHash: hashArtifactText(surface),
    evidenceUnitHash: hashArtifactText(unitText),
    exactMatch,
    diagnosticMatches: {
      trimmed: !exactMatch && containsExact(unitText, trimmed),
      nfkc:
        !exactMatch &&
        (containsExact(unitText, nfkcSurface) ||
          containsExact(nfkcUnit, nfkcSurface)),
      whitespaceNormalized:
        !exactMatch && containsExact(wsUnit, wsSurface),
      outerQuoteStripped:
        !exactMatch && containsExact(unitText, unquoted),
    },
  };
}
