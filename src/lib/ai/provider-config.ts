/**
 * Server-side AI provider configuration.
 *
 * Production AI is OFF by default. Having an API key is not enough —
 * ALL of the following must be true for the OpenAI path:
 *   1. AI_PRODUCTION_ENABLED=true
 *   2. AI_PRODUCTION_CONFIRM=ENABLE_REAL_AI  (accidental-enablement safeguard)
 *   3. AI_PROVIDER=openai
 *   4. OPENAI_API_KEY present
 *   5. Internal model keys resolve through the authoritative model registry
 *   6. OPENAI_BASE_URL is a valid https URL (when production is enabled)
 *
 * If AI_PRODUCTION_ENABLED=true but any required condition is missing/invalid:
 * fail closed with AIProviderConfigError — never silently substitute stub or
 * another provider/model.
 *
 * Input/output token limits are clamped to AI_REQUEST_ENVELOPE — env may only
 * lower them. Clients cannot raise them. Reservation cost uses the same
 * token envelope (tokenizer-gated).
 *
 * Vendor model env vars (AI_MODEL_FLUX_*) may only select allowlisted IDs
 * verified for o200k_base in `@/lib/ai/model-registry`. Unsupported IDs fail
 * closed at config resolution — before provider dispatch.
 *
 * Never import this module from client components.
 */

import {
  AI_REQUEST_ENVELOPE,
  clampToRequestEnvelope,
} from "@/lib/ai/request-envelope";
import {
  defaultVerifiedVendorModelIds,
  resolveVerifiedVendorModelIds,
} from "@/lib/ai/model-registry";
import { AIProviderConfigError } from "@/lib/ai/provider-errors";
import type { InternalModelKey } from "@/lib/ai/types";

export type AIProviderEnv = Record<string, string | undefined>;

export type AIProviderKind = "stub" | "openai";

/**
 * Exact confirmation string required alongside AI_PRODUCTION_ENABLED=true.
 * Prevents accidental enablement from flipping a single boolean-like env var.
 */
export const AI_PRODUCTION_CONFIRM_VALUE = "ENABLE_REAL_AI" as const;

export type AIProviderRuntimeConfig = {
  /** Selected provider kind after applying the production gate. */
  kind: AIProviderKind;
  /**
   * True only when production AI is explicitly enabled AND fully configured
   * (confirm + openai + key + registry + secure base URL).
   */
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
   * Server-enforced max billable input tokens (client cannot raise).
   * Always ≤ AI_REQUEST_ENVELOPE.maxInputTokens. Enforced via o200k_base gate.
   */
  maxInputTokens: number;
  /**
   * DoS prefilter on UTF-16 code units (not a token-cost bound).
   * Always ≤ AI_REQUEST_ENVELOPE.maxInputUtf16Units.
   */
  maxInputUtf16Units: number;
  /** Internal model key → vendor model id. */
  modelIds: Record<InternalModelKey, string>;
};

/** Diagnostic view of the production gate (never includes secrets). */
export type AIProductionGateStatus = {
  productionFlag: boolean;
  confirmOk: boolean;
  providerIsOpenAI: boolean;
  apiKeyPresent: boolean;
  modelsOk: boolean;
  baseUrlOk: boolean;
  /** True only when every required condition passes. */
  ready: boolean;
  /** Human-readable reason when not ready (safe for logs). */
  reason: string | null;
};

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_OUTPUT_TOKENS = AI_REQUEST_ENVELOPE.maxOutputTokens;
const DEFAULT_MAX_INPUT_TOKENS = AI_REQUEST_ENVELOPE.maxInputTokens;
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

const DEFAULT_MODEL_IDS: Record<InternalModelKey, string> =
  defaultVerifiedVendorModelIds();

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
 * Explicit production gate flag. Only the string "true" (case-insensitive)
 * counts. Presence of API keys alone does NOT enable production AI.
 *
 * This is the flag only — full readiness also requires confirm + provider +
 * key + registry. Prefer `isProductionAIReady` / `resolveAIProviderConfig`.
 */
export function isProductionAIEnabled(
  env: AIProviderEnv = process.env,
): boolean {
  return (env.AI_PRODUCTION_ENABLED ?? "").trim().toLowerCase() === "true";
}

function isProductionConfirmOk(env: AIProviderEnv): boolean {
  return readFrom(env, "AI_PRODUCTION_CONFIRM") === AI_PRODUCTION_CONFIRM_VALUE;
}

