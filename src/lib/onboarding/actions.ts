"use server";

import { z } from "zod";
import { requireUserId } from "@/lib/auth/session";
import { toClientError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/security/rate-limit";
import {
  completeOnboardingSession,
  dismissOnboardingSession,
  getOnboardingBootstrap,
  submitOnboardingAnswer,
  type OnboardingBootstrap,
} from "./session";
import { assertNoClientOnboardingAuthority } from "./client-guards";

export type OnboardingActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export async function bootstrapOnboardingAction(input?: {
  ensureSession?: boolean;
}): Promise<OnboardingActionResult<OnboardingBootstrap>> {
  try {
    const userId = await requireUserId();
    assertRateLimit(`onboarding:bootstrap:${userId}`, {
      limit: 60,
      windowMs: 60_000,
    });

    const data = await getOnboardingBootstrap({
      actorUserId: userId,
      userId,
      ensureSession: input?.ensureSession ?? true,
    });
    return { ok: true, data };
  } catch (error) {
    const client = toClientError(error);
    return { ok: false, message: client.message };
  }
}

const submitSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(64),
    questionId: z.string().trim().min(1).max(120),
    skipped: z.boolean().optional(),
    answer: z.unknown().optional(),
  })
  .strict();

export async function submitOnboardingAnswerAction(
  raw: Record<string, unknown>,
): Promise<
  OnboardingActionResult<{
    questionId: string;
    skipped: boolean;
    answer: unknown | null;
  }>
> {
  try {
    const userId = await requireUserId();
    assertRateLimit(`onboarding:submit:${userId}`, {
      limit: 120,
      windowMs: 60_000,
    });

    assertNoClientOnboardingAuthority(raw);

    const parsed = submitSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, message: "Invalid onboarding submission." };
    }

    const skipped = Boolean(parsed.data.skipped);
    if (!skipped && parsed.data.answer === undefined) {
      return {
        ok: false,
        message: "An answer is required unless the question is skipped.",
      };
    }

    const saved = await submitOnboardingAnswer({
      actorUserId: userId,
      userId,
      sessionId: parsed.data.sessionId,
      questionId: parsed.data.questionId,
      answer: parsed.data.answer,
      skipped,
    });

    return {
      ok: true,
      data: {
        questionId: saved.questionId,
        skipped: saved.skipped,
        answer: saved.skipped ? null : (saved.answerJson ?? null),
      },
    };
  } catch (error) {
    const client = toClientError(error);
    return { ok: false, message: client.message };
  }
}

const sessionIdSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(64),
  })
  .strict();

export async function completeOnboardingAction(
  raw: Record<string, unknown>,
): Promise<OnboardingActionResult<{ status: "COMPLETED" }>> {
  try {
    const userId = await requireUserId();
    assertRateLimit(`onboarding:complete:${userId}`, {
      limit: 20,
      windowMs: 60_000,
    });

    assertNoClientOnboardingAuthority(raw);
    const parsed = sessionIdSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, message: "Invalid onboarding session." };
    }

    await completeOnboardingSession({
      actorUserId: userId,
      userId,
      sessionId: parsed.data.sessionId,
    });

    return { ok: true, data: { status: "COMPLETED" } };
  } catch (error) {
    const client = toClientError(error);
    return { ok: false, message: client.message };
  }
}

export async function dismissOnboardingAction(
  raw: Record<string, unknown>,
): Promise<OnboardingActionResult<{ status: "DISMISSED" }>> {
  try {
    const userId = await requireUserId();
    assertRateLimit(`onboarding:dismiss:${userId}`, {
      limit: 20,
      windowMs: 60_000,
    });

    assertNoClientOnboardingAuthority(raw);
    const parsed = sessionIdSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, message: "Invalid onboarding session." };
    }

    await dismissOnboardingSession({
      actorUserId: userId,
      userId,
      sessionId: parsed.data.sessionId,
    });

    return { ok: true, data: { status: "DISMISSED" } };
  } catch (error) {
    const client = toClientError(error);
    return { ok: false, message: client.message };
  }
}
