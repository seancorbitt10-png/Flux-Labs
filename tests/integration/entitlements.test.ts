import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { reserveCapability } from "@/lib/entitlements/check";
import { EntitlementError } from "@/lib/errors";
import {
  capabilityForRoute,
  redactRequestSummary,
} from "@/lib/ai/orchestration";

const prisma = new PrismaClient();

async function createTrialUser(suffix: string) {
  const email = `entitlement.${suffix}@fluxlabs.test`;
  const endsAt = new Date(Date.now() + 7 * 86_400_000);
  const user = await prisma.user.create({
    data: {
      email,
      name: "Entitlement Test",
      passwordHash: "not-used",
      studentProfile: { create: { displayName: "Entitlement Test" } },
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
  return user;
}

describe("entitlement reservation", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.usageRecord.deleteMany({
      where: { user: { email: { endsWith: "@fluxlabs.test" } } },
    });
    await prisma.aIInteraction.deleteMany({
      where: { user: { email: { endsWith: "@fluxlabs.test" } } },
    });
    await prisma.auditLog.deleteMany({
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

  it("reserves AI sessions up to the trial limit then denies", async () => {
    const user = await createTrialUser(`limit-${Date.now()}`);
    await prisma.trial.update({
      where: { userId: user.id },
      data: { aiSessionsUsed: 9 },
    });

    await reserveCapability(user.id, "AI_SESSION");
    const trial = await prisma.trial.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(trial.aiSessionsUsed).toBe(10);

    await expect(reserveCapability(user.id, "AI_SESSION")).rejects.toBeInstanceOf(
      EntitlementError,
    );
  });

  it("denies when FREE_TRIAL has no trial row", async () => {
    const endsAt = new Date(Date.now() + 7 * 86_400_000);
    const user = await prisma.user.create({
      data: {
        email: `missing-trial-${Date.now()}@fluxlabs.test`,
        name: "Broken",
        passwordHash: "x",
        entitlements: {
          create: { plan: "FREE_TRIAL", status: "ACTIVE", endsAt },
        },
      },
    });

    await expect(reserveCapability(user.id, "AI_SESSION")).rejects.toBeInstanceOf(
      EntitlementError,
    );
  });

  it("denies expired trials", async () => {
    const user = await createTrialUser(`expired-${Date.now()}`);
    await prisma.trial.update({
      where: { userId: user.id },
      data: { endsAt: new Date(Date.now() - 1000) },
    });

    await expect(reserveCapability(user.id, "AI_SESSION")).rejects.toBeInstanceOf(
      EntitlementError,
    );
  });

  it("does not allow concurrent reservations to exceed the limit", async () => {
    const user = await createTrialUser(`race-${Date.now()}`);
    await prisma.trial.update({
      where: { userId: user.id },
      data: { aiSessionsUsed: 9 },
    });

    const results = await Promise.allSettled([
      reserveCapability(user.id, "AI_SESSION"),
      reserveCapability(user.id, "AI_SESSION"),
      reserveCapability(user.id, "AI_SESSION"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(2);

    const trial = await prisma.trial.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(trial.aiSessionsUsed).toBe(10);
  });
});

describe("orchestration helpers", () => {
  it("maps document analysis and advanced models to the right capabilities", () => {
    expect(capabilityForRoute("document_analysis", "flux-standard")).toBe(
      "DOCUMENT_ANALYSIS",
    );
    expect(capabilityForRoute("tutoring", "flux-advanced")).toBe(
      "ADVANCED_TUTORING",
    );
    expect(capabilityForRoute("homework_guidance", "flux-standard")).toBe(
      "AI_SESSION",
    );
  });

  it("redacts request summaries to hash + length", () => {
    const message = "Solve this for me: what is 2 + 2 + 2?";
    const summary = redactRequestSummary(message);
    const expectedHash = createHash("sha256")
      .update(message)
      .digest("hex")
      .slice(0, 16);
    expect(summary).toBe(`sha256:${expectedHash}:len=${message.length}`);
    expect(summary).not.toContain("2 + 2");
  });
});

describe("usage recording after reservation", () => {
  it("applies cost near budget without throwing after reserve", async () => {
    const { recordUsage } = await import("@/lib/entitlements/usage");
    const user = await createTrialUser(`budget-${Date.now()}`);
    await prisma.trial.update({
      where: { userId: user.id },
      data: { estimatedCostMicros: 1_999_990, aiSessionsUsed: 1 },
    });

    await expect(
      recordUsage({
        userId: user.id,
        capability: "AI_SESSION",
        feature: "ai.orchestration",
        estimatedCostMicros: 50,
        success: true,
        capabilityReserved: true,
      }),
    ).resolves.toBeUndefined();

    const trial = await prisma.trial.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(trial.estimatedCostMicros).toBe(2_000_040);
    expect(trial.aiSessionsUsed).toBe(1);

    const usage = await prisma.usageRecord.count({ where: { userId: user.id } });
    expect(usage).toBe(1);
  });
});
