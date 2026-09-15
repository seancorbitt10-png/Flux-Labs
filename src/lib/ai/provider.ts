/**
 * AI provider resolution entrypoint.
 *
 * - StubAIProvider: default for CI, local, and production until explicitly gated
 * - setAIProvider / resetAIProvider: test/DI hooks (tests only — never wire from client)
 * - getAIProvider: resolves override → env-gated factory (stub by default)
 *
 * Kill switch: AI_PRODUCTION_ENABLED≠true forces stub. If a previously cached
 * OpenAI instance is still in memory after the flag is turned off, getAIProvider
 * drops the cache and re-resolves so subsequent requests cannot dispatch to OpenAI.
 *
 * Never import provider-config secrets into client components.
 */

import { isProductionAIReady } from "./provider-config";
import {
  createAIProviderFromConfig,
  resetProductionAIActivationLog,
} from "./provider-factory";
import { StubAIProvider } from "./providers/stub";
import type { AIProvider } from "./types";

export { StubAIProvider };

/**
 * Provider resolution:
 * - Test/DI override via setAIProvider wins when set.
 * - Otherwise resolve from server env (stub by default; production gated).
 * - Cached OpenAI is invalidated when the production gate is no longer ready
 *   (operational kill switch without requiring process restart).
 */
let overrideProvider: AIProvider | null = null;
let cachedProvider: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (overrideProvider) return overrideProvider;

  // Kill switch: a previously constructed OpenAI provider must not survive
  // after AI_PRODUCTION_ENABLED is turned off (or the gate becomes incomplete).
  if (cachedProvider?.id === "openai" && !isProductionAIReady()) {
    cachedProvider = null;
    resetProductionAIActivationLog();
  }

  if (!cachedProvider) {
    cachedProvider = createAIProviderFromConfig();
  }
  return cachedProvider;
}

/**
 * Test/DI hook — swap providers without changing call sites.
 * Must never be exposed to clients or used to bypass the production gate in ops.
 */
export function setAIProvider(next: AIProvider): void {
  overrideProvider = next;
}

/**
 * Clear DI override and cached env-resolved provider.
 * Used by tests when mutating process.env provider gates, and by ops after
 * kill-switch / config changes in long-lived processes (also handled lazily
 * inside getAIProvider for OpenAI → stub).
 */
export function resetAIProvider(): void {
  overrideProvider = null;
  cachedProvider = null;
  resetProductionAIActivationLog();
}
