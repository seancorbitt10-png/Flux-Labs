/**
 * Server-side verified model ↔ tokenizer registry.
 *
 * This is the authoritative mapping between:
 *   internal model key  →  vendor model ID  →  tokenizer encoding
 *
 * Reservation-cost safety depends on tokenization matching the production
 * vendor models that can actually be dispatched. That relationship is NOT
 * documentation-only: unresolved / unverified mappings fail closed.
 *
 * Currently verified production mappings (OpenAI Chat Completions):
 *   flux-fast     → gpt-4o-mini → o200k_base
 *   flux-standard → gpt-4o-mini → o200k_base
 *   flux-advanced → gpt-4o      → o200k_base
 *
 * Environment may select ONLY among explicitly allowlisted vendor model IDs
 * that share the verified encoding for that internal key. Arbitrary vendor
 * strings are rejected before provider dispatch.
 *
 * Exact vendor invoice reconciliation is NOT claimed.
 * o200k_base is NOT assumed for arbitrary future OpenAI models.
 */

import { AIProviderConfigError } from "@/lib/ai/provider-errors";
import type { InternalModelKey } from "@/lib/ai/types";

/** Tokenizer encodings this server knows how to enforce. */
export type VerifiedTokenizerEncoding = "o200k_base";

export type VerifiedModelMapping = {
  internalModelKey: InternalModelKey;
  /** Default vendor model ID when env does not override. */
  vendorModelId: string;
  /**
   * Vendor model IDs env may select for this internal key.
   * Every ID in this list is verified to use `encoding`.
   */
  allowedVendorModelIds: readonly string[];
  encoding: VerifiedTokenizerEncoding;
};

/**
 * Vendor model IDs verified to use o200k_base for current Flux production use.
 * Dated snapshot IDs are intentionally excluded until explicitly verified here.
 */
export const O200K_BASE_VENDOR_MODEL_ALLOWLIST = [
  "gpt-4o-mini",
  "gpt-4o",
] as const;

export type O200kBaseVendorModelId =
  (typeof O200K_BASE_VENDOR_MODEL_ALLOWLIST)[number];

/**
 * Authoritative registry. Every InternalModelKey must appear exactly once.
 * Provider dispatch, tokenization, and reservation all resolve through this.
 */
export const VERIFIED_MODEL_ENCODING_REGISTRY: Record<
  InternalModelKey,
  VerifiedModelMapping
> = {
  "flux-fast": {
    internalModelKey: "flux-fast",
    vendorModelId: "gpt-4o-mini",
    allowedVendorModelIds: O200K_BASE_VENDOR_MODEL_ALLOWLIST,
    encoding: "o200k_base",
  },
  "flux-standard": {
    internalModelKey: "flux-standard",
    vendorModelId: "gpt-4o-mini",
    allowedVendorModelIds: O200K_BASE_VENDOR_MODEL_ALLOWLIST,
    encoding: "o200k_base",
  },
  "flux-advanced": {
    internalModelKey: "flux-advanced",
    vendorModelId: "gpt-4o",
    allowedVendorModelIds: O200K_BASE_VENDOR_MODEL_ALLOWLIST,
    encoding: "o200k_base",
  },
};

const INTERNAL_MODEL_KEYS = Object.keys(
  VERIFIED_MODEL_ENCODING_REGISTRY,
) as InternalModelKey[];

export function listInternalModelKeys(): readonly InternalModelKey[] {
  return INTERNAL_MODEL_KEYS;
}

/**
 * Runtime type guard for InternalModelKey.
 * Prefer this over TypeScript casts for accounting/security boundaries.
 */
export function isInternalModelKey(value: unknown): value is InternalModelKey {
  return (
    typeof value === "string" &&
    (INTERNAL_MODEL_KEYS as readonly string[]).includes(value)
  );
}


export function isO200kBaseVendorModelId(
  vendorModelId: string,
): vendorModelId is O200kBaseVendorModelId {
  return (O200K_BASE_VENDOR_MODEL_ALLOWLIST as readonly string[]).includes(
    vendorModelId,
  );
}

/**
 * Look up the verified registry entry for an internal model key.
 * Unknown keys fail closed (no silent fallback).
 */
export function getVerifiedModelMapping(
  internalModelKey: InternalModelKey,
): VerifiedModelMapping {
  const mapping = VERIFIED_MODEL_ENCODING_REGISTRY[internalModelKey];
  if (!mapping) {
    throw new AIProviderConfigError(
      `No verified model/encoding registry entry for internal key "${internalModelKey}".`,
    );
  }
  return mapping;
}

