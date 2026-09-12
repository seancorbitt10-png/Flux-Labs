/**
 * AI usage reservation / settlement.
 *
 * Lifecycle:
 *   RESERVED → beginUsageReservation (holds capability + reservedCost ceiling)
 *   SETTLED  → success, invalid output after dispatch, or ambiguous execution
 *   RELEASED → safe non-execution only (provider never dispatched)
 *
 * Reservation = server-authorized capacity + conservative cost ceiling.
 * reservedCost ≠ actualProviderCost / vendor invoice.
 *
 * Failure matrix:
 *   Local validation / config before dispatch → RELEASED
 *   Timeout / network / upstream after dispatch → SETTLED (consume)
 *   Invalid provider output after dispatch → SETTLED (consume)
 *   Valid success → SETTLED
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
import {
  AIProviderError,
  type ProviderExecutionCertainty,
} from "@/lib/ai/provider-errors";
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
 * Map provider failure certainty to settlement outcome.
 * Ambiguous/dispatched failures consume; not_dispatched releases.
 */
export function settlementOutcomeForProviderError(
  error: unknown,
): FinalizeUsageOutcome {
  if (error instanceof AIProviderError) {
    const certainty: ProviderExecutionCertainty = error.executionCertainty;
    if (certainty === "not_dispatched") return "failed_released";
    return "failed_consumed";
  }
  // Unknown errors after provider.complete() was entered → treat as ambiguous.
  return "failed_consumed";
}

/**
 * Authorize + reserve entitlement capacity and open a ledger row.
 * Fail closed if entitlement or ledger write cannot complete.
 */
export async function beginUsageReservation(args: {
  userId: string;
  capability: UsageCapability;
  feature: string;
  modelKey?: InternalModelKey;
}): Promise<UsageReservation> {
  return reserveCapability(
    args.userId,
    args.capability,
    args.feature,
    args.modelKey,
  );
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

/**
 * Best-effort release when still RESERVED (pre-dispatch local failures).
 * No-ops if already terminal. Fail-closed on ownership mismatch.
 */
export async function releaseUsageReservationIfHeld(args: {
  operationId: string;
  userId: string;
  errorCode?: string;
  feature?: string;
}): Promise<void> {
  const op = await prisma.aiUsageOperation.findUnique({
    where: { id: args.operationId },
  });
  if (!op) return;
  if (op.userId !== args.userId) {
    throw new EntitlementError(
      "Usage reservation not found for user",
      "AI usage could not be finalized.",
    );
  }
  if (op.status !== "RESERVED") return;

  await finalizeUsageReservation({
    operationId: args.operationId,
    userId: args.userId,
    outcome: "failed_released",
    feature: args.feature ?? op.feature,
    errorCode: args.errorCode ?? "PRE_DISPATCH_FAILURE",
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
      : op.modelKey ?? undefined;

  // Success: best server estimate. Ambiguous/invalid consume: keep reserved ceiling.
  const cost = success
    ? estimateCostMicros({
        modelKey:
          (modelKey as InternalModelKey | undefined) ?? "flux-standard",
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        providerEstimateMicros: input.providerEstimateMicros,
      })
    : Math.max(0, op.reservedCostMicros);

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

  // Attribute settled cost against trial soft budget (success or consumed failure).
  if (cost > 0) {
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
      errorCode: input.errorCode ?? "NOT_DISPATCHED",
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
      errorCode: input.errorCode ?? "NOT_DISPATCHED",
      releaseReason: input.errorCode ?? "safe_non_execution",
      usageRecordId: usage.id,
    },
  });

  if (updated.count !== 1) {
    throw new EntitlementError(
      "Usage release lost reservation race",
      "AI usage could not be finalized.",
    );
  }

  // Return trial capacity only for safe non-execution.
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
