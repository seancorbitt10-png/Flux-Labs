import type { ProvenanceKind } from "@prisma/client";

/**
 * Confidence is an internal reliability / prioritization score.
 * It is NOT calibrated probability, diagnosis, truth, or permission
 * for weak inference to override explicit facts.
 */
export const DEFAULT_CONFIDENCE: Record<ProvenanceKind, number> = {
  EXPLICIT: 0.9,
  IMPORTED: 0.75,
  OBSERVED: 0.45,
  INFERRED: 0.35,
  HYPOTHESIS: 0.25,
};

const PROVENANCE_RANK: Record<ProvenanceKind, number> = {
  EXPLICIT: 5,
  IMPORTED: 4,
  OBSERVED: 3,
  INFERRED: 2,
  HYPOTHESIS: 1,
};

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function defaultConfidenceFor(provenance: ProvenanceKind): number {
  return DEFAULT_CONFIDENCE[provenance];
}

/**
 * Provenance outranks confidence numbers.
 * Weaker OBSERVED/INFERRED/HYPOTHESIS must not overwrite EXPLICIT.
 */
export function mayOverwriteCurrentState(args: {
  existingProvenance: ProvenanceKind;
  existingConfidence: number;
  incomingProvenance: ProvenanceKind;
}): boolean {
  const { existingProvenance, incomingProvenance } = args;

  if (incomingProvenance === "EXPLICIT") {
    return true;
  }

  // After the EXPLICIT early-return, incoming is always weaker than EXPLICIT.
  if (existingProvenance === "EXPLICIT") {
    return false;
  }

  return PROVENANCE_RANK[incomingProvenance] >= PROVENANCE_RANK[existingProvenance];
}

export function isWeakerThanExplicit(provenance: ProvenanceKind): boolean {
  return provenance !== "EXPLICIT";
}
