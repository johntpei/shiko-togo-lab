import type { AdmissionDecisionKind } from "./types";

export const ADMISSION_CALIBRATION_FIXTURE_VERSION =
  "admission-calibration-v4";

export type AdmissionCalibrationClass = "A" | "B" | "C" | "D";

export type AdmissionCalibrationFixtureLabel = {
  candidateRef: string;
  canonicalLabel?: string;
  class: AdmissionCalibrationClass;
};

export type AdmissionCalibrationFixture = {
  version: string;
  sourceReport: string;
  extractPromptVersion: string;
  extractionVersion: string;
  labels: AdmissionCalibrationFixtureLabel[];
  importantStableLabels: string[];
};

export type PolicyCalibrationJudged = {
  candidateRef: string;
  canonicalLabel: string;
  decision: AdmissionDecisionKind;
};

export type PolicyCalibrationResult = {
  labeledCandidateCount: number;
  classATotal: number;
  classAAdmitted: number;
  classAAdmitRate: number | null;
  classBAdmitted: number;
  classBDeferred: number;
  classBRejected: number;
  classCAdmitted: number;
  classCDeferred: number;
  classCRejected: number;
  classCAdmitRate: number | null;
  classDTotal: number;
  classDRejected: number;
  classDRejectRate: number | null;
  admittedTotal: number;
  admittedAB: number;
  admittedABRate: number | null;
  falseAdmissions: number;
  falseAdmissionRate: number | null;
  falseRejections: number;
  importantStableTotal: number;
  importantStableAdmitted: number;
  importantStableRecall: number | null;
  importantDecisions: Array<{
    label: string;
    candidateRef: string | null;
    decision: AdmissionDecisionKind | null;
    found: boolean;
  }>;
};

export const ADMISSION_CALIBRATION_GOALS = {
  minClassAAdmitRate: 0.8,
  minClassDRejectRate: 0.8,
  minAdmittedABRate: 0.75,
  minImportantStableRecall: 6 / 7,
  maxClassCAdmitRate: 0.15,
  maxFalseAdmissionRate: 0.25,
} as const;

export type AdmissionCalibrationGoalId = keyof typeof ADMISSION_CALIBRATION_GOALS;

export type AdmissionCalibrationGoalEvaluation = {
  passed: boolean;
  failures: AdmissionCalibrationGoalId[];
};

const CALIBRATION_CLASSES = new Set(["A", "B", "C", "D"]);

export function parseAdmissionCalibrationFixture(
  raw: unknown,
):
  | { ok: true; fixture: AdmissionCalibrationFixture }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "fixture が object ではありません" };
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.version !== "string" || value.version.length === 0) {
    return { ok: false, error: "version が不正です" };
  }
  if (typeof value.sourceReport !== "string") {
    return { ok: false, error: "sourceReport が不正です" };
  }
  if (typeof value.extractPromptVersion !== "string") {
    return { ok: false, error: "extractPromptVersion が不正です" };
  }
  if (typeof value.extractionVersion !== "string") {
    return { ok: false, error: "extractionVersion が不正です" };
  }
  if (!Array.isArray(value.labels)) {
    return { ok: false, error: "labels が不正です" };
  }
  if (!Array.isArray(value.importantStableLabels)) {
    return { ok: false, error: "importantStableLabels が不正です" };
  }

  const labels: AdmissionCalibrationFixtureLabel[] = [];
  const seen = new Set<string>();
  for (const item of value.labels) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "label が不正です" };
    }
    const row = item as Record<string, unknown>;
    if (typeof row.candidateRef !== "string" || row.candidateRef.length === 0) {
      return { ok: false, error: "candidateRef が不正です" };
    }
    if (seen.has(row.candidateRef)) {
      return { ok: false, error: `duplicate candidateRef: ${row.candidateRef}` };
    }
    seen.add(row.candidateRef);
    if (
      typeof row.class !== "string" ||
      !CALIBRATION_CLASSES.has(row.class)
    ) {
      return { ok: false, error: `class が不正です: ${row.candidateRef}` };
    }
    if (
      row.canonicalLabel !== undefined &&
      typeof row.canonicalLabel !== "string"
    ) {
      return { ok: false, error: `canonicalLabel が不正です: ${row.candidateRef}` };
    }
    labels.push({
      candidateRef: row.candidateRef,
      class: row.class as AdmissionCalibrationFixtureLabel["class"],
      ...(typeof row.canonicalLabel === "string"
        ? { canonicalLabel: row.canonicalLabel }
        : {}),
    });
  }

  const importantStableLabels: string[] = [];
  for (const label of value.importantStableLabels) {
    if (typeof label !== "string" || label.length === 0) {
      return { ok: false, error: "importantStableLabels が不正です" };
    }
    importantStableLabels.push(label);
  }

  return {
    ok: true,
    fixture: {
      version: value.version,
      sourceReport: value.sourceReport,
      extractPromptVersion: value.extractPromptVersion,
      extractionVersion: value.extractionVersion,
      labels,
      importantStableLabels,
    },
  };
}

