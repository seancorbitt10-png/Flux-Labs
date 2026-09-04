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
  /**
   * When true, capability counters were already incremented by reserveCapability.
   * Only write telemetry + apply cost micros.
   */
  capabilityReserved?: boolean;
};

/**
 * Persist operational usage telemetry.
 * Capability unit counters are reserved atomically before AI work;
 * this records the event and applies estimated cost.
 *
 * Soft budget is enforced at reservation time. After a successful reserve,
 * cost is always attributed so counters and usage_records stay consistent
 * (never throw away telemetry for an already-spent AI call).
 */
export async function recordUsage(input: RecordUsageInput): Promise<void> {
  const cost = input.estimatedCostMicros ?? 0;
  const success = input.success ?? true;

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
        success,
        errorCode: input.errorCode,
        metadata: input.metadata,
      },
    });

    if (!success) return;

    const now = new Date();
    const trial = await tx.trial.findFirst({
      where: {
        userId: input.userId,
        expiredAt: null,
        endsAt: { gt: now },
      },
    });

    if (!trial) return;

    const data = {
      ...(cost > 0 ? { estimatedCostMicros: { increment: cost } } : {}),
      ...(input.capabilityReserved
        ? {}
        : incrementCounters(input.capability)),
    };

    if (Object.keys(data).length === 0) return;

    await tx.trial.update({
      where: { id: trial.id },
      data,
    });
  });
}

function incrementCounters(capability: UsageCapability) {
  if (capability === "DOCUMENT_ANALYSIS") {
    return { documentAnalysesUsed: { increment: 1 as const } };
  }
  if (capability === "ADVANCED_TUTORING") {
    return { advancedTutoringUsed: { increment: 1 as const } };
  }
  return { aiSessionsUsed: { increment: 1 as const } };
}
