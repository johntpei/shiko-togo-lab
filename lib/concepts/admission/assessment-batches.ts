import type { AdmissionCandidate } from "./types";

export const ASSESSMENT_BATCH_TARGET_SIZE = 6;
export const ASSESSMENT_BATCH_SEED = "concept-admission-assessment-v2";

export type AssessmentBatchStrategy = {
  kind: "hash_balanced";
  targetBatchSize: number;
  seed: string;
};

export const ASSESSMENT_BATCH_STRATEGY: AssessmentBatchStrategy = {
  kind: "hash_balanced",
  targetBatchSize: ASSESSMENT_BATCH_TARGET_SIZE,
  seed: ASSESSMENT_BATCH_SEED,
};

export type AssessmentCandidateBatch = {
  index: number;
  candidateRefs: string[];
  candidates: AdmissionCandidate[];
};

function hashCandidateRef(candidateRef: string) {
  const text = `${ASSESSMENT_BATCH_SEED}:${candidateRef}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function sortCandidatesForAssessment(
  candidates: AdmissionCandidate[],
) {
  return [...candidates].sort((left, right) => {
    const byHash =
      hashCandidateRef(left.candidateRef) - hashCandidateRef(right.candidateRef);
    if (byHash !== 0) {
      return byHash;
    }
    return left.candidateRef.localeCompare(right.candidateRef);
  });
}

export function balancedBatchSizes(
  count: number,
  target = ASSESSMENT_BATCH_TARGET_SIZE,
) {
  if (count <= 0) {
    return [];
  }
  let batchCount = Math.max(1, Math.round(count / target));
  const sizesFor = (k: number) => {
    const base = Math.floor(count / k);
    const extra = count % k;
    return Array.from({ length: k }, (_, index) =>
      base + (index < extra ? 1 : 0),
    );
  };
  let sizes = sizesFor(batchCount);
  while (batchCount > 1 && Math.min(...sizes) < 2) {
    batchCount -= 1;
    sizes = sizesFor(batchCount);
  }
  return sizes;
}

export function partitionAssessmentBatches(
  candidates: AdmissionCandidate[],
  target = ASSESSMENT_BATCH_TARGET_SIZE,
): AssessmentCandidateBatch[] {
  const sorted = sortCandidatesForAssessment(candidates);
  const sizes = balancedBatchSizes(sorted.length, target);
  const batches: AssessmentCandidateBatch[] = [];
  let offset = 0;
  for (const size of sizes) {
    const slice = sorted.slice(offset, offset + size);
    offset += size;
    batches.push({
      index: batches.length,
      candidateRefs: slice.map((item) => item.candidateRef),
      candidates: slice,
    });
  }
  return batches;
}
