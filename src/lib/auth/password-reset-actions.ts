"use server";

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { getRequestIp } from "@/lib/security/request-ip";
import {
  PASSWORD_RESET_REQUEST_MESSAGE,
  PASSWORD_RESET_TTL_MS,
  hashPasswordResetToken,
  passwordResetIdentifier,
  publicHttpsBaseUrl,
  resetEmailConfigured,
} from "@/lib/auth/password-reset";

export type ResetResult = { ok: boolean; message: string };

class PasswordResetTokenError extends Error {
  constructor() {
    super("invalid-or-expired-reset-token");
    this.name = "PasswordResetTokenError";
  }
}

async function resolveRateLimitIp(): Promise<string> {
  try {
    return await getRequestIp();
  } catch {
    return "unknown";
  }
}

export async function requestPasswordReset(
  _prev: ResetResult | null,
  formData: FormData,
): Promise<ResetResult> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  try {
    const ip = await resolveRateLimitIp();
    assertRateLimit(`password-reset:ip:${ip}`, {
      limit: 5,
      windowMs: 60 * 60_000,
    });
    assertRateLimit(`password-reset:email:${email}`, {
      limit: 3,
      windowMs: 60 * 60_000,
    });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
      return { ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE };
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
    if (!user?.email || !resetEmailConfigured()) {
      return { ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE };
    }

    const token = randomBytes(32).toString("base64url");
    const identifier = passwordResetIdentifier(email);
    const hashedToken = hashPasswordResetToken(token);
    const expires = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    await prisma.verificationToken.deleteMany({ where: { identifier } });
    await prisma.verificationToken.create({
      data: { identifier, token: hashedToken, expires },
    });

    const baseUrl = publicHttpsBaseUrl();
    if (!baseUrl) {
      await prisma.verificationToken.deleteMany({
        where: { identifier, token: hashedToken },
      });
      return { ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE };
    }

    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    const apiKey = process.env.RESEND_API_KEY!.trim();
    const from = process.env.RESET_EMAIL_FROM!.trim();
    let sent = false;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "Reset your Flux Labs password",
          text:
            `We received a request to reset your Flux Labs password. This link expires in 30 minutes and can only be used once: ${resetUrl}\n\n` +
            `If you did not request this, you can ignore this email.`,
        }),
        cache: "no-store",
      });
      sent = response.ok;
    } catch {
      sent = false;
    }
    if (!sent) {
      await prisma.verificationToken.deleteMany({
        where: { identifier, token: hashedToken },
      });
    }
    return { ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE };
  } catch {
    return { ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE };
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
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !token ||
    password.length < 8 ||
    password.length > 72
  ) {
    return {
      ok: false,
      message:
        "Enter a valid token and a password between 8 and 72 characters.",
    };
  }
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
