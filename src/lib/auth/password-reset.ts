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
  | {
      ok: true;
      apiKey: string;
      from: string;
      baseUrl: string;
      baseUrlSource: ResetBaseUrlSource;
    }
  | { ok: false; reason: ResetEmailConfigFailure };

const BARE_ADDRESS = /^[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+$/;
const NAMED_ADDRESS = /^[^<>]+<[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+>$/;

/** Resend accepts `user@domain` or `Name <user@domain>` only. */
export function isValidResetEmailFrom(value: string): boolean {
  const trimmed = value.trim();
  return BARE_ADDRESS.test(trimmed) || NAMED_ADDRESS.test(trimmed);
}

export type ResetBaseUrlSource =
  "auth_url" | "nextauth_url" | "vercel_production_url";

type BaseUrlFailure = Extract<
  ResetEmailConfigFailure,
  | "config_missing_base_url"
  | "config_base_url_not_https"
  | "config_base_url_invalid"
>;

type BaseUrlEvaluation =
  | { url: string; source: ResetBaseUrlSource; failure: null }
  | { url: null; source: null; failure: BaseUrlFailure };

function parseHttpsOrigin(
  raw: string,
):
  | { ok: true; url: string; host: string }
  | { ok: false; failure: BaseUrlFailure } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, failure: "config_base_url_invalid" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, failure: "config_base_url_not_https" };
  }
  if (parsed.username || parsed.password || !parsed.hostname) {
    return { ok: false, failure: "config_base_url_invalid" };
  }
  return { ok: true, url: raw.replace(/\/+$/, ""), host: parsed.hostname };
}

/**
 * Vercel exposes the production domain as a bare host (no scheme).
 * Only honoured in the production environment.
 */
function vercelProductionBaseUrl(env: EnvLookup): string | null {
  if (env.VERCEL_ENV !== "production") return null;
  const host = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (!host) return null;
  const parsed = parseHttpsOrigin(
    host.includes("://") ? host : `https://${host}`,
  );
  return parsed.ok ? parsed.url : null;
}

function isVercelDeploymentHost(host: string): boolean {
  return host.toLowerCase().endsWith(".vercel.app");
}

/**
 * Reset links must point at the stable public site. An explicitly configured
 * AUTH_URL / NEXTAUTH_URL wins, except when it is a per-deployment
 * `*.vercel.app` host in production: those are immutable snapshots of an old
 * build, so the production domain is used instead when Vercel provides it.
 * The Host header of the incoming request is never consulted.
 */
function evaluateBaseUrl(env: EnvLookup): BaseUrlEvaluation {
  const authUrl = env.AUTH_URL?.trim();
  const nextAuthUrl = env.NEXTAUTH_URL?.trim();
  const raw = authUrl || nextAuthUrl || "";
  const source: ResetBaseUrlSource = authUrl ? "auth_url" : "nextauth_url";
  const production = vercelProductionBaseUrl(env);

  if (!raw) {
    if (production) {
      return {
        url: production,
        source: "vercel_production_url",
        failure: null,
      };
    }
    return { url: null, source: null, failure: "config_missing_base_url" };
  }

  const parsed = parseHttpsOrigin(raw);
  if (!parsed.ok) {
    if (production) {
      return {
        url: production,
        source: "vercel_production_url",
        failure: null,
      };
    }
    return { url: null, source: null, failure: parsed.failure };
  }

  if (
    production &&
    isVercelDeploymentHost(parsed.host) &&
    parsed.url !== production
  ) {
    return { url: production, source: "vercel_production_url", failure: null };
  }
  return { url: parsed.url, source, failure: null };
}

/** Which environment setting the reset-link base URL came from, if any. */
export function resetBaseUrlSource(
  env: EnvLookup = process.env,
): ResetBaseUrlSource | null {
  return evaluateBaseUrl(env).source;
}

/** Path of the public set-new-password page that reset emails link to. */
export const PASSWORD_RESET_PATH = "/reset-password";

export function buildPasswordResetUrl(
  baseUrl: string,
  token: string,
  email: string,
): string {
  return `${baseUrl.replace(/\/+$/, "")}${PASSWORD_RESET_PATH}?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
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
  if (base.failure !== null) {
    return { ok: false, reason: base.failure };
  }
  return {
    ok: true,
    apiKey,
    from,
    baseUrl: base.url,
    baseUrlSource: base.source,
  };
}
