"use server";

import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { getRequestIp } from "@/lib/security/request-ip";

export type ResetResult = { ok: boolean; message: string };

const genericRequestMessage =
  "If an account exists for that email, a password reset link will be sent.";

function digest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function requestPasswordReset(
  _prev: ResetResult | null,
  formData: FormData,
): Promise<ResetResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  try {
    const ip = await getRequestIp();
    assertRateLimit(`password-reset:ip:${ip}`, { limit: 5, windowMs: 60 * 60_000 });
    assertRateLimit(`password-reset:email:${email}`, { limit: 3, windowMs: 60 * 60_000 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
      return { ok: true, message: genericRequestMessage };
    }

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
    if (!user?.email || !process.env.RESEND_API_KEY || !process.env.RESET_EMAIL_FROM) {
      return { ok: true, message: genericRequestMessage };
    }

    const token = randomBytes(32).toString("base64url");
    const identifier = `password-reset:${email}`;
    const expires = new Date(Date.now() + 30 * 60_000);
    await prisma.verificationToken.deleteMany({ where: { identifier } });
    await prisma.verificationToken.create({
      data: { identifier, token: digest(token), expires },
    });

    const baseUrl = (process.env.AUTH_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
    if (!baseUrl || !baseUrl.startsWith("https://")) {
      await prisma.verificationToken.deleteMany({ where: { identifier, token: digest(token) } });
      return { ok: true, message: genericRequestMessage };
    }
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESET_EMAIL_FROM,
        to: [email],
        subject: "Reset your Flux Labs password",
        text: `We received a request to reset your Flux Labs password. This link expires in 30 minutes and can only be used once: ${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      await prisma.verificationToken.deleteMany({ where: { identifier, token: digest(token) } });
    }
    return { ok: true, message: genericRequestMessage };
  } catch {
    return { ok: true, message: genericRequestMessage };
  }
}

export async function resetPassword(
  _prev: ResetResult | null,
  formData: FormData,
): Promise<ResetResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !token || password.length < 8 || password.length > 72) {
    return { ok: false, message: "Enter a valid token and a password between 8 and 72 characters." };
  }
  try {
    const identifier = `password-reset:${email}`;
    const hashedToken = digest(token);
    const record = await prisma.verificationToken.findFirst({
      where: { identifier, token: hashedToken, expires: { gt: new Date() } },
    });
    if (!record) return { ok: false, message: "This reset link is invalid or expired. Request a new one." };
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (!user) throw new Error("Invalid reset request");
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.verificationToken.deleteMany({ where: { identifier, token: hashedToken } });
    });
    return { ok: true, message: "Password updated. You can now sign in with your new password." };
  } catch {
    return { ok: false, message: "We couldn't reset your password. Request a new link and try again." };
  }
}