function tryResolveModelIds(
  env: AIProviderEnv,
):
  | { ok: true; modelIds: Record<InternalModelKey, string> }
  | { ok: false; message: string } {
  try {
    return {
      ok: true,
      modelIds: resolveVerifiedVendorModelIds({
        "flux-fast": readFrom(env, "AI_MODEL_FLUX_FAST"),
        "flux-standard": readFrom(env, "AI_MODEL_FLUX_STANDARD"),
        "flux-advanced": readFrom(env, "AI_MODEL_FLUX_ADVANCED"),
      }),
    };
  } catch (error) {
    if (error instanceof AIProviderConfigError) {
      return { ok: false, message: error.message };
    }
    const message =
      error instanceof Error
        ? error.message
        : "Model registry rejected configured vendor model IDs.";
    return { ok: false, message };
  }
}

/**
 * Validate OpenAI base URL for production: must be absolute https URL.
 * Rejects empty, relative, or non-https endpoints (no silent http fallback).
 */
export function assertSecureOpenAIBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AIProviderConfigError(
      "OPENAI_BASE_URL must be a valid absolute https URL when production AI is enabled.",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new AIProviderConfigError(
      "OPENAI_BASE_URL must use https when production AI is enabled.",
    );
  }
  return trimmed;
}

/**
 * Secret-free diagnostic for ops/tests. Does not throw.
 */
export function getAIProductionGateStatus(
  env: AIProviderEnv = process.env,
): AIProductionGateStatus {
  const productionFlag = isProductionAIEnabled(env);
  const confirmOk = isProductionConfirmOk(env);
  const providerIsOpenAI = parseProviderKind(env.AI_PROVIDER) === "openai";
  const apiKeyPresent = readFrom(env, "OPENAI_API_KEY") != null;
  const models = tryResolveModelIds(env);
  const modelsOk = models.ok;

  const rawBase = readFrom(env, "OPENAI_BASE_URL") ?? DEFAULT_OPENAI_BASE_URL;
  let baseUrlOk = false;
  let baseUrlReason: string | null = null;
  try {
    assertSecureOpenAIBaseUrl(rawBase);
    baseUrlOk = true;
  } catch (error) {
    baseUrlReason =
      error instanceof Error
        ? error.message
        : "OPENAI_BASE_URL is invalid for production AI.";
  }

  if (!productionFlag) {
    return {
      productionFlag,
      confirmOk,
      providerIsOpenAI,
      apiKeyPresent,
      modelsOk,
      baseUrlOk,
      ready: false,
      reason: "AI_PRODUCTION_ENABLED is not true (safe default: stub).",
    };
  }

  if (!confirmOk) {
    return {
      productionFlag,
      confirmOk,
      providerIsOpenAI,
      apiKeyPresent,
      modelsOk,
      baseUrlOk,
      ready: false,
      reason: `AI_PRODUCTION_CONFIRM must be exactly "${AI_PRODUCTION_CONFIRM_VALUE}".`,
    };
  }
  if (!providerIsOpenAI) {
    return {
      productionFlag,
      confirmOk,
      providerIsOpenAI,
      apiKeyPresent,
      modelsOk,
      baseUrlOk,
      ready: false,
      reason: "AI_PROVIDER must be openai when production AI is enabled.",
    };
  }
  if (!apiKeyPresent) {
    return {
      productionFlag,
      confirmOk,
      providerIsOpenAI,
      apiKeyPresent,
      modelsOk,
      baseUrlOk,
      ready: false,
      reason: "OPENAI_API_KEY is required when production AI is enabled.",
    };
  }
  if (!modelsOk) {
    return {
      productionFlag,
      confirmOk,
      providerIsOpenAI,
      apiKeyPresent,
      modelsOk,
      baseUrlOk,
      ready: false,
      reason: models.message,
    };
  }
  if (!baseUrlOk) {
    return {
      productionFlag,
      confirmOk,
      providerIsOpenAI,
      apiKeyPresent,
      modelsOk,
      baseUrlOk,
      ready: false,
      reason: baseUrlReason,
    };
  }

  return {
    productionFlag,
    confirmOk,
    providerIsOpenAI,
    apiKeyPresent,
    modelsOk,
    baseUrlOk,
    ready: true,
    reason: null,
  };
}

/** True when production AI is fully configured and ready for real inference. */
export function isProductionAIReady(env: AIProviderEnv = process.env): boolean {
  return getAIProductionGateStatus(env).ready;
}

