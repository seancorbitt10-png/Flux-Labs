"use server";

import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { RateLimitError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { getRequestIp } from "@/lib/security/request-ip";
import {
  PASSWORD_RESET_REQUEST_MESSAGE,
  PASSWORD_RESET_TTL_MS,
  buildPasswordResetUrl,
  hashPasswordResetToken,
  passwordResetIdentifier,
  resolveResetEmailConfig,
} from "@/lib/auth/password-reset";
import {
  describeThrown,
  emailCorrelationRef,
  hostOf,
  logPasswordReset,
  type PasswordResetLogEntry,
  type TokenDisposition,
} from "@/lib/auth/password-reset-diagnostics";
import { validatePasswordResetSubmission } from "@/lib/auth/password-reset-validation";
import { sendPasswordResetEmail } from "@/lib/auth/password-reset-email";

export type ResetResult = { ok: boolean; message: string };

class PasswordResetTokenError extends Error {
  constructor() {
    super("invalid-or-expired-reset-token");
    this.name = "PasswordResetTokenError";
  }
}

async function resolveRateLimitIp(): Promise<{ ip: string; known: boolean }> {
  try {
    const ip = await getRequestIp();
    return { ip, known: ip !== "unknown" };
  } catch {
    return { ip: "unknown", known: false };
  }
}

function withinRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): boolean {
  try {
    assertRateLimit(key, options);
    return true;
  } catch (error) {
    if (error instanceof RateLimitError) return false;
    throw error;
  }
}

/**
 * Always resolves with the same public message so responses never reveal
 * whether an account exists. Every exit emits one safe diagnostic log entry
 * (see password-reset-diagnostics.ts) for operators.
 */
