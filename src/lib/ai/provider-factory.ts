/**
 * Resolve the process AIProvider from server configuration.
 * Default is always the stub unless production AI is explicitly enabled
 * AND fully configured (flag + confirm + openai + key + registry).
 */

import {
  getAIProductionGateStatus,
  resolveAIProviderConfig,
  type AIProviderEnv,
} from "./provider-config";
import { AIProviderConfigError } from "./provider-errors";
import { logAIOps } from "./ops-log";
import { OpenAIChatProvider } from "./providers/openai-chat";
import { StubAIProvider } from "./providers/stub";
import type { AIProvider } from "./types";

let loggedProductionActivation = false;

/**
 * Build a provider instance from env/config.
 *
 * Safe stub path: production flag off → StubAIProvider (never throws for
 * missing secrets).
 *
 * Production path: resolveAIProviderConfig fails closed when the flag is on
 * but confirm/provider/key/models/base URL are incomplete — never silently
 * substitutes stub while AI_PRODUCTION_ENABLED=true.
 */
export function createAIProviderFromConfig(
  env: AIProviderEnv = process.env,
): AIProvider {
  const config = resolveAIProviderConfig(env);

  if (config.kind === "stub") {
    return new StubAIProvider({
      maxInputTokens: config.maxInputTokens,
      maxOutputTokens: config.maxOutputTokens,
    });
  }

  if (config.kind === "openai") {
    // Defense in depth — status must be ready before constructing OpenAI.
    const status = getAIProductionGateStatus(env);
    if (!status.ready || !config.productionEnabled) {
      throw new AIProviderConfigError(
        status.reason ??
          "Production AI is not fully configured; refusing OpenAI provider.",
      );
    }

    try {
      const provider = OpenAIChatProvider.fromConfig(config);
      if (!loggedProductionActivation) {
        loggedProductionActivation = true;
        // Ops visibility only — never log the API key or confirm secret.
        logAIOps({
          event: "provider_selected",
          provider: "openai",
          outcome: "production_active",
          detail: "stub_not_in_use",
        });
      }
      return provider;
    } catch (error) {
      if (error instanceof AIProviderConfigError) throw error;
      throw new AIProviderConfigError(
        "Failed to configure OpenAI provider.",
      );
    }
  }

  // Exhaustiveness: unknown kinds must not silently become production OpenAI
  // or silently fall back to stub while production was requested.
  throw new AIProviderConfigError(
    `Unsupported AI provider kind "${String((config as { kind: string }).kind)}".`,
  );
}

/** Test hook — allow re-logging production activation after reset. */
export function resetProductionAIActivationLog(): void {
  loggedProductionActivation = false;
}
