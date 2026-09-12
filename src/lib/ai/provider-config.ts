/**
 * Server-side AI provider configuration.
 *
 * Production AI is OFF by default. Having an API key is not enough —
 * AI_PRODUCTION_ENABLED must be explicitly "true".
 *
 * Input/output limits are clamped to AI_REQUEST_ENVELOPE — env may only lower
 * them. Clients cannot raise them. Reservation cost uses the same envelope.
 *
 * Never import this module from client components.
 */

import {
  AI_REQUEST_ENVELOPE,
  clampToRequestEnvelope,
} from "./request-envelope";
import type { InternalModelKey } from "./types";

export type AIProviderEnv = Record<string, string | undefined>;

export type AIProviderKind = "stub" | "openai";

export type AIProviderRuntimeConfig = {
  /** Selected provider kind after applying the production gate. */
  kind: AIProviderKind;
  /** True only when production AI is explicitly enabled. */
  productionEnabled: boolean;
  /** Requested kind from env before the production gate. */
  requestedKind: AIProviderKind;
  /** OpenAI API key — only present when kind === "openai". */
  openaiApiKey: string | null;
  /** OpenAI API base URL (server-only; never client-controlled). */
  openaiBaseUrl: string;
  /** Hard timeout for upstream HTTP calls. */
  timeoutMs: number;
  /**
   * Server-enforced max completion tokens (client cannot raise).
   * Always ≤ AI_REQUEST_ENVELOPE.maxOutputTokens.
   */
  maxOutputTokens: number;
  /**
   * Server-enforced max total input characters (client cannot raise).
   * Always ≤ AI_REQUEST_ENVELOPE.maxInputChars.
   */
  maxInputChars: number;
  /** Internal model key → vendor model id. */
  modelIds: Record<InternalModelKey, string>;
};

const DEFAULT_TIMEOUT_MS = 25_000;
/** Defaults equal the authoritative envelope (env may only lower). */
const DEFAULT_MAX_OUTPUT_TOKENS = AI_REQUEST_ENVELOPE.maxOutputTokens;
const DEFAULT_MAX_INPUT_CHARS = AI_REQUEST_ENVELOPE.maxInputChars;
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

const DEFAULT_MODEL_IDS: Record<InternalModelKey, string> = {
  "flux-fast": "gpt-4o-mini",
  "flux-standard": "gpt-4o-mini",
  "flux-advanced": "gpt-4o",
};

function readFrom(env: AIProviderEnv, name: string): string | null {
  const value = env[name];
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(n, max);
}

function parseProviderKind(raw: string | undefined): AIProviderKind {
  const value = (raw ?? "stub").toLowerCase();
  if (value === "openai") return "openai";
  return "stub";
}

/**
 * Explicit production gate. Only the string "true" (case-insensitive) enables
 * non-stub providers. Presence of API keys alone does NOT enable production AI.
 */
export function isProductionAIEnabled(
  env: AIProviderEnv = process.env,
): boolean {
  return (env.AI_PRODUCTION_ENABLED ?? "").trim().toLowerCase() === "true";
}

/**
 * Resolve server provider configuration.
 * Safe default: stub. Production path requires AI_PRODUCTION_ENABLED=true.
 *
 * AI_MAX_INPUT_CHARS / AI_MAX_OUTPUT_TOKENS may only reduce the envelope;
 * values above AI_REQUEST_ENVELOPE are clamped server-side.
 */
export function resolveAIProviderConfig(
  env: AIProviderEnv = process.env,
): AIProviderRuntimeConfig {
  const productionEnabled = isProductionAIEnabled(env);
  const requestedKind = parseProviderKind(env.AI_PROVIDER);
  const kind: AIProviderKind =
    productionEnabled && requestedKind === "openai" ? "openai" : "stub";

  // Parse with envelope hard max as the clamp ceiling (not 500k / 4096).
  const parsedLimits = clampToRequestEnvelope({
    maxOutputTokens: parsePositiveInt(
      env.AI_MAX_OUTPUT_TOKENS,
      DEFAULT_MAX_OUTPUT_TOKENS,
      16,
      AI_REQUEST_ENVELOPE.maxOutputTokens,
    ),
    maxInputChars: parsePositiveInt(
      env.AI_MAX_INPUT_CHARS,
      DEFAULT_MAX_INPUT_CHARS,
      1_000,
      AI_REQUEST_ENVELOPE.maxInputChars,
    ),
  });

  return {
    kind,
    productionEnabled,
    requestedKind,
    openaiApiKey: kind === "openai" ? readFrom(env, "OPENAI_API_KEY") : null,
    openaiBaseUrl:
      readFrom(env, "OPENAI_BASE_URL") ?? DEFAULT_OPENAI_BASE_URL,
    timeoutMs: parsePositiveInt(
      env.AI_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      1_000,
      120_000,
    ),
    maxOutputTokens: parsedLimits.maxOutputTokens,
    maxInputChars: parsedLimits.maxInputChars,
    modelIds: {
      "flux-fast":
        readFrom(env, "AI_MODEL_FLUX_FAST") ?? DEFAULT_MODEL_IDS["flux-fast"],
      "flux-standard":
        readFrom(env, "AI_MODEL_FLUX_STANDARD") ??
        DEFAULT_MODEL_IDS["flux-standard"],
      "flux-advanced":
        readFrom(env, "AI_MODEL_FLUX_ADVANCED") ??
        DEFAULT_MODEL_IDS["flux-advanced"],
    },
  };
}

/** Defaults exported for documentation/tests (aligned to AI_REQUEST_ENVELOPE). */
export const AI_PROVIDER_DEFAULTS = {
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  maxInputChars: DEFAULT_MAX_INPUT_CHARS,
  openaiBaseUrl: DEFAULT_OPENAI_BASE_URL,
  modelIds: DEFAULT_MODEL_IDS,
} as const;
