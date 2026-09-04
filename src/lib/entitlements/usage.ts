import type { UsageCapability } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { EntitlementError } from "@/lib/errors";
import { getPlanDefinition } from "./plans";

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
   * Only write telemetry + apply cost micros (with budget guard).
   */
  capabilityReserved?: boolean;
};

/**
 * Persist operational usage telemetry.
 * Capability unit counters are reserved atomically before AI work;
 * this records the event and applies estimated cost.
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

    if (!success || cost <= 0) return;

    const now = new Date();
    const trial = await tx.trial.findFirst({
      where: {
        userId: input.userId,
        expiredAt: null,
        endsAt: { gt: now },
      },
    });

    if (!trial) return;

    const plan = getPlanDefinition("FREE_TRIAL");
    if (
      plan.limits.aiBudgetMicros !== null &&
      trial.estimatedCostMicros + cost > plan.limits.aiBudgetMicros
    ) {
      // Still record telemetry above; reject further spend attribution hard-cap.
      throw new EntitlementError(
        "Trial AI budget exceeded",
        "You have reached the trial usage limit.",
      );
    }

    await tx.trial.update({
      where: { id: trial.id },
      data: {
        estimatedCostMicros: { increment: cost },
        // If capability was not pre-reserved (legacy path), increment counters here.
        ...(input.capabilityReserved
          ? {}
          : incrementCounters(input.capability)),
      },
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
