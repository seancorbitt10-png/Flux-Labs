/**
 * Authoritative AI request envelope (server-only).
 *
 * Single source of truth for BOTH:
 *   A) provider-enforced input/output limits
 *   B) reservation-cost ceiling calculation
 *
 * Invariant:
 *   maximum possible provider cost for an authorized request
 *     <=
 *   server-side reservedCostMicros
 *
 * Environment configuration may LOWER these ceilings.
 * Environment configuration cannot RAISE them above this envelope.
 * Clients cannot change them.
 *
 * Character→token accounting is intentionally conservative and does NOT claim
 * exact tokenization. For reservation cost we treat each input character as at
 * most one billable input token (overestimate vs typical English ~4 chars/token).
 */

import { AIProviderLimitError } from "@/lib/ai/provider-errors";
import type { AICompletionRequest } from "@/lib/ai/types";

/**
 * Hard ceilings. Provider acceptance and reservation cost both derive from these.
 * Prefer a simple auditable bound over tokenizer infrastructure in this phase.
 */
export const AI_REQUEST_ENVELOPE = {
  /** Absolute maximum total input characters across all messages. */
  maxInputChars: 12_000,
  /** Absolute maximum completion tokens the provider may request. */
  maxOutputTokens: 800,
  /**
   * Conservative lower bound on characters per input token for cost accounting.
   * Using 1 means: reservation assumes ≤1 token per character (overestimate).
   * This is NOT an exact tokenizer.
   */
  inputCharsPerTokenLowerBound: 1,
} as const;

export type AIRequestEnvelopeLimits = {
  maxInputChars: number;
  maxOutputTokens: number;
};

/** Input token ceiling used for reservation cost (conservative char accounting). */
export function reservationInputTokenCeiling(
  maxInputChars: number = AI_REQUEST_ENVELOPE.maxInputChars,
): number {
  const bound = AI_REQUEST_ENVELOPE.inputCharsPerTokenLowerBound;
  return Math.ceil(Math.max(0, maxInputChars) / bound);
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
): AIRequestEnvelopeLimits {
  return {
    maxInputChars: Math.min(
      Math.max(0, limits.maxInputChars),
      AI_REQUEST_ENVELOPE.maxInputChars,
    ),
    maxOutputTokens: Math.min(
      Math.max(0, limits.maxOutputTokens),
      AI_REQUEST_ENVELOPE.maxOutputTokens,
    ),
  };
}

/** Total input characters across messages (server measurement). */
export function totalInputChars(request: AICompletionRequest): number {
  return request.messages.reduce((sum, m) => sum + m.content.length, 0);
}

/**
 * Enforce the envelope before provider dispatch.
 * Throws AIProviderLimitError (executionCertainty = not_dispatched) on violation
 * so entitlement accounting can safely RELEASE the reservation.
 */
export function assertCompletionRequestWithinEnvelope(
  request: AICompletionRequest,
  limits: AIRequestEnvelopeLimits = AI_REQUEST_ENVELOPE,
): void {
  const clamped = clampToRequestEnvelope(limits);
  const chars = totalInputChars(request);
  if (chars > clamped.maxInputChars) {
    throw new AIProviderLimitError(
      `Input exceeds server max of ${clamped.maxInputChars} characters`,
    );
  }

  if (request.maxTokens != null && request.maxTokens < 1) {
    throw new AIProviderLimitError("Requested maxTokens is below minimum.");
  }
  // maxTokens above the envelope are clamped by the provider (never sent upstream).
  // Input characters above the envelope are hard-rejected before dispatch.
}
