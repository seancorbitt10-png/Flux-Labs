/**
 * Server-side tokenization for Flux internal model keys.
 *
 * Uses `gpt-tokenizer` with the OpenAI `o200k_base` encoding — but ONLY after
 * `@/lib/ai/model-registry` verifies that the internal model key is backed by a
 * production mapping whose encoding is explicitly `o200k_base`.
 *
 * Counts match OpenAI's o200k_base vocabulary for the currently verified vendor
 * models (gpt-4o / gpt-4o-mini family). See `model-registry.ts`.
 *
 * This is the independent measurement used to:
 *   1) gate provider dispatch (reject oversize before upstream call)
 *   2) prove reservation ceilings cover billable input tokens
 *
 * Guarantees:
 *   - Counts are produced by the o200k_base tokenizer, not by char/byte heuristics.
 *   - Chat-framing overhead is added with documented conservative constants.
 *   - Unverified / unknown model mappings fail closed (no silent o200k_base guess).
 *   - Exact vendor invoice reconciliation is NOT claimed.
 *
 * Limitations:
 *   - Bound only holds for registry entries verified as o200k_base.
 *   - New vendor models require an explicit allowlist + encoding entry in
 *     `model-registry.ts` before they can be selected or tokenized.
 */

import { encode as encodeO200kBase } from "gpt-tokenizer/encoding/o200k_base";
import {
  assertO200kModel,
  resolveVerifiedTokenizerEncoding,
  type VerifiedTokenizerEncoding,
} from "@/lib/ai/model-registry";
import { AIProviderConfigError } from "@/lib/ai/provider-errors";
import type { AICompletionRequest, InternalModelKey } from "@/lib/ai/types";

/** Encoding name for currently verified OpenAI production mappings. */
export const PRODUCTION_OPENAI_ENCODING = "o200k_base" as const;

/**
 * Conservative chat-format overhead for OpenAI Chat Completions style requests.
 * OpenAI's public cookbook uses ~3 tokens/message + ~3 reply priming for recent
 * chat models. We use slightly higher per-message overhead to fail closed if
 * framing costs drift upward slightly.
 *
 * These constants are part of the billable-input definition used by BOTH the
 * provider gate and the reservation proof tests.
 */
export const CHAT_TOKENS_PER_MESSAGE = 4;
export const CHAT_REPLY_PRIMING_TOKENS = 3;

/**
 * Encode text with the verified encoding for the internal model.
 * Never silently falls back to o200k_base for unverified mappings.
 */
function encodeWithVerifiedEncoding(
  text: string,
  modelKey: InternalModelKey,
): number[] {
  assertO200kModel(modelKey);
  const encoding: VerifiedTokenizerEncoding =
    resolveVerifiedTokenizerEncoding(modelKey);

  switch (encoding) {
    case "o200k_base":
      return encodeO200kBase(text);
    default: {
      const _exhaustive: never = encoding;
      throw new AIProviderConfigError(
        `No tokenizer implementation for encoding "${String(_exhaustive)}" ` +
          `(internal model "${modelKey}"). Failing closed.`,
      );
    }
  }
}

/** Encode a single string with the verified production encoding for the model. */
export function countStringTokens(
  text: string,
  modelKey: InternalModelKey,
): number {
  return encodeWithVerifiedEncoding(text, modelKey).length;
}

/**
 * Billable input-token estimate for a chat completion request.
 *
 * Definition (server-authoritative):
 *   sum(verified-encoding tokens of each message content)
 *   + sum(verified-encoding tokens of each message role)
 *   + CHAT_TOKENS_PER_MESSAGE * messageCount
 *   + CHAT_REPLY_PRIMING_TOKENS
 *
 * This is what the provider gate enforces against maxInputTokens, and what
 * independent tests compare against the reservation ceiling.
 */
export function countBillableInputTokens(
  request: Pick<AICompletionRequest, "modelKey" | "messages">,
): number {
  assertO200kModel(request.modelKey);
  let total = CHAT_REPLY_PRIMING_TOKENS;
  for (const message of request.messages) {
    total += CHAT_TOKENS_PER_MESSAGE;
    total += encodeWithVerifiedEncoding(message.role, request.modelKey).length;
    total += encodeWithVerifiedEncoding(message.content, request.modelKey)
      .length;
  }
  return total;
}

/**
 * Independent raw content-token count (no chat framing).
 * Useful in tests to show framing overhead is additive and positive.
 */
export function countContentTokensOnly(
  texts: string[],
  modelKey: InternalModelKey,
): number {
  return texts.reduce(
    (sum, t) => sum + encodeWithVerifiedEncoding(t, modelKey).length,
    0,
  );
}

// Re-export registry assertion for callers/tests that need the enforcement API.
export { assertO200kModel } from "@/lib/ai/model-registry";