export async function requestPasswordReset(
  _prev: ResetResult | null,
  formData: FormData,
): Promise<ResetResult> {
  const generic: ResetResult = {
    ok: true,
    message: PASSWORD_RESET_REQUEST_MESSAGE,
  };
  const startedAt = Date.now();
  const requestId = randomUUID();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const emailRef = emailCorrelationRef(email, process.env.AUTH_SECRET);
  const log = (
    entry: Omit<PasswordResetLogEntry, "requestId" | "emailRef" | "latencyMs">,
  ) =>
    logPasswordReset({
      ...entry,
      requestId,
      emailRef,
      latencyMs: Date.now() - startedAt,
    });

  try {
    const { ip, known: ipKnown } = await resolveRateLimitIp();
    if (
      !withinRateLimit(`password-reset:ip:${ip}`, {
        limit: 5,
        windowMs: 60 * 60_000,
      })
    ) {
      log({
        outcome: "rate_limited",
        rateLimitScope: "ip",
        ipKnown,
        token: "not_created",
        certainty: "not_sent",
      });
      return generic;
    }
    if (
      !withinRateLimit(`password-reset:email:${email}`, {
        limit: 3,
        windowMs: 60 * 60_000,
      })
    ) {
      log({
        outcome: "rate_limited",
        rateLimitScope: "email",
        ipKnown,
        token: "not_created",
        certainty: "not_sent",
      });
      return generic;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
      log({
        outcome: "invalid_email_input",
        token: "not_created",
        certainty: "not_sent",
      });
      return generic;
    }

    const config = resolveResetEmailConfig();
    if (!config.ok) {
      log({
        outcome: config.reason,
        token: "not_created",
        certainty: "not_sent",
      });
      return generic;
    }
    const baseInfo = {
      baseHost: hostOf(config.baseUrl),
      baseUrlSource: config.baseUrlSource,
    };

    let user: { id: string; email: string | null } | null;
    try {
      user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true },
      });
    } catch (error) {
      log({
        outcome: "lookup_failed",
        token: "not_created",
        certainty: "not_sent",
        ...baseInfo,
        ...describeThrown(error),
      });
      return generic;
    }
    if (!user?.email) {
      log({
        outcome: "account_not_found",
        token: "not_created",
        certainty: "not_sent",
        ...baseInfo,
      });
      return generic;
    }

    const token = randomBytes(32).toString("base64url");
    const identifier = passwordResetIdentifier(email);
    const hashedToken = hashPasswordResetToken(token);
    const expires = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    try {
      await prisma.verificationToken.deleteMany({ where: { identifier } });
      await prisma.verificationToken.create({
        data: { identifier, token: hashedToken, expires },
      });
    } catch (error) {
      log({
        outcome: "token_persist_failed",
        token: "not_created",
        certainty: "not_sent",
        ...baseInfo,
        ...describeThrown(error),
      });
      return generic;
    }

    const resetUrl = buildPasswordResetUrl(config.baseUrl, token, email);
    const result = await sendPasswordResetEmail({
      apiKey: config.apiKey,
      from: config.from,
      to: email,
      resetUrl,
    });

    switch (result.kind) {
      case "accepted":
        log({
          outcome: "resend_accepted",
          certainty: "accepted",
          token: "retained",
          httpStatus: result.httpStatus,
          resendMessageId: result.messageId,
          ...baseInfo,
        });
        return generic;

      case "rejected": {
        // Definitive: Resend declined, nothing was queued, the link was never
        // delivered. Remove the unused token.
        let disposition: TokenDisposition = "deleted";
        try {
          await prisma.verificationToken.deleteMany({
            where: { identifier, token: hashedToken },
          });
        } catch (error) {
          disposition = "cleanup_failed";
          log({
            outcome: "token_cleanup_failed",
            certainty: "rejected",
            token: disposition,
            ...baseInfo,
            ...describeThrown(error),
          });
        }
        log({
          outcome: "resend_rejected",
          certainty: "rejected",
          token: disposition,
          httpStatus: result.httpStatus,
          resendErrorName: result.errorName,
          resendErrorMessage: result.errorMessage,
          ...baseInfo,
        });
        return generic;
      }

      case "unavailable":
        // Ambiguous: a 5xx does not prove Resend did not queue the email.
        // Keep the (hashed, expiring, single-use) token so a delivered link
        // still works.
        log({
          outcome: "resend_unavailable",
          certainty: "ambiguous",
          token: "retained",
          httpStatus: result.httpStatus,
          resendErrorName: result.errorName,
          resendErrorMessage: result.errorMessage,
          ...baseInfo,
        });
        return generic;

      case "timeout":
        log({
          outcome: "resend_timeout",
          certainty: "ambiguous",
          token: "retained",
          ...baseInfo,
        });
        return generic;

      case "network_error":
        log({
          outcome: "resend_network_error",
          certainty: "ambiguous",
          token: "retained",
          ...baseInfo,
          errorName: result.errorName,
          errorCode: result.errorCode,
        });
        return generic;
    }
  } catch (error) {
    log({ outcome: "unexpected_error", ...describeThrown(error) });
    return generic;
  }
}

export async function resetPassword(
  _prev: ResetResult | null,
  formData: FormData,
): Promise<ResetResult> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const invalid = validatePasswordResetSubmission({
    email,
    token,
    password,
    confirmPassword,
  });
  if (invalid) return { ok: false, message: invalid };
  try {
    const identifier = passwordResetIdentifier(email);
    const hashedToken = hashPasswordResetToken(token);
    // Hash before opening the transaction so bcrypt latency does not hold
    // the token row lock. Concurrent callers still serialize on FOR UPDATE.
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ identifier: string; token: string; expires: Date }>
      >`
        SELECT identifier, token, expires
        FROM verification_tokens
        WHERE identifier = ${identifier} AND token = ${hashedToken}
        FOR UPDATE
      `;
      const record = locked[0];
      if (!record || record.expires.getTime() <= Date.now()) {
        throw new PasswordResetTokenError();
      }
      const user = await tx.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (!user) throw new PasswordResetTokenError();
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      const consumed = await tx.verificationToken.deleteMany({
        where: { identifier, token: hashedToken },
      });
      if (consumed.count !== 1) {
        throw new PasswordResetTokenError();
      }
    });
    return {
      ok: true,
      message: "Password updated. You can now sign in with your new password.",
    };
  } catch (error) {
    if (error instanceof PasswordResetTokenError) {
      return {
        ok: false,
        message: "This reset link is invalid or expired. Request a new one.",
      };
    }
    return {
      ok: false,
      message: "We couldn't reset your password. Request a new link and try again.",
    };
  }
}