export function evaluatePolicyCalibration(input: {
  judged: PolicyCalibrationJudged[];
  fixture: AdmissionCalibrationFixture;
}): PolicyCalibrationResult {
  const classByRef = new Map(
    input.fixture.labels.map((item) => [item.candidateRef, item.class] as const),
  );
  const judgedByRef = new Map(
    input.judged.map((item) => [item.candidateRef, item] as const),
  );
  const byLabel = new Map(
    input.judged.map((item) => [item.canonicalLabel, item] as const),
  );

  const ofClass = (klass: AdmissionCalibrationClass) =>
    input.judged.filter((item) => classByRef.get(item.candidateRef) === klass);

  const classA = ofClass("A");
  const classB = ofClass("B");
  const classC = ofClass("C");
  const classD = ofClass("D");
  const admitted = input.judged.filter((item) => item.decision === "admit");
  const admittedLabeled = admitted.filter((item) =>
    classByRef.has(item.candidateRef),
  );
  const admittedAB = admittedLabeled.filter((item) => {
    const klass = classByRef.get(item.candidateRef);
    return klass === "A" || klass === "B";
  }).length;
  const falseAdmissions = admittedLabeled.filter((item) => {
    const klass = classByRef.get(item.candidateRef);
    return klass === "C" || klass === "D";
  }).length;

  const important = input.fixture.importantStableLabels.map((label) => {
    const hit = byLabel.get(label);
    if (!hit) {
      return {
        label,
        candidateRef: null,
        decision: null,
        found: false,
      };
    }
    return {
      label,
      candidateRef: hit.candidateRef,
      decision: hit.decision,
      found: true,
    };
  });
  const importantFound = important.filter((item) => item.found);
  const importantAdmitted = importantFound.filter(
    (item) => item.decision === "admit",
  ).length;

  return {
    labeledCandidateCount: input.fixture.labels.filter((item) =>
      judgedByRef.has(item.candidateRef),
    ).length,
    classATotal: classA.length,
    classAAdmitted: countDecision(classA, "admit"),
    classAAdmitRate: ratio(countDecision(classA, "admit"), classA.length),
    classBAdmitted: countDecision(classB, "admit"),
    classBDeferred: countDecision(classB, "defer"),
    classBRejected: countDecision(classB, "reject"),
    classCAdmitted: countDecision(classC, "admit"),
    classCDeferred: countDecision(classC, "defer"),
    classCRejected: countDecision(classC, "reject"),
    classCAdmitRate: ratio(countDecision(classC, "admit"), classC.length),
    classDTotal: classD.length,
    classDRejected: countDecision(classD, "reject"),
    classDRejectRate: ratio(countDecision(classD, "reject"), classD.length),
    admittedTotal: admitted.length,
    admittedAB,
    admittedABRate: ratio(admittedAB, admittedLabeled.length),
    falseAdmissions,
    falseAdmissionRate: ratio(falseAdmissions, admitted.length),
    falseRejections: classA.filter((item) => item.decision === "reject").length,
    importantStableTotal: importantFound.length,
    importantStableAdmitted: importantAdmitted,
    importantStableRecall: ratio(importantAdmitted, importantFound.length),
    importantDecisions: important,
  };
}

export function evaluateCalibrationGoals(
  result: PolicyCalibrationResult,
  goals = ADMISSION_CALIBRATION_GOALS,
): AdmissionCalibrationGoalEvaluation {
  const failures: AdmissionCalibrationGoalId[] = [];
  if ((result.classAAdmitRate ?? 0) < goals.minClassAAdmitRate) {
    failures.push("minClassAAdmitRate");
  }
  if ((result.classDRejectRate ?? 0) < goals.minClassDRejectRate) {
    failures.push("minClassDRejectRate");
  }
  if ((result.admittedABRate ?? 0) < goals.minAdmittedABRate) {
    failures.push("minAdmittedABRate");
  }
  if ((result.importantStableRecall ?? 0) < goals.minImportantStableRecall) {
    failures.push("minImportantStableRecall");
  }
  if ((result.classCAdmitRate ?? 0) > goals.maxClassCAdmitRate) {
    failures.push("maxClassCAdmitRate");
  }
  if ((result.falseAdmissionRate ?? 0) > goals.maxFalseAdmissionRate) {
    failures.push("maxFalseAdmissionRate");
  }
  return { passed: failures.length === 0, failures };
}

function countDecision(
  items: PolicyCalibrationJudged[],
  decision: AdmissionDecisionKind,
) {
  return items.filter((item) => item.decision === decision).length;
}

function ratio(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}
