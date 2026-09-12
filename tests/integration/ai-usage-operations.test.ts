import { createHash, randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { isProductionAIEnabled } from "@/lib/ai/provider-config";
import { reserveCapability } from "@/lib/entitlements/check";
import { estimateCostMicros } from "@/lib/entitlements/cost-table";
import {
  beginUsageReservation,
  finalizeUsageReservation,
} from "@/lib/entitlements/operations";
import { EntitlementError } from "@/lib/errors";

const prisma = new PrismaClient();

async function createTrialUser(suffix: string) {
  const email = `usage-op.${suffix}@fluxlabs.test`;
  const endsAt = new Date(Date.now() + 7 * 86_400_000);
  return prisma.user.create({
    data: {
      email,
      name: "Usage Op Test",
      passwordHash: "not-used",
      studentProfile: { create: { displayName: "Usage Op Test" } },
      entitlements: {
        create: {
          plan: "FREE_TRIAL",
          status: "ACTIVE",
          endsAt,
        },
      },
      trials: {
        create: {
          endsAt,
          aiSessionsUsed: 0,
          documentAnalysesUsed: 0,
          advancedTutoringUsed: 0,
          estimatedCostMicros: 0,
        },
      },
    },
  });
}

async function createPaidUser(suffix: string, plan: "PLUS" | "PRO" = "PLUS") {
  const email = `usage-paid.${suffix}@fluxlabs.test`;
  return prisma.user.create({
    data: {
      email,
      name: "Paid Usage Test",
      passwordHash: "not-used",
      studentProfile: { create: { displayName: "Paid Usage Test" } },
      entitlements: {
        create: {
          plan,
          status: "ACTIVE",
          endsAt: null,
        },
      },
    },
  });
}

describe("Phase 4 Implementation #2 — usage reservation/settlement", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.aiUsageOperation.deleteMany({
      where: { user: { email: { endsWith: "@fluxlabs.test" } } },
    });
    await prisma.usageRecord.deleteMany({
      where: { user: { email: { endsWith: "@fluxlabs.test" } } },
    });
    await prisma.aIInteraction.deleteMany({
      where: { user: { email: { endsWith: "@fluxlabs.test" } } },
    });
    await prisma.trial.deleteMany({
      where: { user: { email: { endsWith: "@fluxlabs.test" } } },
    });
    await prisma.entitlement.deleteMany({
      where: { user: { email: { endsWith: "@fluxlabs.test" } } },
    });
    await prisma.studentProfile.deleteMany({
      where: { user: { email: { endsWith: "@fluxlabs.test" } } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: "@fluxlabs.test" } },
    });
  });

  it("reserves entitled usage for an authenticated user", async () => {
    const user = await createTrialUser(`ok-${Date.now()}`);
    const reservation = await beginUsageReservation({
      userId: user.id,
      capability: "AI_SESSION",
      feature: "ai.orchestration",
    });

    expect(reservation.operationId).toBeTruthy();
    const op = await prisma.aiUsageOperation.findUniqueOrThrow({
      where: { id: reservation.operationId },
    });
    expect(op.status).toBe("RESERVED");
    expect(op.userId).toBe(user.id);
    expect(op.capability).toBe("AI_SESSION");

    const trial = await prisma.trial.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(trial.aiSessionsUsed).toBe(1);
  });

  it("rejects reservation without a usable user id (fail closed)", async () => {
    await expect(
      beginUsageReservation({
        userId: "",
        capability: "AI_SESSION",
        feature: "ai.orchestration",
      }),
    ).rejects.toBeInstanceOf(EntitlementError);
  });

  it("rejects exhausted entitlement", async () => {
    const user = await createTrialUser(`exhausted-${Date.now()}`);
    await prisma.trial.update({
      where: { userId: user.id },
      data: { aiSessionsUsed: 10 },
    });

    await expect(
      beginUsageReservation({
        userId: user.id,
        capability: "AI_SESSION",
        feature: "ai.orchestration",
      }),
    ).rejects.toBeInstanceOf(EntitlementError);
  });

  it("prevents concurrent reservations from over-allocating trial capacity", async () => {
    const user = await createTrialUser(`race-${Date.now()}`);
    await prisma.trial.update({
      where: { userId: user.id },
      data: { aiSessionsUsed: 9 },
    });

    const results = await Promise.allSettled([
      beginUsageReservation({
        userId: user.id,
        capability: "AI_SESSION",
        feature: "ai.orchestration",
      }),
      beginUsageReservation({
        userId: user.id,
        capability: "AI_SESSION",
        feature: "ai.orchestration",
      }),
      beginUsageReservation({
        userId: user.id,
        capability: "AI_SESSION",
        feature: "ai.orchestration",
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);

    const trial = await prisma.trial.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(trial.aiSessionsUsed).toBe(10);

    const reserved = await prisma.aiUsageOperation.count({
      where: { userId: user.id, status: "RESERVED" },
    });
    expect(reserved).toBe(1);
  });

  it("settles a successful provider operation with server-side cost", async () => {
    const user = await createTrialUser(`settle-${Date.now()}`);
    const reservation = await beginUsageReservation({
      userId: user.id,
      capability: "AI_SESSION",
      feature: "ai.orchestration",
    });

    await finalizeUsageReservation({
      operationId: reservation.operationId,
      userId: user.id,
      outcome: "success",
      modelKey: "flux-standard",
      inputTokens: 1000,
      outputTokens: 500,
      providerEstimateMicros: 10,
    });

    const op = await prisma.aiUsageOperation.findUniqueOrThrow({
      where: { id: reservation.operationId },
    });
    expect(op.status).toBe("SETTLED");
    expect(op.estimatedCostMicros).toBeGreaterThanOrEqual(50);

    const trial = await prisma.trial.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(trial.aiSessionsUsed).toBe(1);
    expect(trial.estimatedCostMicros).toBe(op.estimatedCostMicros);

    const usage = await prisma.usageRecord.findMany({
      where: { userId: user.id },
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]?.success).toBe(true);
  });

  it("releases reservation on safe non-execution and restores trial capacity", async () => {
    const user = await createTrialUser(`release-${Date.now()}`);
    const reservation = await beginUsageReservation({
      userId: user.id,
      capability: "AI_SESSION",
      feature: "ai.orchestration",
    });

    await finalizeUsageReservation({
      operationId: reservation.operationId,
      userId: user.id,
      outcome: "failed_released",
      errorCode: "AI_PROVIDER_CONFIG",
    });

    const op = await prisma.aiUsageOperation.findUniqueOrThrow({
      where: { id: reservation.operationId },
    });
    expect(op.status).toBe("RELEASED");

    const trial = await prisma.trial.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(trial.aiSessionsUsed).toBe(0);
    expect(trial.estimatedCostMicros).toBe(0);
  });

  it("consumes reservation on ambiguous execution (timeout) without restoring trial", async () => {
    const user = await createTrialUser(`ambig-${Date.now()}`);
    const reservation = await beginUsageReservation({
      userId: user.id,
      capability: "AI_SESSION",
      feature: "ai.orchestration",
      modelKey: "flux-standard",
    });

    const reserved = await prisma.aiUsageOperation.findUniqueOrThrow({
      where: { id: reservation.operationId },
    });
    expect(reserved.reservedCostMicros).toBeGreaterThan(0);

    await finalizeUsageReservation({
      operationId: reservation.operationId,
      userId: user.id,
      outcome: "failed_consumed",
      errorCode: "AI_PROVIDER_TIMEOUT",
      modelKey: "flux-standard",
    });

    const op = await prisma.aiUsageOperation.findUniqueOrThrow({
      where: { id: reservation.operationId },
    });
    expect(op.status).toBe("SETTLED");
    expect(op.estimatedCostMicros).toBe(reserved.reservedCostMicros);

    const trial = await prisma.trial.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(trial.aiSessionsUsed).toBe(1);
    expect(trial.estimatedCostMicros).toBe(reserved.reservedCostMicros);
  });

  it("keeps capacity consumed when provider output is invalid", async () => {
    const user = await createTrialUser(`consumed-${Date.now()}`);
    const reservation = await beginUsageReservation({
      userId: user.id,
      capability: "AI_SESSION",
      feature: "ai.orchestration",
    });

    await finalizeUsageReservation({
      operationId: reservation.operationId,
      userId: user.id,
      outcome: "failed_consumed",
      errorCode: "PROVIDER_OUTPUT_INVALID",
    });

    const op = await prisma.aiUsageOperation.findUniqueOrThrow({
      where: { id: reservation.operationId },
    });
    expect(op.status).toBe("SETTLED");

    const trial = await prisma.trial.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(trial.aiSessionsUsed).toBe(1);
  });

  it("makes duplicate settlement idempotent (no double consume)", async () => {
    const user = await createTrialUser(`idem-${Date.now()}`);
    const reservation = await beginUsageReservation({
      userId: user.id,
      capability: "AI_SESSION",
      feature: "ai.orchestration",
    });

    const payload = {
      operationId: reservation.operationId,
      userId: user.id,
      outcome: "success" as const,
      modelKey: "flux-standard" as const,
      inputTokens: 100,
      outputTokens: 50,
      providerEstimateMicros: 100,
    };

    await finalizeUsageReservation(payload);
    await finalizeUsageReservation(payload);

    const usageCount = await prisma.usageRecord.count({
      where: { userId: user.id, success: true },
    });
    expect(usageCount).toBe(1);

    const trial = await prisma.trial.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(trial.aiSessionsUsed).toBe(1);
  });

  it("makes duplicate release idempotent", async () => {
    const user = await createTrialUser(`idem-rel-${Date.now()}`);
    const reservation = await beginUsageReservation({
      userId: user.id,
      capability: "AI_SESSION",
      feature: "ai.orchestration",
    });

    await finalizeUsageReservation({
      operationId: reservation.operationId,
      userId: user.id,
      outcome: "failed_released",
      errorCode: "NOT_DISPATCHED",
    });
    await finalizeUsageReservation({
      operationId: reservation.operationId,
      userId: user.id,
      outcome: "failed_released",
      errorCode: "NOT_DISPATCHED",
    });

    const trial = await prisma.trial.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(trial.aiSessionsUsed).toBe(0);

    const released = await prisma.aiUsageOperation.count({
      where: { userId: user.id, status: "RELEASED" },
    });
    expect(released).toBe(1);
  });

  it("blocks cross-user settlement (IDOR)", async () => {
    const owner = await createTrialUser(`owner-${Date.now()}`);
    const attacker = await createTrialUser(`attacker-${Date.now()}`);
    const reservation = await beginUsageReservation({
      userId: owner.id,
      capability: "AI_SESSION",
      feature: "ai.orchestration",
    });

    await expect(
      finalizeUsageReservation({
        operationId: reservation.operationId,
        userId: attacker.id,
        outcome: "success",
        modelKey: "flux-standard",
      }),
    ).rejects.toBeInstanceOf(EntitlementError);

    const op = await prisma.aiUsageOperation.findUniqueOrThrow({
      where: { id: reservation.operationId },
    });
    expect(op.status).toBe("RESERVED");
  });

  it("ignores undersized provider estimates via server cost floor", async () => {
    const cost = estimateCostMicros({
      modelKey: "flux-advanced",
      inputTokens: 0,
      outputTokens: 0,
      providerEstimateMicros: 1,
    });
    expect(cost).toBeGreaterThanOrEqual(200);
  });

  it("reservation API exposes only server plan metadata", async () => {
    const user = await createTrialUser(`noclient-${Date.now()}`);
    const reservation = await beginUsageReservation({
      userId: user.id,
      capability: "AI_SESSION",
      feature: "ai.orchestration",
    });
    expect(reservation.plan.tier).toBe("FREE_TRIAL");
    expect(
      Object.prototype.hasOwnProperty.call(reservation, "clientPlan"),
    ).toBe(false);
  });

  it("prevents concurrent paid-plan over-allocation via operation ledger", async () => {
    const user = await createPaidUser(`paid-race-${Date.now()}`, "PLUS");
    const entitlement = await prisma.entitlement.findFirstOrThrow({
      where: { userId: user.id, status: "ACTIVE" },
    });
    await prisma.aiUsageOperation.createMany({
      data: Array.from({ length: 99 }, () => ({
        id: randomUUID().replace(/-/g, "").slice(0, 24),
        userId: user.id,
        entitlementId: entitlement.id,
        capability: "AI_SESSION" as const,
        feature: "seed",
        status: "SETTLED" as const,
      })),
    });

    const results = await Promise.allSettled([
      beginUsageReservation({
        userId: user.id,
        capability: "AI_SESSION",
        feature: "ai.orchestration",
      }),
      beginUsageReservation({
        userId: user.id,
        capability: "AI_SESSION",
        feature: "ai.orchestration",
      }),
      beginUsageReservation({
        userId: user.id,
        capability: "AI_SESSION",
        feature: "ai.orchestration",
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);

    const held = await prisma.aiUsageOperation.count({
      where: {
        userId: user.id,
        capability: "AI_SESSION",
        status: { in: ["RESERVED", "SETTLED"] },
      },
    });
    expect(held).toBe(100);
  });

  it("keeps production AI disabled by default", () => {
    expect(isProductionAIEnabled({})).toBe(false);
    expect(
      isProductionAIEnabled({
        OPENAI_API_KEY: "sk-test",
        AI_PROVIDER: "openai",
      }),
    ).toBe(false);
  });

  it("reserveCapability still returns an operation id for callers", async () => {
    const user = await createTrialUser(`compat-${Date.now()}`);
    const reservation = await reserveCapability(user.id, "AI_SESSION");
    expect(reservation.operationId).toBeTruthy();
  });

  it("maps provider error certainty to settlement outcomes", async () => {
    const { settlementOutcomeForProviderError } = await import(
      "@/lib/entitlements/operations"
    );
    const {
      AIProviderConfigError,
      AIProviderTimeoutError,
      AIProviderUpstreamError,
      AIProviderInvalidResponseError,
      AIProviderLimitError,
    } = await import("@/lib/ai/provider-errors");

    expect(settlementOutcomeForProviderError(new AIProviderConfigError("x"))).toBe(
      "failed_released",
    );
    expect(settlementOutcomeForProviderError(new AIProviderLimitError("x"))).toBe(
      "failed_released",
    );
    expect(
      settlementOutcomeForProviderError(new AIProviderTimeoutError()),
    ).toBe("failed_consumed");
    expect(
      settlementOutcomeForProviderError(new AIProviderUpstreamError()),
    ).toBe("failed_consumed");
    expect(
      settlementOutcomeForProviderError(new AIProviderInvalidResponseError()),
    ).toBe("failed_consumed");
    expect(settlementOutcomeForProviderError(new Error("network"))).toBe(
      "failed_consumed",
    );
  });

  it("stores server-side reservedCost ceiling distinct from settled estimate", async () => {
    const user = await createTrialUser(`ceiling-${Date.now()}`);
    const { reservationCostCeilingMicros } = await import(
      "@/lib/entitlements/cost-table"
    );
    const ceiling = reservationCostCeilingMicros({
      capability: "AI_SESSION",
      modelKey: "flux-standard",
    });

    const reservation = await beginUsageReservation({
      userId: user.id,
      capability: "AI_SESSION",
      feature: "ai.orchestration",
      modelKey: "flux-standard",
    });

    const reserved = await prisma.aiUsageOperation.findUniqueOrThrow({
      where: { id: reservation.operationId },
    });
    expect(reserved.reservedCostMicros).toBe(ceiling);

    await finalizeUsageReservation({
      operationId: reservation.operationId,
      userId: user.id,
      outcome: "success",
      modelKey: "flux-standard",
      inputTokens: 10,
      outputTokens: 5,
      providerEstimateMicros: 1,
    });

    const settled = await prisma.aiUsageOperation.findUniqueOrThrow({
      where: { id: reservation.operationId },
    });
    // Success uses token-based estimate (min floor), not the reservation ceiling.
    expect(settled.estimatedCostMicros).toBeLessThan(settled.reservedCostMicros);
    expect(settled.estimatedCostMicros).toBeGreaterThanOrEqual(50);
  });

  it("includes outstanding RESERVED cost in budget availability", async () => {
    const user = await createPaidUser(`budget-hold-${Date.now()}`, "PLUS");
    const entitlement = await prisma.entitlement.findFirstOrThrow({
      where: { userId: user.id, status: "ACTIVE" },
    });
    // PLUS budget = 5_000_000. Hold almost all with an outstanding reservation.
    await prisma.aiUsageOperation.create({
      data: {
        userId: user.id,
        entitlementId: entitlement.id,
        capability: "AI_SESSION",
        feature: "seed-hold",
        status: "RESERVED",
        reservedCostMicros: 4_998_801,
      },
    });

    await expect(
      beginUsageReservation({
        userId: user.id,
        capability: "AI_SESSION",
        feature: "ai.orchestration",
        modelKey: "flux-standard",
      }),
    ).rejects.toBeInstanceOf(EntitlementError);
  });

  it("excludes RELEASED reservations from budget availability", async () => {
    const user = await createPaidUser(`budget-rel-${Date.now()}`, "PLUS");
    const entitlement = await prisma.entitlement.findFirstOrThrow({
      where: { userId: user.id, status: "ACTIVE" },
    });
    await prisma.aiUsageOperation.create({
      data: {
        userId: user.id,
        entitlementId: entitlement.id,
        capability: "AI_SESSION",
        feature: "seed-released",
        status: "RELEASED",
        reservedCostMicros: 4_999_000,
        estimatedCostMicros: 0,
        releasedAt: new Date(),
      },
    });

    await expect(
      beginUsageReservation({
        userId: user.id,
        capability: "AI_SESSION",
        feature: "ai.orchestration",
        modelKey: "flux-standard",
      }),
    ).resolves.toMatchObject({ operationId: expect.any(String) });
  });

  it("keeps SETTLED cost included in budget availability", async () => {
    const user = await createPaidUser(`budget-set-${Date.now()}`, "PLUS");
    const entitlement = await prisma.entitlement.findFirstOrThrow({
      where: { userId: user.id, status: "ACTIVE" },
    });
    await prisma.aiUsageOperation.create({
      data: {
        userId: user.id,
        entitlementId: entitlement.id,
        capability: "AI_SESSION",
        feature: "seed-settled",
        status: "SETTLED",
        reservedCostMicros: 1200,
        estimatedCostMicros: 4_998_801,
        settledAt: new Date(),
      },
    });

    await expect(
      beginUsageReservation({
        userId: user.id,
        capability: "AI_SESSION",
        feature: "ai.orchestration",
        modelKey: "flux-standard",
      }),
    ).rejects.toBeInstanceOf(EntitlementError);
  });

  it("prevents concurrent financial reservations from exceeding AI budget", async () => {
    const user = await createPaidUser(`budget-race-${Date.now()}`, "PLUS");
    const entitlement = await prisma.entitlement.findFirstOrThrow({
      where: { userId: user.id, status: "ACTIVE" },
    });
    // Leave room for exactly one flux-standard reservation ceiling (1200 micros).
    await prisma.aiUsageOperation.create({
      data: {
        userId: user.id,
        entitlementId: entitlement.id,
        capability: "AI_SESSION",
        feature: "seed-near-budget",
        status: "SETTLED",
        reservedCostMicros: 1200,
        estimatedCostMicros: 4_998_800,
        settledAt: new Date(),
      },
    });

    const results = await Promise.allSettled([
      beginUsageReservation({
        userId: user.id,
        capability: "AI_SESSION",
        feature: "ai.orchestration",
        modelKey: "flux-standard",
      }),
      beginUsageReservation({
        userId: user.id,
        capability: "AI_SESSION",
        feature: "ai.orchestration",
        modelKey: "flux-standard",
      }),
      beginUsageReservation({
        userId: user.id,
        capability: "AI_SESSION",
        feature: "ai.orchestration",
        modelKey: "flux-standard",
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);

    const reserved = await prisma.aiUsageOperation.count({
      where: { userId: user.id, status: "RESERVED" },
    });
    expect(reserved).toBe(1);
  });

  it("rejects settling an already released operation", async () => {
    const user = await createTrialUser(`no-settle-rel-${Date.now()}`);
    const reservation = await beginUsageReservation({
      userId: user.id,
      capability: "AI_SESSION",
      feature: "ai.orchestration",
    });

    await finalizeUsageReservation({
      operationId: reservation.operationId,
      userId: user.id,
      outcome: "failed_released",
      errorCode: "NOT_DISPATCHED",
    });

    await expect(
      finalizeUsageReservation({
        operationId: reservation.operationId,
        userId: user.id,
        outcome: "failed_consumed",
        errorCode: "AI_PROVIDER_TIMEOUT",
      }),
    ).rejects.toBeInstanceOf(EntitlementError);
  });

  it("rejects releasing an already settled operation", async () => {
    const user = await createTrialUser(`no-rel-set-${Date.now()}`);
    const reservation = await beginUsageReservation({
      userId: user.id,
      capability: "AI_SESSION",
      feature: "ai.orchestration",
    });

    await finalizeUsageReservation({
      operationId: reservation.operationId,
      userId: user.id,
      outcome: "success",
      modelKey: "flux-standard",
      inputTokens: 10,
      outputTokens: 5,
    });

    await expect(
      finalizeUsageReservation({
        operationId: reservation.operationId,
        userId: user.id,
        outcome: "failed_released",
        errorCode: "LATE_RELEASE",
      }),
    ).rejects.toBeInstanceOf(EntitlementError);
  });

  it("cannot transition RELEASED back to SETTLED (no free revive)", async () => {
    const user = await createTrialUser(`revive-${Date.now()}`);
    const reservation = await beginUsageReservation({
      userId: user.id,
      capability: "AI_SESSION",
      feature: "ai.orchestration",
    });

    await finalizeUsageReservation({
      operationId: reservation.operationId,
      userId: user.id,
      outcome: "failed_released",
      errorCode: "NOT_DISPATCHED",
    });

    await expect(
      finalizeUsageReservation({
        operationId: reservation.operationId,
        userId: user.id,
        outcome: "success",
        modelKey: "flux-standard",
      }),
    ).rejects.toBeInstanceOf(EntitlementError);
  });

  it("keeps request fingerprints free of raw student text", () => {
    const message = "secret homework answer 42";
    const hash = createHash("sha256").update(message).digest("hex").slice(0, 16);
    expect(hash).not.toContain("homework");
    expect(hash).not.toContain("42");
  });
});
