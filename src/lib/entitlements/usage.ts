import type { UsageCapability } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export type RecordUsageInput = {
  userId: string;
  capability: UsageCapability;
  feature: string;
  aiTaskType?: string;
  modelKey?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostMicros?: number;
  latencyMs?: number;
  success?: boolean;
  errorCode?: string;
  metadata?: object;
};

/**
 * Persist operational usage telemetry and increment trial counters.
 * Does not store student educational content.
 */
export async function recordUsage(input: RecordUsageInput): Promise<void> {
  const cost = input.estimatedCostMicros ?? 0;

  await prisma.$transaction(async (tx) => {
    await tx.usageRecord.create({
      data: {
        userId: input.userId,
        capability: input.capability,
        feature: input.feature,
        aiTaskType: input.aiTaskType,
        modelKey: input.modelKey,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        estimatedCostMicros: cost,
        latencyMs: input.latencyMs,
        success: input.success ?? true,
        errorCode: input.errorCode,
        metadata: input.metadata,
      },
    });

    if (input.success === false) return;

    const trial = await tx.trial.findFirst({
      where: { userId: input.userId, expiredAt: null },
      orderBy: { startedAt: "desc" },
    });

    if (!trial) return;

    const data: {
      aiSessionsUsed?: { increment: number };
      documentAnalysesUsed?: { increment: number };
      advancedTutoringUsed?: { increment: number };
      estimatedCostMicros?: { increment: number };
    } = {
      estimatedCostMicros: { increment: cost },
    };

    if (input.capability === "AI_SESSION") {
      data.aiSessionsUsed = { increment: 1 };
    } else if (input.capability === "DOCUMENT_ANALYSIS") {
      data.documentAnalysesUsed = { increment: 1 };
    } else if (input.capability === "ADVANCED_TUTORING") {
      data.advancedTutoringUsed = { increment: 1 };
    }

    await tx.trial.update({
      where: { id: trial.id },
      data,
    });
  });
}
