import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/auth/session";
import { runAIOrchestration } from "@/lib/ai/orchestration";
import { toClientError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/security/rate-limit";

const bodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
});

/**
 * Lightweight orchestration ping for integration checks.
 * Does not expose model provider details beyond internal task metadata.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    assertRateLimit(`ai:${userId}`, { limit: 30, windowMs: 60_000 });

    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "Invalid request" },
        { status: 400 },
      );
    }

    const result = await runAIOrchestration({
      userId,
      userMessage: parsed.data.message,
    });

    return NextResponse.json({
      reply: result.reply,
      taskType: result.taskType,
      assistanceMode: result.assistanceMode,
      requiresStudentParticipation: result.requiresStudentParticipation,
    });
  } catch (error) {
    const client = toClientError(error);
    return NextResponse.json(
      { error: client.error, message: client.message },
      { status: client.status },
    );
  }
}
