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
    const record = await prisma.verificationToken.findFirst({
      where: { identifier, token: hashedToken, expires: { gt: new Date() } },
    });
    if (!record) {
      return {
        ok: false,
        message: "This reset link is invalid or expired. Request a new one.",
      };
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (!user) throw new Error("Invalid reset request");
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      await tx.verificationToken.deleteMany({
        where: { identifier, token: hashedToken },
      });
    });
    return {
      ok: true,
      message: "Password updated. You can now sign in with your new password.",
    };
  } catch {
    return {
      ok: false,
      message: "We couldn't reset your password. Request a new link and try again.",
    };
  }
}
