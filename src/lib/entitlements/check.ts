import type {
  Entitlement,
  PlanTier,
  Prisma,
  Trial,
  UsageCapability,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { EntitlementError } from "@/lib/errors";
import {
  capabilityToLimitKey,
  getPlanDefinition,
  trialCounterField,
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
      ? await prisma.trial.findUnique({ where: { userId } })
      : null;

  return {
    entitlement,
    trial,
    plan: getPlanDefinition(entitlement.plan),
  };
}

/**
 * Atomically reserve one unit of a capability before running expensive work.
 * Prevents TOCTOU overshoot under concurrent requests.
 */
export async function reserveCapability(
  userId: string,
  capability: UsageCapability,
): Promise<ActiveEntitlement> {
  return prisma.$transaction(async (tx) => {
    const now = new Date();

    const entitlement = await tx.entitlement.findFirst({
      where: {
        userId,
        status: "ACTIVE",
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
    });

    if (!entitlement) {
      throw new EntitlementError(
        "No active entitlement",
        "Your trial or subscription is not active.",
      );
    }

    const plan = getPlanDefinition(entitlement.plan);

    if (entitlement.plan === "FREE_TRIAL") {
      const trial = await reserveTrialCapability(tx, userId, capability, plan);
      return { entitlement, trial, plan };
    }

    await assertPaidPlanAllowance(tx, userId, entitlement, capability, plan);
    return { entitlement, trial: null, plan };
  });
}

async function reserveTrialCapability(
  tx: Prisma.TransactionClient,
  userId: string,
  capability: UsageCapability,
  plan: PlanDefinition,
): Promise<Trial> {
  const now = new Date();
  const trial = await tx.trial.findUnique({ where: { userId } });

  if (!trial) {
    throw new EntitlementError(
      "Trial record missing",
      "Your trial is not active. Please contact support or re-register.",
    );
  }

  if (trial.expiredAt || trial.endsAt <= now) {
    await tx.trial.update({
      where: { id: trial.id },
      data: { expiredAt: trial.expiredAt ?? now },
    });
    await tx.entitlement.updateMany({
      where: { userId, status: "ACTIVE", plan: "FREE_TRIAL" },
      data: { status: "EXPIRED" },
    });
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

  const limitKey = capabilityToLimitKey(capability);
  const counterField = trialCounterField(capability);
  const limit = limitKey ? plan.limits[limitKey] : null;

  if (typeof limit === "number" && trial[counterField] >= limit) {
    throw new EntitlementError(
      `${capability} limit reached`,
      `You have reached your ${plan.label} limit for this feature.`,
    );
  }

  // Conditional update: only succeeds if still under limit (race-safe).
  const where: Prisma.TrialWhereInput = {
    id: trial.id,
    expiredAt: null,
    endsAt: { gt: now },
    [counterField]: typeof limit === "number" ? { lt: limit } : undefined,
  };

  if (plan.limits.aiBudgetMicros !== null) {
    where.estimatedCostMicros = { lt: plan.limits.aiBudgetMicros };
  }

  const updated = await tx.trial.updateMany({
    where,
    data: {
      [counterField]: { increment: 1 },
    },
  });

  if (updated.count !== 1) {
    throw new EntitlementError(
      `${capability} limit reached`,
      `You have reached your ${plan.label} limit for this feature.`,
    );
  }

  const refreshed = await tx.trial.findUniqueOrThrow({ where: { id: trial.id } });
  return refreshed;
}

async function assertPaidPlanAllowance(
  tx: Prisma.TransactionClient,
  userId: string,
  entitlement: Entitlement,
  capability: UsageCapability,
  plan: PlanDefinition,
): Promise<void> {
  const periodStart = entitlement.startsAt;
  const limitKey = capabilityToLimitKey(capability);
  const limit = limitKey ? plan.limits[limitKey] : null;

  if (typeof limit === "number") {
    const used = await tx.usageRecord.count({
      where: {
        userId,
        capability,
        success: true,
        createdAt: { gte: periodStart },
      },
    });
    if (used >= limit) {
      throw new EntitlementError(
        `${capability} limit reached`,
        `You have reached your ${plan.label} limit for this feature.`,
      );
    }
  }

  if (plan.limits.aiBudgetMicros !== null) {
    const cost = await tx.usageRecord.aggregate({
      where: {
        userId,
        success: true,
        createdAt: { gte: periodStart },
      },
      _sum: { estimatedCostMicros: true },
    });
    if ((cost._sum.estimatedCostMicros ?? 0) >= plan.limits.aiBudgetMicros) {
      throw new EntitlementError(
        "AI budget exceeded",
        "You have reached your plan usage limit.",
      );
    }
  }
}

export async function provisionTrialEntitlement(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const existing = await tx.entitlement.findFirst({
    where: { userId, status: "ACTIVE" },
  });
  if (existing) return;

  const existingTrial = await tx.trial.findUnique({ where: { userId } });
  if (existingTrial) return;

  const plan = getPlanDefinition("FREE_TRIAL");
  const trialDays = plan.trialDays ?? 7;
  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + trialDays);

  await tx.entitlement.create({
    data: {
      userId,
      plan: "FREE_TRIAL" satisfies PlanTier,
      status: "ACTIVE",
      endsAt,
    },
  });
  await tx.trial.create({
    data: {
      userId,
      endsAt,
    },
  });
}
