/**
 * AI provider resolution entrypoint.
 *
 * - StubAIProvider: default for CI, local, and production until explicitly gated
 * - setAIProvider / resetAIProvider: test/DI hooks
 * - getAIProvider: resolves override → env-gated factory (stub by default)
 *
 * Never import provider-config secrets into client components.
 */

import { createAIProviderFromConfig } from "./provider-factory";
import { StubAIProvider } from "./providers/stub";
import type { AIProvider } from "./types";

export { StubAIProvider };

/**
 * Provider resolution:
 * - Test/DI override via setAIProvider wins when set.
 * - Otherwise resolve from server env (stub by default; production gated).
 */
let overrideProvider: AIProvider | null = null;
let cachedProvider: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (overrideProvider) return overrideProvider;
  if (!cachedProvider) {
    cachedProvider = createAIProviderFromConfig();
  }
  return cachedProvider;
}

/** Test/DI hook — swap providers without changing call sites. */
export function setAIProvider(next: AIProvider): void {
  overrideProvider = next;
}

/**
 * Clear DI override and cached env-resolved provider.
 * Used by tests when mutating process.env provider gates.
 */
export function resetAIProvider(): void {
  overrideProvider = null;
  cachedProvider = null;
}