/**
 * Resolve server provider configuration.
 * Safe default: stub when production flag is off.
 *
 * When AI_PRODUCTION_ENABLED=true, ALL required conditions must pass or this
 * throws AIProviderConfigError (fail closed — no silent stub substitution).
 *
 * AI_MAX_INPUT_TOKENS / AI_MAX_OUTPUT_TOKENS may only reduce the envelope;
 * values above AI_REQUEST_ENVELOPE are clamped server-side.
 */
export function resolveAIProviderConfig(
  env: AIProviderEnv = process.env,
): AIProviderRuntimeConfig {
  const productionFlag = isProductionAIEnabled(env);
  const requestedKind = parseProviderKind(env.AI_PROVIDER);

  const parsedLimits = clampToRequestEnvelope({
    maxOutputTokens: parsePositiveInt(
      env.AI_MAX_OUTPUT_TOKENS,
      DEFAULT_MAX_OUTPUT_TOKENS,
      16,
      AI_REQUEST_ENVELOPE.maxOutputTokens,
    ),
    maxInputTokens: parsePositiveInt(
      env.AI_MAX_INPUT_TOKENS,
      DEFAULT_MAX_INPUT_TOKENS,
      256,
      AI_REQUEST_ENVELOPE.maxInputTokens,
    ),
    maxInputUtf16Units: parsePositiveInt(
      env.AI_MAX_INPUT_UTF16_UNITS,
      AI_REQUEST_ENVELOPE.maxInputUtf16Units,
      1_000,
      AI_REQUEST_ENVELOPE.maxInputUtf16Units,
    ),
  });

  // Model registry always resolves (defaults when env overrides omitted).
  // Unregistered vendor models fail closed even with production off.
  const models = tryResolveModelIds(env);
  if (!models.ok) {
    throw new AIProviderConfigError(models.message);
  }

  if (productionFlag) {
    const status = getAIProductionGateStatus(env);
    if (!status.ready) {
      throw new AIProviderConfigError(
        status.reason ??
          "Production AI configuration is incomplete; refusing to start.",
      );
    }

    const openaiBaseUrl = assertSecureOpenAIBaseUrl(
      readFrom(env, "OPENAI_BASE_URL") ?? DEFAULT_OPENAI_BASE_URL,
    );
    const openaiApiKey = readFrom(env, "OPENAI_API_KEY");
    if (!openaiApiKey) {
      throw new AIProviderConfigError(
        "OPENAI_API_KEY is required when production AI is enabled.",
      );
    }

    return {
      kind: "openai",
      productionEnabled: true,
      requestedKind,
      openaiApiKey,
      openaiBaseUrl,
      timeoutMs: parsePositiveInt(
        env.AI_TIMEOUT_MS,
        DEFAULT_TIMEOUT_MS,
        1_000,
        120_000,
      ),
      maxOutputTokens: parsedLimits.maxOutputTokens,
      maxInputTokens: parsedLimits.maxInputTokens,
      maxInputUtf16Units: parsedLimits.maxInputUtf16Units,
      modelIds: models.modelIds,
    };
  }

  // Production flag off: always stub. Key / AI_PROVIDER alone never activate
  // real inference. Do not throw — CI and local remain safe by default.
  return {
    kind: "stub",
    productionEnabled: false,
    requestedKind,
    openaiApiKey: null,
    openaiBaseUrl: readFrom(env, "OPENAI_BASE_URL") ?? DEFAULT_OPENAI_BASE_URL,
    timeoutMs: parsePositiveInt(
      env.AI_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      1_000,
      120_000,
    ),
    maxOutputTokens: parsedLimits.maxOutputTokens,
    maxInputTokens: parsedLimits.maxInputTokens,
    maxInputUtf16Units: parsedLimits.maxInputUtf16Units,
    modelIds: models.modelIds,
  };
}

/** Defaults exported for documentation/tests (aligned to AI_REQUEST_ENVELOPE). */
export const AI_PROVIDER_DEFAULTS = {
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  maxInputTokens: DEFAULT_MAX_INPUT_TOKENS,
  maxInputUtf16Units: AI_REQUEST_ENVELOPE.maxInputUtf16Units,
  openaiBaseUrl: DEFAULT_OPENAI_BASE_URL,
  modelIds: DEFAULT_MODEL_IDS,
  productionConfirmValue: AI_PRODUCTION_CONFIRM_VALUE,
} as const;
