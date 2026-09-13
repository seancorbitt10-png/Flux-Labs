/**
 * Authoritative AI request envelope (server-only).
 *
 * Single source of truth for BOTH:
 *   A) provider-enforced input/output limits
 *   B) reservation-cost ceiling calculation
 *
 * Invariant (defensible):
 *   For any request that is allowed to reach the provider:
 *     billableInputTokens(request)  <=  maxInputTokens
 *     requestedOutputTokens         <=  maxOutputTokens
 *   therefore (server cost table is monotonic in tokens):
 *     estimateCostMicros(maxInputTokens, maxOutputTokens)
 *       >= estimateCostMicros(actualBillableInput, actualOutput)
 *
 * Billable input tokens are measured with the production o200k_base tokenizer
 * (see `@/lib/ai/tokenization`) — NOT inferred from JS string length, Unicode
 * code points, or UTF-8 bytes. UTF-16 `.length` is used only as a cheap DoS
 * prefilter and is explicitly NOT a token-cost bound.
 *
 * Environment configuration may LOWER these ceilings.
 * Environment configuration cannot RAISE them above this envelope.
 * Clients cannot change them.
 */

import { AIProviderLimitError } from "@/lib/ai/provider-errors";
import { countBillableInputTokens } from "@/lib/ai/tokenization";
import type { AICompletionRequest } from "@/lib/ai/types";

/**
 * Hard ceilings. Provider acceptance and reservation cost both derive from these.
 */
export const AI_REQUEST_ENVELOPE = {
  /**
   * Absolute maximum billable input tokens (o200k_base + chat framing).
   * Enforced by tokenizer gate before provider dispatch.
   */
  maxInputTokens: 8_000,
  /** Absolute maximum completion tokens the provider may request. */
  maxOutputTokens: 800,
  /**
   * Cheap DoS prefilter on JS string `.length` (UTF-16 code units).
   * NOT a token bound and NOT used for reservation cost.
   * Sized high enough that legitimate multilingual text is gated by tokens first.
   */
  maxInputUtf16Units: 64_000,
} as const;

export type AIRequestEnvelopeLimits = {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxInputUtf16Units?: number;
};

/** Input token ceiling used for reservation cost (= provider-enforced max). */
export function reservationInputTokenCeiling(
  maxInputTokens: number = AI_REQUEST_ENVELOPE.maxInputTokens,
): number {
  return Math.max(0, maxInputTokens);
}

/** Output token ceiling used for reservation cost (= provider max output). */
export function reservationOutputTokenCeiling(
  maxOutputTokens: number = AI_REQUEST_ENVELOPE.maxOutputTokens,
): number {
  return Math.max(0, maxOutputTokens);
}

/**
 * Clamp requested limits so they never exceed the authoritative envelope.
 * Env/config may reduce further; never increase past the hard ceiling.
 */
export function clampToRequestEnvelope(
  limits: AIRequestEnvelopeLimits,
): Required<AIRequestEnvelopeLimits> {
  return {
    maxInputTokens: Math.min(
      Math.max(0, limits.maxInputTokens),
      AI_REQUEST_ENVELOPE.maxInputTokens,
    ),
    maxOutputTokens: Math.min(
      Math.max(0, limits.maxOutputTokens),
      AI_REQUEST_ENVELOPE.maxOutputTokens,
    ),
    maxInputUtf16Units: Math.min(
      Math.max(
        0,
        limits.maxInputUtf16Units ?? AI_REQUEST_ENVELOPE.maxInputUtf16Units,
      ),
      AI_REQUEST_ENVELOPE.maxInputUtf16Units,
    ),
  };
}

/** Total UTF-16 code units across messages (DoS prefilter only). */
export function totalInputUtf16Units(request: AICompletionRequest): number {
  return request.messages.reduce((sum, m) => sum + m.content.length, 0);
}

/**
 * Enforce the envelope before provider dispatch.
 *
 * Order:
 *   1) UTF-16 unit DoS prefilter (not a token proof)
 *   2) o200k_base billable token count vs maxInputTokens (authoritative)
 *
 * Throws AIProviderLimitError (executionCertainty = not_dispatched) on violation
 * so entitlement accounting can safely RELEASE the reservation.
 */
export function assertCompletionRequestWithinEnvelope(
  request: AICompletionRequest,
  limits: AIRequestEnvelopeLimits = AI_REQUEST_ENVELOPE,
): void {
  const clamped = clampToRequestEnvelope(limits);

  const utf16Units = totalInputUtf16Units(request);
  if (utf16Units > clamped.maxInputUtf16Units) {
    throw new AIProviderLimitError(
      `Input exceeds server UTF-16 prefilter of ${clamped.maxInputUtf16Units} units`,
    );
  }

  const billableTokens = countBillableInputTokens(request);
  if (billableTokens > clamped.maxInputTokens) {
    throw new AIProviderLimitError(
      `Input exceeds server max of ${clamped.maxInputTokens} billable tokens`,
    );
  }

  if (request.maxTokens != null && request.maxTokens < 1) {
    throw new AIProviderLimitError("Requested maxTokens is below minimum.");
  }
  // maxTokens above the envelope are clamped by the provider (never sent upstream).
}
