import { createHash } from "node:crypto";

export const PASSWORD_RESET_TTL_MS = 30 * 60_000;

export const PASSWORD_RESET_REQUEST_MESSAGE =
  "If an account exists for that email, a password reset link will be sent.";

export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function passwordResetIdentifier(email: string): string {
  return `password-reset:${email.trim().toLowerCase()}`;
}

type EnvLookup = Record<string, string | undefined>;

export function resetEmailConfigured(env: EnvLookup = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.RESET_EMAIL_FROM?.trim());
}

/**
 * Public https origin used to build reset links.
 * Trims whitespace, requires a parseable https URL without embedded
 * credentials, and strips trailing slashes. Returns null otherwise.
 */
export function publicHttpsBaseUrl(
  env: EnvLookup = process.env,
): string | null {
  return evaluateBaseUrl(env).url;
}

export type ResetEmailConfigFailure =
  | "config_missing_api_key"
  | "config_missing_from"
  | "config_invalid_from"
  | "config_missing_base_url"
  | "config_base_url_not_https"
  | "config_base_url_invalid";

export type ResetEmailConfig =
  | { ok: true; apiKey: string; from: string; baseUrl: string }
  | { ok: false; reason: ResetEmailConfigFailure };

const BARE_ADDRESS = /^[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+$/;
const NAMED_ADDRESS = /^[^<>]+<[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+>$/;

/** Resend accepts `user@domain` or `Name <user@domain>` only. */
export function isValidResetEmailFrom(value: string): boolean {
  const trimmed = value.trim();
  return BARE_ADDRESS.test(trimmed) || NAMED_ADDRESS.test(trimmed);
}

function evaluateBaseUrl(env: EnvLookup): {
  url: string | null;
  failure: Extract<
    ResetEmailConfigFailure,
    | "config_missing_base_url"
    | "config_base_url_not_https"
    | "config_base_url_invalid"
  > | null;
} {
  const raw = (env.AUTH_URL || env.NEXTAUTH_URL || "").trim();
  if (!raw) return { url: null, failure: "config_missing_base_url" };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { url: null, failure: "config_base_url_invalid" };
  }
  if (parsed.protocol !== "https:") {
    return { url: null, failure: "config_base_url_not_https" };
  }
  if (parsed.username || parsed.password || !parsed.hostname) {
    return { url: null, failure: "config_base_url_invalid" };
  }
  return { url: raw.replace(/\/+$/, ""), failure: null };
}

/**
 * Validates everything needed to send a reset email without touching the
 * network or database. Failure reasons are safe, fixed categories.
 */
export function resolveResetEmailConfig(
  env: EnvLookup = process.env,
): ResetEmailConfig {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "config_missing_api_key" };

  const from = env.RESET_EMAIL_FROM?.trim();
  if (!from) return { ok: false, reason: "config_missing_from" };
  if (!isValidResetEmailFrom(from)) {
    return { ok: false, reason: "config_invalid_from" };
  }

  const base = evaluateBaseUrl(env);
  if (!base.url) {
    return { ok: false, reason: base.failure ?? "config_base_url_invalid" };
  }
  return { ok: true, apiKey, from, baseUrl: base.url };
}
