/**
 * Server-side conservative cost estimates for internal model keys.
 *
 * These are planning/accounting estimates — not live vendor invoices and not
 * client-authoritative. Settlement may take max(providerEstimate, tableEstimate)
 * so usage accounting fails closed under uncertainty.
 *
 * reservedCostCeilingMicros is a conservative hold against plan AI budgets.
 * It is NOT an exact provider invoice amount.
 *
 * Exact provider billing reconciliation is a later concern.
 */

import type { UsageCapability } from "@prisma/client";
import type { InternalModelKey } from "@/lib/ai/types";

export type ModelCostEstimate = {
  /** Estimated USD micros per 1k input tokens */
  inputPer1kMicros: number;
  /** Estimated USD micros per 1k output tokens */
  outputPer1kMicros: number;
  /** Minimum estimated cost attributed per successful call */
  minCallMicros: number;
};

/**
 * Conservative planning table. Prefer overestimates over underestimates.
 * Values are intentionally not exposed as client-controllable inputs.
 */
export const INTERNAL_MODEL_COST_TABLE: Record<
  InternalModelKey,
  ModelCostEstimate
> = {
  "flux-fast": {
    inputPer1kMicros: 150,
    outputPer1kMicros: 600,
    minCallMicros: 50,
  },
  "flux-standard": {
    inputPer1kMicros: 150,
    outputPer1kMicros: 600,
    minCallMicros: 50,
  },
  "flux-advanced": {
    inputPer1kMicros: 2_500,
    outputPer1kMicros: 10_000,
    minCallMicros: 200,
  },
};

export function estimateCostMicros(args: {
  modelKey: InternalModelKey;
  inputTokens?: number;
  outputTokens?: number;
  /** Optional provider-reported estimate (still server-side). */
  providerEstimateMicros?: number;
}): number {
  const row = INTERNAL_MODEL_COST_TABLE[args.modelKey];
  const inputTokens = Math.max(0, args.inputTokens ?? 0);
  const outputTokens = Math.max(0, args.outputTokens ?? 0);

  const tableEstimate = Math.ceil(
    (inputTokens / 1000) * row.inputPer1kMicros +
      (outputTokens / 1000) * row.outputPer1kMicros,
  );

  const provider = Math.max(0, args.providerEstimateMicros ?? 0);
  return Math.max(row.minCallMicros, tableEstimate, provider);
}

/** Conservative token envelope used only for reservation ceilings (not billing). */
const RESERVATION_INPUT_TOKEN_CEILING = 4_000;
const RESERVATION_OUTPUT_TOKEN_CEILING = 1_000;

function defaultModelForCapability(
  capability: UsageCapability,
): InternalModelKey {
  switch (capability) {
    case "ADVANCED_TUTORING":
      return "flux-advanced";
    case "DOCUMENT_ANALYSIS":
      return "flux-standard";
    case "AI_SESSION":
    case "GENERAL":
    default:
      return "flux-standard";
  }
}

/**
 * Server-determined conservative reservation cost ceiling.
 * reservedCost ≠ actualProviderCost. Clients never supply this value.
 */
export function reservationCostCeilingMicros(args: {
  capability: UsageCapability;
  modelKey?: InternalModelKey;
}): number {
  const modelKey = args.modelKey ?? defaultModelForCapability(args.capability);
  return estimateCostMicros({
    modelKey,
    inputTokens: RESERVATION_INPUT_TOKEN_CEILING,
    outputTokens: RESERVATION_OUTPUT_TOKEN_CEILING,
  });
}
