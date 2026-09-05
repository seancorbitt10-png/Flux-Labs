import { ValidationError } from "@/lib/errors";
import type { AICompletionResult } from "./types";

/** Hard cap on assistant reply characters after provider return. */
export const MAX_PROVIDER_REPLY_CHARS = 8_000;

export type ValidatedProviderReply = {
  kind: "assistant_reply";
  text: string;
  truncated: boolean;
  provider: string;
};

/**
 * Deterministic validation of provider completion output.
 * Does not invent student facts or authority fields.
 */
export function validateProviderCompletion(
  completion: AICompletionResult | null | undefined,
): ValidatedProviderReply {
  if (!completion || typeof completion !== "object") {
    throw new ValidationError("Provider returned no completion.");
  }

  if (typeof completion.content !== "string") {
    throw new ValidationError("Provider completion content must be a string.");
  }

  const trimmed = completion.content.trim();
  if (!trimmed) {
    throw new ValidationError("Provider returned an empty response.");
  }

  if (typeof completion.provider !== "string" || !completion.provider) {
    throw new ValidationError("Provider completion missing provider id.");
  }

  if (typeof completion.modelKey !== "string" || !completion.modelKey) {
    throw new ValidationError("Provider completion missing model key.");
  }

  let text = trimmed;
  let truncated = false;
  if (text.length > MAX_PROVIDER_REPLY_CHARS) {
    text = text.slice(0, MAX_PROVIDER_REPLY_CHARS);
    truncated = true;
  }

  return {
    kind: "assistant_reply",
    text,
    truncated,
    provider: completion.provider,
  };
}
