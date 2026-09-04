"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { signIn, signOut } from "@/lib/auth";
import { registerSchema } from "@/lib/validation/auth";
import { provisionTrialEntitlement } from "@/lib/entitlements/check";
import { toClientError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { getRequestIp } from "@/lib/security/request-ip";

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

export async function registerAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const emailRaw = String(formData.get("email") ?? "");
    const ip = await getRequestIp();
    assertRateLimit(`register:ip:${ip}`, {
      limit: 10,
      windowMs: 60 * 60_000,
    });
    assertRateLimit(`register:${emailRaw.toLowerCase()}`, {
      limit: 5,
      windowMs: 15 * 60_000,
    });

    const parsed = registerSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
    });

    if (!parsed.success) {
      return {
        ok: false,
        message: "Please fix the highlighted fields.",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      };
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    try {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: parsed.data.name,
            email: parsed.data.email,
            passwordHash,
            studentProfile: {
              create: {
                displayName: parsed.data.name,
              },
            },
          },
        });

        await provisionTrialEntitlement(user.id, tx);

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: "user.registered",
            resource: "user",
            resourceId: user.id,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        // Do not reveal whether the email is already registered.
        return {
          ok: false,
          message:
            "Unable to create an account with those details. Try signing in, or use a different email.",
        };
      }
      throw error;
    }

    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/home",
    });

    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, message: "Unable to sign in after registration." };
    }
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    const client = toClientError(error);
    return { ok: false, message: client.message };
  }
}

export async function loginAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const emailRaw = String(formData.get("email") ?? "");
    const ip = await getRequestIp();
    assertRateLimit(`login:ip:${ip}`, {
      limit: 30,
      windowMs: 15 * 60_000,
    });
    assertRateLimit(`login:${emailRaw.toLowerCase()}`, {
      limit: 10,
      windowMs: 15 * 60_000,
    });

    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/home",
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, message: "Invalid email or password." };
    }
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    const client = toClientError(error);
    return { ok: false, message: client.message };
  }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
