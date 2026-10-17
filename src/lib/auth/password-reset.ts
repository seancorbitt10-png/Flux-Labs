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

export function publicHttpsBaseUrl(env: EnvLookup = process.env): string | null {
  const baseUrl = (env.AUTH_URL || env.NEXTAUTH_URL || "").replace(/\/$/, "");
  if (!baseUrl.startsWith("https://")) return null;
  return baseUrl;
}
