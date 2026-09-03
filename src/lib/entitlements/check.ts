import type { Entitlement, PlanTier, Trial, UsageCapability } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { EntitlementError } from "@/lib/errors";
import {
  capabilityToLimitKey,
  getPlanDefinition,
  type PlanDefinition,
} from "./plans";

export type ActiveEntitlement = {
  entitlement: Entitlement;
  trial: Trial | null;
  plan: PlanDefinition;
};

export async function getActiveEntitlement(
  userId: string,
): Promise<ActiveEntitlement | null> {
  const entitlement = await prisma.entitlement.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
  });

  if (!entitlement) return null;

  const trial =
    entitlement.plan === "FREE_TRIAL"
      ? await prisma.trial.findFirst({
          where: { userId },
          orderBy: { startedAt: "desc" },
        })
      : null;

  return {
    entitlement,
    trial,
    plan: getPlanDefinition(entitlement.plan),
  };
}

function getUsedCount(trial: Trial | null, capability: UsageCapability): number {
  if (!trial) return 0;
  switch (capability) {
    case "AI_SESSION":
      return trial.aiSessionsUsed;
    case "DOCUMENT_ANALYSIS":
      return trial.documentAnalysesUsed;
    case "ADVANCED_TUTORING":
      return trial.advancedTutoringUsed;
    default:
      return 0;
  }
}

/**
 * Server-side entitlement gate. Never rely on the client for this.
 */
export async function assertCapabilityAllowed(
  userId: string,
  capability: UsageCapability,
): Promise<ActiveEntitlement> {
  const active = await getActiveEntitlement(userId);
  if (!active) {
    throw new EntitlementError(
      "No active entitlement",
      "Your trial or subscription is not active.",
    );
  }

  const { plan, trial, entitlement } = active;

  if (entitlement.plan === "FREE_TRIAL" && trial) {
    if (trial.endsAt < new Date() || trial.expiredAt) {
      throw new EntitlementError(
        "Trial expired",
        "Your trial has ended. Subscribe to continue using Flux Labs.",
      );
    }

    if (
      plan.limits.aiBudgetMicros !== null &&
      trial.estimatedCostMicros >= plan.limits.aiBudgetMicros
    ) {
      throw new EntitlementError(
        "Trial AI budget exceeded",
        "You have reached the trial usage limit.",
      );
    }
  }

  const limitKey = capabilityToLimitKey(capability);
  if (limitKey) {
    const limit = plan.limits[limitKey];
    if (typeof limit === "number") {
      const used = getUsedCount(trial, capability);
      if (used >= limit) {
        throw new EntitlementError(
          `${capability} limit reached`,
          `You have reached your ${plan.label} limit for this feature.`,
        );
      }
    }
  }

  return active;
}

export async function provisionTrialEntitlement(userId: string): Promise<void> {
  const plan = getPlanDefinition("FREE_TRIAL");
  const trialDays = plan.trialDays ?? 7;
  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + trialDays);

  await prisma.$transaction([
    prisma.entitlement.create({
      data: {
        userId,
        plan: "FREE_TRIAL" satisfies PlanTier,
        status: "ACTIVE",
        endsAt,
      },
    }),
    prisma.trial.create({
      data: {
        userId,
        endsAt,
      },
    }),
  ]);
}
