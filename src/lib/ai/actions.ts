"use server";

import { z } from "zod";
import { requireUserId } from "@/lib/auth/session";
import { runAIOrchestration } from "@/lib/ai/orchestration";
import { toClientError } from "@/lib/errors";

const messageSchema = z
  .string()
  .trim()
  .min(1, "Enter a message")
  .max(4000, "Message is too long");

export type StudyActionResult =
  | {
      ok: true;
      reply: string;
      assistanceMode: string;
      taskType: string;
      requiresStudentParticipation: boolean;
    }
  | { ok: false; message: string };

export async function sendStudyMessage(
  _prev: StudyActionResult | null,
  formData: FormData,
): Promise<StudyActionResult> {
  try {
    const userId = await requireUserId();
    const parsed = messageSchema.safeParse(formData.get("message"));
    if (!parsed.success) {
      return {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "Invalid message",
      };
    }

    const result = await runAIOrchestration({
      userId,
      userMessage: parsed.data,
    });

    return {
      ok: true,
      reply: result.reply,
      assistanceMode: result.assistanceMode,
      taskType: result.taskType,
      requiresStudentParticipation: result.requiresStudentParticipation,
    };
  } catch (error) {
    const client = toClientError(error);
    return { ok: false, message: client.message };
  }
}
