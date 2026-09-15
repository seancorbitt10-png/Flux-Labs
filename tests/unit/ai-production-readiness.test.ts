/**
 * Production AI operational readiness / hardening coverage.
 *
 * Complements existing unit + integration suites with explicit checks for:
 * - kill switch after cached OpenAI construction
 * - fail-closed incomplete production gate (no silent stub)
 * - rate-limit → consume settlement mapping
 * - client error normalization (no secret / upstream leak)
 * - smoke-test opt-in contract (CI must never auto-run real OpenAI)
 * - ops log refusal of sensitive detail
 *
 * These tests never contact OpenAI. CI remains non-billable.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_PRODUCTION_CONFIRM_VALUE,
  getAIProductionGateStatus,
  isProductionAIEnabled,
  isProductionAIReady,
  resolveAIProviderConfig,
} from "@/lib/ai/provider-config";
import {
  AIProviderConfigError,
  AIProviderInvalidResponseError,
  AIProviderRateLimitError,
  AIProviderTimeoutError,
  AIProviderUpstreamError,
} from "@/lib/ai/provider-errors";
import { createAIProviderFromConfig } from "@/lib/ai/provider-factory";
import {
  getAIProvider,
  resetAIProvider,
  StubAIProvider,
} from "@/lib/ai/provider";
import { OpenAIChatProvider } from "@/lib/ai/providers/openai-chat";
import { logAIOps } from "@/lib/ai/ops-log";
import { settlementOutcomeForProviderError } from "@/lib/entitlements/operations";
import { toClientError } from "@/lib/errors";
import type { AIProvider } from "@/lib/ai/types";

function productionReadyEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    AI_PRODUCTION_ENABLED: "true",
    AI_PRODUCTION_CONFIRM: AI_PRODUCTION_CONFIRM_VALUE,
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-live-test-not-real",
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
] as const;

afterEach(() => {
  resetAIProvider();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe("production AI kill switch", () => {
  it("drops cached OpenAI when AI_PRODUCTION_ENABLED is turned off", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    Object.assign(process.env, productionReadyEnv());
    resetAIProvider();
    const first = getAIProvider();
    expect(first).toBeInstanceOf(OpenAIChatProvider);
    expect(first.id).toBe("openai");

    // Operational kill switch — no process restart required for subsequent gets.
    process.env.AI_PRODUCTION_ENABLED = "false";
    const afterKill = getAIProvider();
    expect(afterKill).toBeInstanceOf(StubAIProvider);
    expect(afterKill.id).toBe("stub");
    expect(isProductionAIEnabled(process.env)).toBe(false);
    expect(isProductionAIReady(process.env)).toBe(false);

    info.mockRestore();
  });

  it("factory returns stub when production flag is false even with key+confirm", () => {
    const provider = createAIProviderFromConfig({
      ...productionReadyEnv(),
      AI_PRODUCTION_ENABLED: "false",
    });
    expect(provider).toBeInstanceOf(StubAIProvider);
    expect(
      getAIProductionGateStatus({
        ...productionReadyEnv(),
        AI_PRODUCTION_ENABLED: "false",
      }).ready,
    ).toBe(false);
  });
});

describe("production gate fail-closed matrix", () => {
  it("never silently stubs while the production flag is on", () => {
    const incomplete: Record<string, string | undefined>[] = [
      {
        AI_PRODUCTION_ENABLED: "true",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-x",
      },
      {
        AI_PRODUCTION_ENABLED: "true",
        AI_PRODUCTION_CONFIRM: AI_PRODUCTION_CONFIRM_VALUE,
        AI_PROVIDER: "stub",
        OPENAI_API_KEY: "sk-x",
      },
      {
        AI_PRODUCTION_ENABLED: "true",
        AI_PRODUCTION_CONFIRM: AI_PRODUCTION_CONFIRM_VALUE,
        AI_PROVIDER: "openai",
      },
      {
        AI_PRODUCTION_ENABLED: "true",
        AI_PRODUCTION_CONFIRM: AI_PRODUCTION_CONFIRM_VALUE,
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-x",
        OPENAI_BASE_URL: "http://localhost:1",
      },
    ];

    for (const env of incomplete) {
      expect(() => resolveAIProviderConfig(env)).toThrow(AIProviderConfigError);
      expect(() => createAIProviderFromConfig(env)).toThrow(
        AIProviderConfigError,
      );
    }
  });

  it("key alone or confirm alone never enables production AI", () => {
    expect(
      isProductionAIReady({
        OPENAI_API_KEY: "sk-x",
        AI_PROVIDER: "openai",
      }),
    ).toBe(false);
    expect(
      isProductionAIReady({
        AI_PRODUCTION_CONFIRM: AI_PRODUCTION_CONFIRM_VALUE,
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-x",
      }),
    ).toBe(false);
    expect(createAIProviderFromConfig({ OPENAI_API_KEY: "sk-x" }).id).toBe(
      "stub",
    );
  });
});

describe("provider error → settlement certainty", () => {
  it("maps rate-limit and ambiguous failures to consume; config to release", () => {
    expect(
      settlementOutcomeForProviderError(new AIProviderRateLimitError()),
    ).toBe("failed_consumed");
    expect(
      settlementOutcomeForProviderError(new AIProviderTimeoutError()),
    ).toBe("failed_consumed");
    expect(
      settlementOutcomeForProviderError(new AIProviderUpstreamError()),
    ).toBe("failed_consumed");
    expect(
      settlementOutcomeForProviderError(new AIProviderInvalidResponseError()),
    ).toBe("failed_consumed");
    expect(
      settlementOutcomeForProviderError(new AIProviderConfigError("missing")),
    ).toBe("failed_released");
    expect(settlementOutcomeForProviderError(new Error("network"))).toBe(
      "failed_consumed",
    );
  });
});

describe("client-visible error normalization", () => {
  it("does not leak API keys, confirm secrets, or raw upstream bodies", () => {
    const errors = [
      new AIProviderRateLimitError("OpenAI rate limit exceeded"),
      new AIProviderUpstreamError("OpenAI upstream failure (HTTP 500)"),
      new AIProviderTimeoutError("OpenAI request timed out after 25000ms"),
      new AIProviderInvalidResponseError("OpenAI returned non-JSON response"),
      new AIProviderConfigError(
        "OPENAI_API_KEY is required when production AI is enabled.",
      ),
    ];

    for (const error of errors) {
      const client = toClientError(error);
      const payload = JSON.stringify(client);
      expect(payload).not.toMatch(/sk-live|Bearer\s+sk/i);
      expect(client.message).not.toMatch(/sk-[a-zA-Z0-9]/);
      expect(typeof client.message).toBe("string");
      expect(client.message.length).toBeGreaterThan(0);
    }
  });
});

describe("mocked provider rate-limit path", () => {
  it("propagates rate-limit errors from a DI provider without stub substitution", async () => {
    const { setAIProvider } = await import("@/lib/ai/provider");
    const rateLimited: AIProvider = {
      id: "mock-openai",
      async complete() {
        throw new AIProviderRateLimitError("rate limited");
      },
    };
    setAIProvider(rateLimited);

    expect(getAIProvider().id).toBe("mock-openai");
    await expect(
      getAIProvider().complete({
        modelKey: "flux-fast",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toBeInstanceOf(AIProviderRateLimitError);
  });
});

describe("manual smoke-test safety contract", () => {
  it("does not opt into smoke testing by default", () => {
    expect(process.env.AI_SMOKE_TEST_ALLOW ?? "").not.toBe("1");
  });

  it("ops log suppresses details that look like secrets", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logAIOps({
      event: "smoke_test",
      detail: "api_key=sk-should-not-appear",
    });
    const printed = info.mock.calls.map((c) => JSON.stringify(c)).join("\n");
    expect(printed).not.toContain("sk-should-not-appear");
    expect(printed).toContain("log_suppressed");
    info.mockRestore();
  });

  it("ops log allows non-sensitive operational fields", () => {
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
    expect(info).toHaveBeenCalled();
    const printed = info.mock.calls.map((c) => JSON.stringify(c)).join("\n");
    expect(printed).toContain("flux-fast");
    expect(printed).toContain("dispatched");
    expect(printed).not.toContain("log_suppressed");
    info.mockRestore();
  });

  it("assertNoSecretLeak catches API key and confirm-token leakage", async () => {
    const { assertNoSecretLeak, SmokePreconditionsError } = await import(
      "@/lib/ai/production-smoke"
    );
    process.env.OPENAI_API_KEY = "sk-readiness-leak-probe";
    process.env.AI_PRODUCTION_CONFIRM = AI_PRODUCTION_CONFIRM_VALUE;
    expect(() =>
      assertNoSecretLeak("err sk-readiness-leak-probe"),
    ).toThrow(SmokePreconditionsError);
    expect(() =>
      assertNoSecretLeak(`x=${AI_PRODUCTION_CONFIRM_VALUE}`),
    ).toThrow(/AI_PRODUCTION_CONFIRM/);
  });
});
