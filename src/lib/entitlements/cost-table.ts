/**
 * Server-side conservative cost estimates for internal model keys.
 *
 * These are planning/accounting estimates — not live vendor invoices and not
 * client-authoritative. Settlement may take max(providerEstimate, tableEstimate)
 * so usage accounting fails closed under uncertainty.
 *
 * reservationCostCeilingMicros is a conservative hold against plan AI budgets.
 * It is derived from AI_REQUEST_ENVELOPE.maxInputTokens / maxOutputTokens — the
 * same token ceilings enforced by the o200k_base tokenizer gate before provider
 * dispatch. It is NOT an exact provider invoice amount.
 *
 * Exact provider billing reconciliation is a later concern.
 */

import type { UsageCapability } from "@prisma/client";
import {
  AI_REQUEST_ENVELOPE,
  reservationInputTokenCeiling,
  reservationOutputTokenCeiling,
} from "@/lib/ai/request-envelope";
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
 * Every InternalModelKey must have a row — reservation/settlement fail closed.
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
  if (!row) {
    // Fail closed — unknown model keys are not billable via client authority.
    throw new Error(`No cost row for internal model key: ${args.modelKey}`);
  }
  const inputTokens = Math.max(0, args.inputTokens ?? 0);
  const outputTokens = Math.max(0, args.outputTokens ?? 0);

  const tableEstimate = Math.ceil(
    (inputTokens / 1000) * row.inputPer1kMicros +
      (outputTokens / 1000) * row.outputPer1kMicros,
  );

  const provider = Math.max(0, args.providerEstimateMicros ?? 0);
  return Math.max(row.minCallMicros, tableEstimate, provider);
}

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
 *
 * Derived from AI_REQUEST_ENVELOPE token ceilings (same ceilings the tokenizer
 * gate enforces before provider dispatch):
 *   - input tokens: maxInputTokens (o200k_base billable definition)
 *   - output tokens: maxOutputTokens
 *   - plus the model\'s minCallMicros floor via estimateCostMicros
 *
 * reservedCost ≠ actualProviderCost / vendor invoice. Clients never supply this.
 *
 * Safety basis: any request that reaches the provider has already been gated to
 * billableInputTokens <= maxInputTokens, so the reserved ceiling covers the
 * maximum server-estimated cost for permitted traffic.
 */
export function reservationCostCeilingMicros(args: {
  capability: UsageCapability;
  modelKey?: InternalModelKey;
}): number {
  const modelKey = args.modelKey ?? defaultModelForCapability(args.capability);
  return estimateCostMicros({
    modelKey,
    inputTokens: reservationInputTokenCeiling(AI_REQUEST_ENVELOPE.maxInputTokens),
    outputTokens: reservationOutputTokenCeiling(
      AI_REQUEST_ENVELOPE.maxOutputTokens,
    ),
  });
}

/**
 * Maximum server-side estimated cost for traffic inside the authoritative
 * token envelope. Equals the reservation ceiling for that model.
 *
 * Note: this is NOT itself a safety proof — tests must independently measure
 * tokenizer billable tokens and compare them to reservationInputTokenCeiling().
 */
export function maxEnvelopeCostMicros(modelKey: InternalModelKey): number {
  return estimateCostMicros({
    modelKey,
    inputTokens: reservationInputTokenCeiling(AI_REQUEST_ENVELOPE.maxInputTokens),
    outputTokens: reservationOutputTokenCeiling(
      AI_REQUEST_ENVELOPE.maxOutputTokens,
    ),
  });
}
