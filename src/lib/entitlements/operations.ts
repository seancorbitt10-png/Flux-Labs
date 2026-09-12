/**
 * AI usage reservation / settlement.
 *
 * Lifecycle:
 *   RESERVED → beginUsageReservation (holds entitlement capacity)
 *   SETTLED  → successful or failed-but-consumed finalize
 *   RELEASED → provider/infra failure finalize (capacity returned)
 *
 * Reservation = server-authorized capacity held for one AI operation.
 * It is NOT an exact vendor invoice amount.
 *
 * Clients never create operations, choose amounts, set costs, or transition
 * status. Settlement is idempotent by server-generated operation id.
 */

import type {
  AiUsageOperation,
  Prisma,
  UsageCapability,
} from "@prisma/client";
import type { InternalModelKey } from "@/lib/ai/types";
import { prisma } from "@/lib/db/prisma";
import { EntitlementError } from "@/lib/errors";
import {
  reserveCapability,
  type UsageReservation,
} from "@/lib/entitlements/check";
import { estimateCostMicros } from "@/lib/entitlements/cost-table";
import { trialCounterField } from "@/lib/entitlements/plans";

export type { UsageReservation };

export type FinalizeUsageOutcome =
  | "success"
  | "failed_consumed"
  | "failed_released";

export type FinalizeUsageInput = {
  operationId: string;
  /** Must match the authenticated actor that owns the reservation. */
  userId: string;
  outcome: FinalizeUsageOutcome;
  feature?: string;
  aiTaskType?: string;
  modelKey?: InternalModelKey | string;
  inputTokens?: number;
  outputTokens?: number;
  /** Provider-reported estimate only — never trusted from clients. */
  providerEstimateMicros?: number;
  latencyMs?: number;
  errorCode?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Authorize + reserve entitlement capacity and open a ledger row.
 * Fail closed if entitlement or ledger write cannot complete.
 */
export async function beginUsageReservation(args: {
  userId: string;
  capability: UsageCapability;
  feature: string;
}): Promise<UsageReservation> {
  return reserveCapability(args.userId, args.capability, args.feature);
}

/**
 * Idempotent settlement / release of a reservation.
 * Ownership is always re-checked against userId (IDOR-safe).
 */
export async function finalizeUsageReservation(
  input: FinalizeUsageInput,
): Promise<void> {
  if (!input.operationId || !input.userId) {
    throw new EntitlementError(
      "Invalid usage settlement identity",
      "AI usage could not be finalized.",
    );
  }

  await prisma.$transaction(async (tx) => {
    const op = await tx.aiUsageOperation.findUnique({
      where: { id: input.operationId },
    });

    if (!op || op.userId !== input.userId) {
      throw new EntitlementError(
        "Usage reservation not found for user",
        "AI usage could not be finalized.",
      );
    }

    if (op.status === "SETTLED") {
      if (
        input.outcome === "success" ||
        input.outcome === "failed_consumed"
      ) {
        return;
      }
      throw new EntitlementError(
        "Cannot release an already settled usage operation",
        "AI usage could not be finalized.",
      );
    }

    if (op.status === "RELEASED") {
      if (input.outcome === "failed_released") {
        return;
      }
      throw new EntitlementError(
        "Cannot settle an already released usage operation",
        "AI usage could not be finalized.",
      );
    }

    if (op.status !== "RESERVED") {
      throw new EntitlementError(
        "Invalid usage operation state",
        "AI usage could not be finalized.",
      );
    }

    if (input.outcome === "failed_released") {
      await releaseReservedOperation(tx, op, input);
      return;
    }

    await settleReservedOperation(tx, op, input);
  });
}

async function settleReservedOperation(
  tx: Prisma.TransactionClient,
  op: AiUsageOperation,
  input: FinalizeUsageInput,
): Promise<void> {
  const success = input.outcome === "success";
  const modelKey =
    typeof input.modelKey === "string" && input.modelKey.length > 0
      ? input.modelKey
      : undefined;

  const cost = success
    ? estimateCostMicros({
        modelKey:
          (modelKey as InternalModelKey | undefined) ?? "flux-standard",
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        providerEstimateMicros: input.providerEstimateMicros,
      })
    : 0;

  const usage = await tx.usageRecord.create({
    data: {
      userId: input.userId,
      capability: op.capability,
      feature: input.feature ?? op.feature,
      aiTaskType: input.aiTaskType,
      modelKey,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      estimatedCostMicros: cost,
      latencyMs: input.latencyMs,
      success,
      errorCode: input.errorCode,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });

  const updated = await tx.aiUsageOperation.updateMany({
    where: {
      id: op.id,
      userId: input.userId,
      status: "RESERVED",
    },
    data: {
      status: "SETTLED",
      settledAt: new Date(),
      estimatedCostMicros: cost,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      modelKey,
      errorCode: input.errorCode,
      usageRecordId: usage.id,
    },
  });

  if (updated.count !== 1) {
    throw new EntitlementError(
      "Usage settlement lost reservation race",
      "AI usage could not be finalized.",
    );
  }

  if (success && cost > 0) {
    const now = new Date();
    await tx.trial.updateMany({
      where: {
        userId: input.userId,
        expiredAt: null,
        endsAt: { gt: now },
      },
      data: {
        estimatedCostMicros: { increment: cost },
      },
    });
  }
}

async function releaseReservedOperation(
  tx: Prisma.TransactionClient,
  op: AiUsageOperation,
  input: FinalizeUsageInput,
): Promise<void> {
  const usage = await tx.usageRecord.create({
    data: {
      userId: input.userId,
      capability: op.capability,
      feature: input.feature ?? op.feature,
      aiTaskType: input.aiTaskType,
      modelKey: typeof input.modelKey === "string" ? input.modelKey : undefined,
      estimatedCostMicros: 0,
      latencyMs: input.latencyMs,
      success: false,
      errorCode: input.errorCode ?? "PROVIDER_ERROR",
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });

  const updated = await tx.aiUsageOperation.updateMany({
    where: {
      id: op.id,
      userId: input.userId,
      status: "RESERVED",
    },
    data: {
      status: "RELEASED",
      releasedAt: new Date(),
      errorCode: input.errorCode ?? "PROVIDER_ERROR",
      releaseReason: input.errorCode ?? "provider_failure",
      usageRecordId: usage.id,
    },
  });

  if (updated.count !== 1) {
    throw new EntitlementError(
      "Usage release lost reservation race",
      "AI usage could not be finalized.",
    );
  }

  // Return trial capacity. Conditional decrement prevents negatives.
  const counterField = trialCounterField(op.capability);
  await tx.trial.updateMany({
    where: {
      userId: input.userId,
      [counterField]: { gt: 0 },
    },
    data: {
      [counterField]: { decrement: 1 },
    },
  });
}
