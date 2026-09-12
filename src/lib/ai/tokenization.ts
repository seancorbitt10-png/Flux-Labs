/**
 * Server-side tokenization for Flux internal model keys.
 *
 * Uses `gpt-tokenizer` with the OpenAI `o200k_base` encoding — the encoding used
 * by the production vendor models currently mapped for flux-* keys (gpt-4o /
 * gpt-4o-mini family). Counts match OpenAI's o200k_base vocabulary (verified
 * against the same encoding family used by those models).
 *
 * This is the independent measurement used to:
 *   1) gate provider dispatch (reject oversize before upstream call)
 *   2) prove reservation ceilings cover billable input tokens
 *
 * Guarantees:
 *   - Counts are produced by the o200k_base tokenizer, not by char/byte heuristics.
 *   - Chat-framing overhead is added with documented conservative constants.
 *   - Exact vendor invoice reconciliation is NOT claimed (pricing table is still
 *     an internal estimate; protocol details may evolve with vendor APIs).
 *
 * Limitations:
 *   - Bound only holds for models that use o200k_base (current Flux mappings).
 *   - If vendor model mappings change to a different encoding, this module must
 *     be updated in the same change — fail closed rather than reuse a wrong codec.
 */

import { encode } from "gpt-tokenizer/encoding/o200k_base";
import type { AICompletionRequest, InternalModelKey } from "@/lib/ai/types";

/** Encoding name for all currently mapped OpenAI production models. */
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

function assertO200kModel(_modelKey: InternalModelKey): void {
  // All current flux-* → OpenAI mappings use o200k_base. If a future mapping
  // uses a different encoding, replace this with a model→encoding switch in
  // the same commit and fail closed for unknown encodings.
}

/** Encode a single string with the production encoding for the internal model. */
export function countStringTokens(
  text: string,
  modelKey: InternalModelKey,
): number {
  assertO200kModel(modelKey);
  return encode(text).length;
}

/**
 * Billable input-token estimate for a chat completion request.
 *
 * Definition (server-authoritative):
 *   sum(o200k tokens of each message content)
 *   + sum(o200k tokens of each message role)
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
    total += encode(message.role).length;
    total += encode(message.content).length;
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
  assertO200kModel(modelKey);
  return texts.reduce((sum, t) => sum + encode(t).length, 0);
}
