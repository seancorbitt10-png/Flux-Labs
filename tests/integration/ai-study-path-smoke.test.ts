/**
 * Study-path production smoke remediation coverage.
 *
 * Behavioral proofs (mocked — never contacts OpenAI / never billable):
 * - Smoke enters executeStudyTurnForActor (Study orchestration seam)
 * - Smoke does not call provider.complete() itself
 * - Identity is server-owned (raw cannot supply userId)
 * - Learning policy / context remain server-controlled
 * - Entitlement reservation + settlement occur on the Study path
 * - Opt-in / CI / gate fail-closed contracts
 * - assertNoSecretLeak catches API key + confirm leaks
 * - Ops log controlled fields + sensitive detail refusal
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  AI_PRODUCTION_CONFIRM_VALUE,
  isProductionAIReady,
} from "@/lib/ai/provider-config";
import {
  AIProviderConfigError,
  AIProviderRateLimitError,
} from "@/lib/ai/provider-errors";
import { logAIOps } from "@/lib/ai/ops-log";
import {
  assertNoSecretLeak,
  assertNotRunningInCI,
  assertProductionGateReadyForSmoke,
  assertSmokeOptIn,
  buildSmokeStudyRaw,
  createIsolatedSmokeActor,
  runStudyPathProductionSmoke,
  SMOKE_STUDY_INTENT,
  SMOKE_STUDY_MESSAGE,
  SmokePreconditionsError,
} from "@/lib/ai/production-smoke";
import {
  getAIProvider,
  resetAIProvider,
  setAIProvider,
  StubAIProvider,
} from "@/lib/ai/provider";
import { settlementOutcomeForProviderError } from "@/lib/entitlements/operations";
import { executeStudyTurnForActor } from "@/lib/study/execute-turn";
import type { AIProvider } from "@/lib/ai/types";

const prisma = new PrismaClient();

function productionReadyEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    AI_PRODUCTION_ENABLED: "true",
    AI_PRODUCTION_CONFIRM: AI_PRODUCTION_CONFIRM_VALUE,
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-live-test-not-real-key-value",
    AI_SMOKE_TEST_ALLOW: "1",
    ...overrides,
  };
}

const ENV_KEYS = [
  "AI_PRODUCTION_ENABLED",
  "AI_PRODUCTION_CONFIRM",
  "AI_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "AI_SMOKE_TEST_ALLOW",
  "CI",
  "GITHUB_ACTIONS",
] as const;

function applyEnv(env: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
}

afterEach(() => {
  resetAIProvider();
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe("assertNoSecretLeak", () => {
  it("catches OPENAI_API_KEY leakage without printing the key", () => {
    process.env.OPENAI_API_KEY = "sk-secret-leak-probe-abc";
    expect(() =>
      assertNoSecretLeak("upstream said sk-secret-leak-probe-abc failed"),
    ).toThrow(SmokePreconditionsError);
    expect(() =>
      assertNoSecretLeak("upstream said sk-secret-leak-probe-abc failed"),
    ).toThrow(/OPENAI_API_KEY/);
  });

  it("catches configured AI_PRODUCTION_CONFIRM leakage", () => {
    process.env.AI_PRODUCTION_CONFIRM = AI_PRODUCTION_CONFIRM_VALUE;
    expect(() =>
      assertNoSecretLeak(`confirm=${AI_PRODUCTION_CONFIRM_VALUE} in body`),
    ).toThrow(/AI_PRODUCTION_CONFIRM/);
  });

  it("is safe when secrets are absent and ignores unrelated text", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_PRODUCTION_CONFIRM;
    expect(() => assertNoSecretLeak("ENABLE something else")).not.toThrow();
    expect(() => assertNoSecretLeak("")).not.toThrow();
  });

  it("does not treat arbitrary confirm-like words as secrets when unset", () => {
    process.env.AI_PRODUCTION_CONFIRM = "not-the-real-token";
    expect(() =>
      assertNoSecretLeak("please confirm your understanding"),
    ).not.toThrow();
  });
});

describe("smoke opt-in and CI isolation", () => {
  it("requires AI_SMOKE_TEST_ALLOW=1", () => {
    applyEnv({ OPENAI_API_KEY: "sk-x" });
    expect(() => assertSmokeOptIn()).toThrow(/AI_SMOKE_TEST_ALLOW/);
  });

  it("API key alone cannot satisfy smoke opt-in", () => {
    applyEnv({
      OPENAI_API_KEY: "sk-x",
      AI_PRODUCTION_ENABLED: "true",
      AI_PRODUCTION_CONFIRM: AI_PRODUCTION_CONFIRM_VALUE,
      AI_PROVIDER: "openai",
    });
    expect(() => assertSmokeOptIn()).toThrow(/AI_SMOKE_TEST_ALLOW/);
    expect(isProductionAIReady(process.env)).toBe(true);
  });

  it("refuses CI=true and GITHUB_ACTIONS=true", () => {
    applyEnv({ AI_SMOKE_TEST_ALLOW: "1", CI: "true" });
    expect(() => assertNotRunningInCI()).toThrow(/CI/);
    applyEnv({ AI_SMOKE_TEST_ALLOW: "1", GITHUB_ACTIONS: "true" });
    expect(() => assertNotRunningInCI()).toThrow(/GitHub Actions/);
  });

  it("missing confirmation cannot pass the production gate", () => {
    applyEnv(
      productionReadyEnv({
        AI_PRODUCTION_CONFIRM: undefined,
      }),
    );
    expect(() => assertProductionGateReadyForSmoke()).toThrow(
      /Production gate not ready|failed closed/i,
    );
  });

  it("invalid production configuration fails closed (no stub)", () => {
    applyEnv(
      productionReadyEnv({
        OPENAI_BASE_URL: "http://localhost:1",
      }),
    );
    expect(() => assertProductionGateReadyForSmoke()).toThrow(
      SmokePreconditionsError,
    );
  });
});

describe("ops logger controlled fields", () => {
  it("rejects sensitive detail", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logAIOps({
      event: "smoke_test",
      detail: "api_key=sk-should-not-appear",
    });
    const printed = info.mock.calls.map((c) => JSON.stringify(c)).join("\n");
    expect(printed).not.toContain("sk-should-not-appear");
    expect(printed).toContain("log_suppressed");
  });

  it("rejects unknown provider / outcome / executionCertainty", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logAIOps({
      event: "smoke_test",
      // @ts-expect-error intentional invalid provider for runtime guard
      provider: "not-a-provider",
      outcome: "success",
    });
    logAIOps({
      event: "smoke_test",
      provider: "openai",
      // @ts-expect-error intentional invalid outcome
      outcome: "totally_made_up",
    });
    logAIOps({
      event: "smoke_test",
      provider: "openai",
      outcome: "success",
      // @ts-expect-error intentional invalid certainty
      executionCertainty: "maybe",
    });
    const printed = info.mock.calls.map((c) => JSON.stringify(c)).join("\n");
    expect(printed).not.toContain("not-a-provider");
    expect(printed).not.toContain("totally_made_up");
    expect(printed).not.toContain('"maybe"');
    expect(printed).toContain("log_suppressed");
  });

  it("accepts valid operational fields", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logAIOps({
      event: "provider_complete",
      provider: "openai",
      modelKey: "flux-fast",
      outcome: "success",
      executionCertainty: "dispatched",
      latencyMs: 12,
      detail: "chars=40",
    });
    const printed = info.mock.calls.map((c) => JSON.stringify(c)).join("\n");
    expect(printed).toContain("flux-fast");
    expect(printed).toContain("success");
    expect(printed).toContain("dispatched");
    expect(printed).not.toContain("log_suppressed");
  });
});

describe("smoke Study-path seam (mocked)", () => {
  it("invokes executeStudyTurnForActor and does not call provider.complete itself", async () => {
    applyEnv(productionReadyEnv());
    const complete = vi.fn(async () => {
      throw new Error("smoke must not call provider.complete directly");
    });
    const executeTurn = vi.fn(
      async (_args: {
        actorUserId: string;
        raw: Record<string, unknown>;
      }): Promise<{
        ok: true;
        reply: string;
        assistanceMode: string;
        taskType: string;
        requiresStudentParticipation: boolean;
        replyTruncated: boolean;
        contextVersion: string;
        composedMessage: string;
        intent: typeof SMOKE_STUDY_INTENT;
        modelKey: string;
        usage: {
          inputTokens: number;
          outputTokens: number;
          estimatedCostMicros: number;
          latencyMs: number;
        };
        proposals: [];
      }> => {
        void _args;
        return {
          ok: true as const,
          reply: "What is the product rule asking you to identify?",
          assistanceMode: "ask_question",
          taskType: "general_conversation",
          requiresStudentParticipation: true,
          replyTruncated: false,
          contextVersion: "test",
          composedMessage: SMOKE_STUDY_MESSAGE,
          intent: SMOKE_STUDY_INTENT,
          modelKey: "flux-fast",
          usage: {
            inputTokens: 10,
            outputTokens: 8,
            estimatedCostMicros: 1,
            latencyMs: 5,
          },
          proposals: [],
        };
      },
    );

    const createActor = vi.fn(async () => ({
      userId: "smoke-actor-id",
      email: "ai-smoke@fluxlabs.smoke.local",
      cleanup: vi.fn(async () => {}),
    }));

    const report = await runStudyPathProductionSmoke({
      executeTurn: executeTurn as typeof executeStudyTurnForActor,
      createActor,
      allowTestProviderOverride: true,
      getProvider: () =>
        ({
          id: "openai",
          complete,
        }) as AIProvider,
      resetProvider: () => {},
    });

    expect(executeTurn).toHaveBeenCalledTimes(1);
    expect(executeTurn.mock.calls[0]?.[0]).toEqual({
      actorUserId: "smoke-actor-id",
      raw: buildSmokeStudyRaw(),
    });
    expect(complete).not.toHaveBeenCalled();
    expect(report.ok).toBe(true);
    expect(report.replyNonEmpty).toBe(true);
    expect(report.modelKey).toBe("flux-fast");
    expect(report.accountingOutcome).toBe("success");
  });

  it("rejects client/smoke-supplied userId on the Study raw payload", async () => {
    const denied = await executeStudyTurnForActor({
      actorUserId: "server-owned-actor",
      raw: {
        message: SMOKE_STUDY_MESSAGE,
        intent: SMOKE_STUDY_INTENT,
        userId: "attacker-injected",
      },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.message).toMatch(/user identity|userId/i);
    }
  });

  it("buildSmokeStudyRaw only supplies legitimate Study client fields", () => {
    const raw = buildSmokeStudyRaw();
    expect(raw).toEqual({
      message: SMOKE_STUDY_MESSAGE,
      intent: SMOKE_STUDY_INTENT,
    });
    for (const forbidden of [
      "userId",
      "actorUserId",
      "assistanceMode",
      "policyMode",
      "systemDirective",
      "taskType",
      "modelKey",
      "provider",
      "studentModel",
      "academicWorkspace",
    ]) {
      expect(raw).not.toHaveProperty(forbidden);
    }
  });

  it("refuses to run when smoke opt-in is missing even if gate is ready", async () => {
    applyEnv(productionReadyEnv({ AI_SMOKE_TEST_ALLOW: undefined }));
    await expect(
      runStudyPathProductionSmoke({
        allowTestProviderOverride: true,
        executeTurn: async () => {
          throw new Error("should not execute");
        },
        createActor: async () => {
          throw new Error("should not create actor");
        },
      }),
    ).rejects.toThrow(/AI_SMOKE_TEST_ALLOW/);
  });
});

describe("Study-path smoke integration (mocked provider, real DB)", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(() => {
    resetAIProvider();
  });

  afterEach(async () => {
    resetAIProvider();
    await prisma.user.deleteMany({
      where: { email: { endsWith: "@fluxlabs.smoke.local" } },
    });
  });

  it("reserves, dispatches via orchestration, validates, and settles", async () => {
    applyEnv(productionReadyEnv());

    let providerCompleteCalls = 0;
    const mockProvider: AIProvider = {
      id: "openai",
      async complete(request) {
        providerCompleteCalls += 1;
        expect(request.modelKey).toMatch(/^flux-/);
        expect(request.messages.some((m) => m.role === "system")).toBe(true);
        const joined = request.messages.map((m) => m.content).join("\n");
        expect(joined.toLowerCase()).not.toMatch(/here is the full solution/);
        return {
          content:
            "Good question — what two functions are being multiplied in the product?",
          modelKey: request.modelKey,
          provider: "openai",
          inputTokens: 40,
          outputTokens: 20,
          estimatedCostMicros: 100,
          latencyMs: 3,
        };
      },
    };
    setAIProvider(mockProvider);

    const actor = await createIsolatedSmokeActor();
    try {
      const result = await executeStudyTurnForActor({
        actorUserId: actor.userId,
        raw: buildSmokeStudyRaw(),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(providerCompleteCalls).toBe(1);
      expect(result.reply.trim().length).toBeGreaterThan(0);
      expect(result.assistanceMode.length).toBeGreaterThan(0);
      expect(result.taskType.length).toBeGreaterThan(0);
      expect(buildSmokeStudyRaw()).not.toHaveProperty("assistanceMode");

      const op = await prisma.aiUsageOperation.findFirstOrThrow({
        where: { userId: actor.userId },
        orderBy: { createdAt: "desc" },
      });
      expect(op.status).toBe("SETTLED");
      expect(op.modelKey).toMatch(/^flux-/);

      const usage = await prisma.usageRecord.findFirstOrThrow({
        where: { userId: actor.userId },
        orderBy: { createdAt: "desc" },
      });
      expect(usage.success).toBe(true);

      const trial = await prisma.trial.findUniqueOrThrow({
        where: { userId: actor.userId },
      });
      expect(trial.aiSessionsUsed).toBeGreaterThanOrEqual(1);
    } finally {
      await actor.cleanup();
    }
  });

  it("runStudyPathProductionSmoke settles through Study path with DI provider", async () => {
    applyEnv(productionReadyEnv());
    setAIProvider({
      id: "openai",
      async complete(request) {
        return {
          content:
            "Which factors appear in the product you plan to differentiate?",
          modelKey: request.modelKey,
          provider: "openai",
          inputTokens: 30,
          outputTokens: 16,
          estimatedCostMicros: 50,
          latencyMs: 2,
        };
      },
    });

    const report = await runStudyPathProductionSmoke({
      allowTestProviderOverride: true,
    });

    expect(report.ok).toBe(true);
    expect(report.provider).toBe("openai");
    expect(report.replyNonEmpty).toBe(true);
    expect(report.accountingOutcome).toBe("success");
    expect(report.outputChars).toBeGreaterThan(0);
  });

  it("dispatched/ambiguous failures still consume; config failures release", async () => {
    expect(
      settlementOutcomeForProviderError(new AIProviderRateLimitError()),
    ).toBe("failed_consumed");
    expect(
      settlementOutcomeForProviderError(new AIProviderConfigError("missing")),
    ).toBe("failed_released");

    applyEnv(productionReadyEnv());
    setAIProvider({
      id: "openai",
      async complete() {
        throw new AIProviderRateLimitError("rate limited");
      },
    });

    const actor = await createIsolatedSmokeActor();
    try {
      const result = await executeStudyTurnForActor({
        actorUserId: actor.userId,
        raw: buildSmokeStudyRaw(),
      });
      expect(result.ok).toBe(false);

      const op = await prisma.aiUsageOperation.findFirstOrThrow({
        where: { userId: actor.userId },
        orderBy: { createdAt: "desc" },
      });
      expect(op.status).toBe("SETTLED");
    } finally {
      await actor.cleanup();
    }
  });

  it("not-dispatched config errors release the reservation", async () => {
    applyEnv(productionReadyEnv());
    setAIProvider({
      id: "openai",
      async complete() {
        throw new AIProviderConfigError("not ready");
      },
    });

    const actor = await createIsolatedSmokeActor();
    try {
      const result = await executeStudyTurnForActor({
        actorUserId: actor.userId,
        raw: buildSmokeStudyRaw(),
      });
      expect(result.ok).toBe(false);

      const op = await prisma.aiUsageOperation.findFirstOrThrow({
        where: { userId: actor.userId },
        orderBy: { createdAt: "desc" },
      });
      expect(op.status).toBe("RELEASED");
    } finally {
      await actor.cleanup();
    }
  });

  it("kill switch still forces stub when production is disabled", () => {
    applyEnv(productionReadyEnv({ AI_PRODUCTION_ENABLED: "false" }));
    resetAIProvider();
    expect(getAIProvider()).toBeInstanceOf(StubAIProvider);
    expect(getAIProvider().id).toBe("stub");
  });

  it("does not silently stub when production is requested but incomplete", () => {
    applyEnv(
      productionReadyEnv({
        AI_PRODUCTION_CONFIRM: "WRONG",
      }),
    );
    expect(() => assertProductionGateReadyForSmoke()).toThrow(
      SmokePreconditionsError,
    );
  });
});
