/**
 * Safe operational diagnostics for the password-reset request pipeline.
 *
 * Allowed: fixed outcome categories, per-request id, keyed email reference,
 * HTTP status, Resend error name + sanitized message, Resend message id,
 * latency, Prisma error code, public hostname of the reset base URL.
 *
 * Forbidden (never accepted by the log shape): email addresses, API keys,
 * Authorization headers, reset tokens, reset URLs, passwords, raw provider
 * bodies, raw error messages (Prisma messages can embed query arguments).
 */

import { createHmac } from "node:crypto";
import type { ResetEmailConfigFailure } from "./password-reset";

export type PasswordResetOutcome =
  | ResetEmailConfigFailure
  | "invalid_email_input"
  | "rate_limited"
  | "account_not_found"
  | "lookup_failed"
  | "token_persist_failed"
  | "token_cleanup_failed"
  | "resend_accepted"
  | "resend_rejected"
  | "resend_unavailable"
  | "resend_timeout"
  | "resend_network_error"
  | "unexpected_error";

export type TokenDisposition =
  "not_created" | "retained" | "deleted" | "cleanup_failed";

/** Whether the email may nevertheless have been accepted by Resend. */
export type SendCertainty = "not_sent" | "rejected" | "accepted" | "ambiguous";

export type PasswordResetLogEntry = {
  outcome: PasswordResetOutcome;
  requestId: string;
  emailRef?: string | null;
  certainty?: SendCertainty;
  token?: TokenDisposition;
  httpStatus?: number;
  resendErrorName?: string;
  resendErrorMessage?: string;
  resendMessageId?: string;
  rateLimitScope?: "ip" | "email";
  ipKnown?: boolean;
  baseHost?: string;
  baseUrlSource?: "auth_url" | "nextauth_url" | "vercel_production_url";
  errorName?: string;
  errorCode?: string;
  latencyMs?: number;
};

const LOG_PREFIX = "[flux-password-reset]";

const WARN_OUTCOMES: ReadonlySet<PasswordResetOutcome> = new Set([
  "rate_limited",
  "resend_rejected",
  "resend_unavailable",
  "resend_timeout",
  "resend_network_error",
]);

const ERROR_OUTCOMES: ReadonlySet<PasswordResetOutcome> = new Set([
  "config_missing_api_key",
  "config_missing_from",
  "config_invalid_from",
  "config_missing_base_url",
  "config_base_url_not_https",
  "config_base_url_invalid",
  "lookup_failed",
  "token_persist_failed",
  "token_cleanup_failed",
  "unexpected_error",
]);

/**
 * Keyed correlation reference for an email address. HMAC-SHA256 with
 * AUTH_SECRET, truncated. Returns null when no secret is available — an
 * unkeyed hash of an email is guessable, so none is emitted.
 */
export function emailCorrelationRef(
  email: string,
  secret: string | undefined,
): string | null {
  const key = secret?.trim();
  if (!key) return null;
  return createHmac("sha256", key)
    .update(`password-reset-ref:${email.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 12);
}

const MAX_DIAGNOSTIC_TEXT = 200;

/**
 * Reduces provider-supplied text to a short, redacted single line.
 * Removes email addresses, URLs, Resend-style keys, and long opaque tokens.
 */
export function sanitizeDiagnosticText(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  let text = input
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[^\s@<>"']+@[^\s@<>"']+/g, "[email]")
    .replace(/\bre_[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  if (text.length > MAX_DIAGNOSTIC_TEXT) {
    text = `${text.slice(0, MAX_DIAGNOSTIC_TEXT - 1)}…`;
  }
  return text;
}

/** Resend error `name` values are snake_case identifiers; reject anything else. */
export function sanitizeErrorName(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(input) ? input : undefined;
}

/** Safe, bounded classification of a thrown value for logging. */
export function describeThrown(error: unknown): {
  errorName: string;
  errorCode?: string;
} {
  const errorName =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)
      ? error.name
      : "UnknownError";
  const candidates: unknown[] = [
    (error as { code?: unknown } | null)?.code,
    (error as { cause?: { code?: unknown } } | null)?.cause?.code,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^[A-Z0-9_]{1,40}$/.test(candidate)) {
      return { errorName, errorCode: candidate };
    }
  }
  return { errorName };
}

function pickBaseHost(host: string | undefined): string | undefined {
  if (!host) return undefined;
  return /^[A-Za-z0-9.-]{1,253}$/.test(host) ? host.toLowerCase() : undefined;
}

/** Hostname only — never the full URL, path, or query. */
export function hostOf(baseUrl: string): string | undefined {
  try {
    return pickBaseHost(new URL(baseUrl).hostname);
  } catch {
    return undefined;
  }
}

/** Emit one structured log line. Never throws. */
export function logPasswordReset(entry: PasswordResetLogEntry): void {
  try {
    const line = JSON.stringify({
      event: "password_reset_request",
      outcome: entry.outcome,
      requestId: entry.requestId,
      emailRef: entry.emailRef ?? undefined,
      certainty: entry.certainty,
      token: entry.token,
      httpStatus: entry.httpStatus,
      resendErrorName: sanitizeErrorName(entry.resendErrorName),
      resendErrorMessage: sanitizeDiagnosticText(entry.resendErrorMessage),
      resendMessageId: sanitizeMessageId(entry.resendMessageId),
      rateLimitScope: entry.rateLimitScope,
      ipKnown: entry.ipKnown,
      baseHost: pickBaseHost(entry.baseHost),
      baseUrlSource: entry.baseUrlSource,
      errorName: entry.errorName,
      errorCode: entry.errorCode,
      latencyMs: entry.latencyMs,
    });
    if (ERROR_OUTCOMES.has(entry.outcome)) {
      console.error(LOG_PREFIX, line);
    } else if (WARN_OUTCOMES.has(entry.outcome)) {
      console.warn(LOG_PREFIX, line);
    } else {
      console.info(LOG_PREFIX, line);
    }
  } catch {
    // Logging must never affect the public response.
  }
}

/** Resend message ids are UUIDs. */
function sanitizeMessageId(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  return /^[0-9a-fA-F-]{8,64}$/.test(input) ? input : undefined;
}
