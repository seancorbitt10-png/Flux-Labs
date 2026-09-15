/**
 * Shared Study turn execution (post-auth).
 *
 * Used by:
 *   - sendStudyTurnAction (after requireUserId + rate limit)
 *   - production Study-path smoke harness (after creating an isolated actor)
 *
 * Keeps validation, intent composition, learning-intent cueing, and
 * runAIOrchestration on one path — no smoke-only orchestration fork.
 */

import { z } from "zod";
import { runAIOrchestration } from "@/lib/ai/orchestration";
import type { OrchestrationProposalSummary } from "@/lib/ai/types";
import { toClientError } from "@/lib/errors";
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
      modelKey: string;
      usage: {
        inputTokens?: number;
        outputTokens?: number;
        estimatedCostMicros: number;
        latencyMs: number;
      };
      proposals: OrchestrationProposalSummary[];
    }
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
    conceptIds: z
      .array(z.string().trim().min(1).max(64))
      .max(MAX_CONCEPT_IDS)
      .optional(),
    classId: z.string().trim().min(1).max(64).optional(),
    taskId: z.string().trim().min(1).max(64).optional(),
    priorTurns: z.array(priorTurnSchema).max(MAX_PRIOR_TURNS).optional(),
  })
  .strict();

/**
 * Execute one Study turn for an already-authenticated actor.
 *
 * Caller supplies actorUserId from session (UI) or an isolated smoke identity
 * created server-side. Clients/smoke cannot inject userId into `raw`.
 */
export async function executeStudyTurnForActor(args: {
  actorUserId: string;
  raw: Record<string, unknown>;
}): Promise<StudyTurnResult> {
  try {
    if (!args.actorUserId || typeof args.actorUserId !== "string") {
      return { ok: false, message: "Authenticated actor is required." };
    }

    // Reject client-supplied identity / authority bags before parsing.
    assertNoClientStudyAuthority(args.raw);
    if (
      "userId" in args.raw ||
      "actorUserId" in args.raw ||
      "sessionUserId" in args.raw
    ) {
      return { ok: false, message: "Client cannot supply user identity." };
    }

    const parsed = studyTurnSchema.safeParse(args.raw);
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

    if (composedMessage.length > MAX_COMPOSED_MESSAGE) {
      return { ok: false, message: "Message is too long." };
    }

    const result = await runAIOrchestration({
      actorUserId: args.actorUserId,
      userMessage: composedMessage,
      conceptIds: parsed.data.conceptIds,
      classId: parsed.data.classId,
      taskId: parsed.data.taskId,
      priorTurns: parsed.data.priorTurns,
      learningIntent: intent,
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
      modelKey: result.modelKey,
      usage: result.usage,
      proposals: result.proposals,
    };
  } catch (error) {
    const client = toClientError(error);
    return { ok: false, message: client.message };
  }
}
