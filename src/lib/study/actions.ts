"use server";

import { z } from "zod";
import { requireUserId } from "@/lib/auth/session";
import { runAIOrchestration } from "@/lib/ai/orchestration";
import {
  confirmAIProposal,
  rejectAIProposal,
  type IngestedProposalView,
} from "@/lib/ai/proposals";
import type { OrchestrationProposalSummary } from "@/lib/ai/types";
import { toClientError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { getStudyBootstrap, type StudyBootstrap } from "./bootstrap";
import { assertNoClientStudyAuthority } from "./client-guards";
import {
  composeStudyUserMessage,
  MAX_STUDY_MESSAGE,
  parseStudyIntent,
  type StudyIntent,
} from "./intents";

/** Must match orchestration MAX_USER_MESSAGE_CHARS. */
const MAX_COMPOSED_MESSAGE = 4000;
const MAX_FOCUS_LABEL = 120;
const MAX_PRIOR_TURNS = 8;
const MAX_PRIOR_TURN_CHARS = 2000;
const MAX_CONCEPT_IDS = 5;

export type StudyTurnResult =
  | {
      ok: true;
      reply: string;
      assistanceMode: string;
      taskType: string;
      requiresStudentParticipation: boolean;
      replyTruncated: boolean;
      contextVersion: string;
      composedMessage: string;
      intent: StudyIntent;
      proposals: OrchestrationProposalSummary[];
    }
  | { ok: false; message: string };

export type StudyActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; message: string };

const priorTurnSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(MAX_PRIOR_TURN_CHARS),
  })
  .strict();

const studyTurnSchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1, "Enter a message")
      .max(MAX_STUDY_MESSAGE, "Message is too long"),
    intent: z.string().trim().min(1).max(40),
    focusLabel: z.string().trim().max(MAX_FOCUS_LABEL).optional().nullable(),
    conceptIds: z.array(z.string().trim().min(1).max(64)).max(MAX_CONCEPT_IDS).optional(),
    classId: z.string().trim().min(1).max(64).optional(),
    taskId: z.string().trim().min(1).max(64).optional(),
    priorTurns: z.array(priorTurnSchema).max(MAX_PRIOR_TURNS).optional(),
  })
  .strict();

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
 */
export async function sendStudyTurnAction(
  raw: Record<string, unknown>,
): Promise<StudyTurnResult> {
  try {
    const userId = await requireUserId();
    assertRateLimit(`ai:${userId}`, { limit: 30, windowMs: 60_000 });

    assertNoClientStudyAuthority(raw);

    const parsed = studyTurnSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "Invalid study request.",
      };
    }

    const intent = parseStudyIntent(parsed.data.intent);
    const composedMessage = composeStudyUserMessage({
      intent,
      message: parsed.data.message,
      focusLabel: parsed.data.focusLabel,
    });

    // Reject before orchestration so framing never bypasses the 4k provider cap.
    if (composedMessage.length > MAX_COMPOSED_MESSAGE) {
      return { ok: false, message: "Message is too long." };
    }

    const result = await runAIOrchestration({
      actorUserId: userId,
      userMessage: composedMessage,
      conceptIds: parsed.data.conceptIds,
      classId: parsed.data.classId,
      taskId: parsed.data.taskId,
      priorTurns: parsed.data.priorTurns,
    });

    return {
      ok: true,
      reply: result.reply,
      assistanceMode: result.assistanceMode,
      taskType: result.taskType,
      requiresStudentParticipation: result.requiresStudentParticipation,
      replyTruncated: result.replyTruncated,
      contextVersion: result.contextVersion,
      composedMessage,
      intent,
      proposals: result.proposals,
    };
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
