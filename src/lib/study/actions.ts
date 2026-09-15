"use server";

import { z } from "zod";
import { requireUserId } from "@/lib/auth/session";
import {
  confirmAIProposal,
  rejectAIProposal,
  type IngestedProposalView,
} from "@/lib/ai/proposals";
import { toClientError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { getStudyBootstrap, type StudyBootstrap } from "./bootstrap";
import { assertNoClientStudyAuthority } from "./client-guards";
import {
  executeStudyTurnForActor,
  type StudyTurnResult,
} from "./execute-turn";

export type { StudyTurnResult };

export type StudyActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export async function loadStudyBootstrapAction(): Promise<
  StudyActionResult<StudyBootstrap>
> {
  try {
    const userId = await requireUserId();
    assertRateLimit(`study:bootstrap:${userId}`, {
      limit: 60,
      windowMs: 60_000,
    });
    const data = await getStudyBootstrap({
      actorUserId: userId,
      userId,
    });
    return { ok: true, data };
  } catch (error) {
    const client = toClientError(error);
    return { ok: false, message: client.message };
  }
}

/**
 * Study turn → authenticated orchestration. No direct Student Model writes.
 * Proposals (if any) remain PENDING until confirmed through proposal actions.
 *
 * Post-auth execution is shared with the operational Study-path smoke harness
 * via executeStudyTurnForActor (same validation + orchestration path).
 */
export async function sendStudyTurnAction(
  raw: Record<string, unknown>,
): Promise<StudyTurnResult> {
  try {
    const userId = await requireUserId();
    assertRateLimit(`ai:${userId}`, { limit: 30, windowMs: 60_000 });
    return executeStudyTurnForActor({ actorUserId: userId, raw });
  } catch (error) {
    const client = toClientError(error);
    return { ok: false, message: client.message };
  }
}

const proposalDecisionSchema = z
  .object({
    proposalId: z.string().trim().min(1).max(64),
  })
  .strict();

export async function confirmStudyProposalAction(
  raw: Record<string, unknown>,
): Promise<StudyActionResult<IngestedProposalView>> {
  try {
    const userId = await requireUserId();
    assertRateLimit(`study:proposal:${userId}`, {
      limit: 40,
      windowMs: 60_000,
    });
    assertNoClientStudyAuthority(raw);
    const parsed = proposalDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, message: "Invalid proposal confirmation." };
    }

    const data = await confirmAIProposal({
      actorUserId: userId,
      decision: { proposalId: parsed.data.proposalId },
    });
    return { ok: true, data };
  } catch (error) {
    const client = toClientError(error);
    return { ok: false, message: client.message };
  }
}

export async function rejectStudyProposalAction(
  raw: Record<string, unknown>,
): Promise<StudyActionResult<IngestedProposalView>> {
  try {
    const userId = await requireUserId();
    assertRateLimit(`study:proposal:${userId}`, {
      limit: 40,
      windowMs: 60_000,
    });
    assertNoClientStudyAuthority(raw);
    const parsed = proposalDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, message: "Invalid proposal rejection." };
    }

    const data = await rejectAIProposal({
      actorUserId: userId,
      decision: { proposalId: parsed.data.proposalId },
    });
    return { ok: true, data };
  } catch (error) {
    const client = toClientError(error);
    return { ok: false, message: client.message };
  }
}