/**
 * Resolve and validate the vendor model ID for an internal key.
 * Env overrides must be in the per-key allowlist (verified encoding).
 */
export function resolveVerifiedVendorModelId(
  internalModelKey: InternalModelKey,
  configuredVendorModelId?: string | null,
): string {
  const mapping = getVerifiedModelMapping(internalModelKey);
  const vendorModelId =
    configuredVendorModelId?.trim() || mapping.vendorModelId;

  if (!mapping.allowedVendorModelIds.includes(vendorModelId)) {
    throw new AIProviderConfigError(
      `Vendor model "${vendorModelId}" is not allowlisted for internal key "${internalModelKey}". ` +
        `Allowed (encoding=${mapping.encoding}): ${mapping.allowedVendorModelIds.join(", ")}.`,
    );
  }

  if (mapping.encoding !== "o200k_base") {
    // Future encodings must be wired explicitly — never guess o200k_base.
    throw new AIProviderConfigError(
      `Internal key "${internalModelKey}" maps to unsupported encoding "${mapping.encoding}".`,
    );
  }

  if (mapping.encoding === "o200k_base" && !isO200kBaseVendorModelId(vendorModelId)) {
    throw new AIProviderConfigError(
      `Vendor model "${vendorModelId}" is not verified for o200k_base.`,
    );
  }

  return vendorModelId;
}

/**
 * Resolve the tokenizer encoding for an internal model key.
 * Fails closed when the registry entry is missing or encoding is unverified.
 */
export function resolveVerifiedTokenizerEncoding(
  internalModelKey: InternalModelKey,
): VerifiedTokenizerEncoding {
  const mapping = getVerifiedModelMapping(internalModelKey);
  if (mapping.encoding !== "o200k_base") {
    throw new AIProviderConfigError(
      `No verified tokenizer encoding for internal key "${internalModelKey}" ` +
        `(registry encoding="${mapping.encoding}"). Failing closed.`,
    );
  }
  return mapping.encoding;
}

/**
 * Enforce that an internal model key is verified for o200k_base.
 * Used by the tokenizer — must not be a no-op.
 */
export function assertO200kModel(internalModelKey: InternalModelKey): void {
  const encoding = resolveVerifiedTokenizerEncoding(internalModelKey);
  if (encoding !== "o200k_base") {
    throw new AIProviderConfigError(
      `Internal model "${internalModelKey}" is not verified for o200k_base.`,
    );
  }
}

/**
 * Resolve the full verified mapping for provider + tokenizer + reservation.
 * Ensures vendor ID and encoding are consistent for the same internal key.
 */
export function resolveVerifiedModelBinding(
  internalModelKey: InternalModelKey,
  configuredVendorModelId?: string | null,
): VerifiedModelMapping {
  const mapping = getVerifiedModelMapping(internalModelKey);
  const vendorModelId = resolveVerifiedVendorModelId(
    internalModelKey,
    configuredVendorModelId,
  );
  const encoding = resolveVerifiedTokenizerEncoding(internalModelKey);
  return {
    ...mapping,
    vendorModelId,
    encoding,
  };
}

/** Default vendor model IDs derived from the registry (single source of truth). */
export function defaultVerifiedVendorModelIds(): Record<
  InternalModelKey,
  string
> {
  return {
    "flux-fast": VERIFIED_MODEL_ENCODING_REGISTRY["flux-fast"].vendorModelId,
    "flux-standard":
      VERIFIED_MODEL_ENCODING_REGISTRY["flux-standard"].vendorModelId,
    "flux-advanced":
      VERIFIED_MODEL_ENCODING_REGISTRY["flux-advanced"].vendorModelId,
  };
}

/**
 * Validate a complete internal→vendor map (e.g. from env/config).
 * Returns the validated map or throws AIProviderConfigError.
 */
export function resolveVerifiedVendorModelIds(
  configured: Partial<Record<InternalModelKey, string | null | undefined>>,
): Record<InternalModelKey, string> {
  const resolved = {} as Record<InternalModelKey, string>;
  for (const key of INTERNAL_MODEL_KEYS) {
    resolved[key] = resolveVerifiedVendorModelId(key, configured[key]);
  }
  return resolved;
}
