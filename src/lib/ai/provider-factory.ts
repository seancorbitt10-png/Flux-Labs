/**
 * Resolve the process AIProvider from server configuration.
 * Default is always the stub unless production AI is explicitly enabled.
 */

import { resolveAIProviderConfig, type AIProviderEnv } from "./provider-config";
import { AIProviderConfigError } from "./provider-errors";
import { OpenAIChatProvider } from "./providers/openai-chat";
import { StubAIProvider } from "./providers/stub";
import type { AIProvider } from "./types";

/**
 * Build a provider instance from env/config.
 * Never throws for the safe stub path. Throws AIProviderConfigError when
 * production openai is selected but misconfigured.
 */
export function createAIProviderFromConfig(
  env: AIProviderEnv = process.env,
): AIProvider {
  const config = resolveAIProviderConfig(env);

  if (config.kind === "stub") {
    return new StubAIProvider({
      maxInputChars: config.maxInputChars,
      maxOutputTokens: config.maxOutputTokens,
    });
  }

  if (config.kind === "openai") {
    try {
      return OpenAIChatProvider.fromConfig(config);
    } catch (error) {
      if (error instanceof AIProviderConfigError) throw error;
      throw new AIProviderConfigError(
        "Failed to configure OpenAI provider.",
      );
    }
  }

  // Exhaustiveness fallback — treat unknown as stub.
  return new StubAIProvider({
      maxInputChars: config.maxInputChars,
      maxOutputTokens: config.maxOutputTokens,
    });
}
