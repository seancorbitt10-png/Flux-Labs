import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_PROVIDER_DEFAULTS,
  isProductionAIEnabled,
  resolveAIProviderConfig,
} from "@/lib/ai/provider-config";
import { AI_REQUEST_ENVELOPE } from "@/lib/ai/request-envelope";
import {
  AIProviderConfigError,
  AIProviderInvalidResponseError,
  AIProviderLimitError,
  AIProviderRateLimitError,
  AIProviderTimeoutError,
  AIProviderUpstreamError,
} from "@/lib/ai/provider-errors";
import { createAIProviderFromConfig } from "@/lib/ai/provider-factory";
import {
  getAIProvider,
  resetAIProvider,
  setAIProvider,
  StubAIProvider,
} from "@/lib/ai/provider";
import { OpenAIChatProvider } from "@/lib/ai/providers/openai-chat";
import { toClientError } from "@/lib/errors";
import { assertNoClientStudyAuthority } from "@/lib/study/client-guards";
import type { AICompletionRequest } from "@/lib/ai/types";

const baseRequest: AICompletionRequest = {
  modelKey: "flux-standard",
  messages: [
    { role: "system", content: "You are Flux." },
    { role: "user", content: "Help me study." },
  ],
  maxTokens: 200,
};

afterEach(() => {
  resetAIProvider();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AI provider configuration gate", () => {
  it("keeps production AI disabled by default", () => {
    expect(isProductionAIEnabled({})).toBe(false);
    expect(isProductionAIEnabled({ OPENAI_API_KEY: "sk-test" })).toBe(false);
    expect(
      isProductionAIEnabled({
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-test",
      }),
    ).toBe(false);
  });

  it("requires explicit AI_PRODUCTION_ENABLED=true for openai", () => {
    const stubbed = resolveAIProviderConfig({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
    });
    expect(stubbed.kind).toBe("stub");
    expect(stubbed.openaiApiKey).toBeNull();

    const enabled = resolveAIProviderConfig({
      AI_PRODUCTION_ENABLED: "true",
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-live",
    });
    expect(enabled.kind).toBe("openai");
    expect(enabled.openaiApiKey).toBe("sk-live");
    expect(enabled.timeoutMs).toBe(AI_PROVIDER_DEFAULTS.timeoutMs);
  });

  it("falls back to stub when production enabled but provider is stub", () => {
    const config = resolveAIProviderConfig({
      AI_PRODUCTION_ENABLED: "true",
      AI_PROVIDER: "stub",
      OPENAI_API_KEY: "sk-live",
    });
    expect(config.kind).toBe("stub");
    expect(config.openaiApiKey).toBeNull();
  });
});

describe("provider factory", () => {
  it("returns stub by default (no production gate)", () => {
    const provider = createAIProviderFromConfig({});
    expect(provider).toBeInstanceOf(StubAIProvider);
    expect(provider.id).toBe("stub");
  });

  it("returns stub when API key exists but production is off", () => {
    const provider = createAIProviderFromConfig({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-should-not-activate",
    });
    expect(provider).toBeInstanceOf(StubAIProvider);
  });

  it("fails closed when openai is selected without a key", () => {
    expect(() =>
      createAIProviderFromConfig({
        AI_PRODUCTION_ENABLED: "true",
        AI_PROVIDER: "openai",
      }),
    ).toThrow(AIProviderConfigError);
  });

  it("getAIProvider caches env resolution until reset", async () => {
    resetAIProvider();
    const a = getAIProvider();
    const b = getAIProvider();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(StubAIProvider);

    const custom = new StubAIProvider();
    setAIProvider(custom);
    expect(getAIProvider()).toBe(custom);

    resetAIProvider();
    expect(getAIProvider()).toBeInstanceOf(StubAIProvider);
  });
});

describe("StubAIProvider", () => {
  it("remains functional without network or secrets", async () => {
    const stub = new StubAIProvider();
    const result = await stub.complete(baseRequest);
    expect(result.provider).toBe("stub");
    expect(result.modelKey).toBe("flux-standard");
    expect(result.content).toContain("Flux");
    expect(result.estimatedCostMicros).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("OpenAIChatProvider", () => {
  function makeProvider(fetchImpl: typeof fetch, overrides?: Partial<{
    timeoutMs: number;
    maxOutputTokens: number;
    maxInputTokens: number;
  }>) {
    return new OpenAIChatProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      timeoutMs: overrides?.timeoutMs ?? 5_000,
      maxOutputTokens: overrides?.maxOutputTokens ?? 800,
      maxInputTokens: overrides?.maxInputTokens ?? AI_PROVIDER_DEFAULTS.maxInputTokens,
      modelIds: AI_PROVIDER_DEFAULTS.modelIds,
      fetchImpl,
    });
  }

  it("maps successful chat completions to AICompletionResult", async () => {
    const fetchImpl = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "  Guided hint  " } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    const result = await provider.complete(baseRequest);

    expect(result.provider).toBe("openai");
    expect(result.modelKey).toBe("flux-standard");
    expect(result.content).toBe("Guided hint");
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(result.estimatedCostMicros).toBeGreaterThan(0);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    const body = JSON.parse(String(init!.body));
    expect(body.model).toBe(AI_PROVIDER_DEFAULTS.modelIds["flux-standard"]);
    expect(body.max_tokens).toBeLessThanOrEqual(800);
    expect(init!.headers).toMatchObject({
      Authorization: "Bearer sk-test",
    });
  });

  it("clamps maxTokens to server max (client cannot raise)", async () => {
    const fetchImpl = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      ),
    );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch, {
      maxOutputTokens: 100,
    });
    await provider.complete({ ...baseRequest, maxTokens: 50_000 });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    const body = JSON.parse(String(init!.body));
    expect(body.max_tokens).toBe(100);
  });

  it("rejects oversized input", async () => {
    const provider = makeProvider(vi.fn() as unknown as typeof fetch, {
      maxInputTokens: 20,
    });
    await expect(
      provider.complete({
        ...baseRequest,
        messages: [{ role: "user", content: "x".repeat(200) }],
      }),
    ).rejects.toBeInstanceOf(AIProviderLimitError);
  });

  it("enforces timeout via AbortSignal", async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            return;
          }
          signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    );

    const provider = makeProvider(fetchImpl as unknown as typeof fetch, {
      timeoutMs: 30,
    });

    await expect(provider.complete(baseRequest)).rejects.toBeInstanceOf(
      AIProviderTimeoutError,
    );
  });

  it("normalizes upstream HTTP failures", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("boom", { status: 500 }),
    );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await expect(provider.complete(baseRequest)).rejects.toBeInstanceOf(
      AIProviderUpstreamError,
    );
  });

  it("normalizes rate limits", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("slow down", { status: 429 }),
    );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await expect(provider.complete(baseRequest)).rejects.toBeInstanceOf(
      AIProviderRateLimitError,
    );
  });

  it("rejects malformed JSON safely", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("not-json", { status: 200 }),
    );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await expect(provider.complete(baseRequest)).rejects.toBeInstanceOf(
      AIProviderInvalidResponseError,
    );
  });

  it("rejects missing message content", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: {} }] }), {
        status: 200,
      }),
    );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await expect(provider.complete(baseRequest)).rejects.toBeInstanceOf(
      AIProviderInvalidResponseError,
    );
  });

  it("bounds oversized provider output", async () => {
    const huge = "A".repeat(12_000);
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: huge } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      ),
    );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    const result = await provider.complete(baseRequest);
    expect(result.content.length).toBeLessThanOrEqual(8_000);
  });

  it("does not expose raw provider errors to students", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Invalid API key sk-secret-should-not-leak",
            },
          }),
          { status: 200 },
        ),
    );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    try {
      await provider.complete(baseRequest);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AIProviderUpstreamError);
      const client = toClientError(error);
      expect(client.message).not.toMatch(/sk-secret|Invalid API key/i);
      expect(client.message).toMatch(/temporarily unavailable|try again/i);
    }
  });

  it("throws config error when constructed without api key", () => {
    expect(
      () =>
        new OpenAIChatProvider({
          apiKey: "",
          baseUrl: "https://api.openai.com/v1",
          timeoutMs: 1000,
          maxOutputTokens: 100,
          maxInputTokens: 1000,
          modelIds: AI_PROVIDER_DEFAULTS.modelIds,
        }),
    ).toThrow(AIProviderConfigError);
  });
});

describe("client cannot select provider/model", () => {
  it("rejects provider and modelKey on Study payloads", () => {
    expect(() =>
      assertNoClientStudyAuthority({ provider: "openai" }),
    ).toThrow(/cannot supply provider/i);
    expect(() =>
      assertNoClientStudyAuthority({ modelKey: "flux-advanced" }),
    ).toThrow(/cannot supply modelKey/i);
    expect(() =>
      assertNoClientStudyAuthority({ apiKey: "sk-x" }),
    ).toThrow(/cannot supply apiKey/i);
    expect(() =>
      assertNoClientStudyAuthority({ temperature: 1.5 }),
    ).toThrow(/cannot supply temperature/i);
    expect(() =>
      assertNoClientStudyAuthority({ maxTokens: 99999 }),
    ).toThrow(/cannot supply maxTokens/i);
  });

  it("clamps env input/output limits to the authoritative request envelope", () => {
    const raised = resolveAIProviderConfig({
      AI_MAX_INPUT_TOKENS: "500000",
      AI_MAX_OUTPUT_TOKENS: "4096",
    });
    expect(raised.maxInputTokens).toBe(AI_REQUEST_ENVELOPE.maxInputTokens);
    expect(raised.maxOutputTokens).toBe(AI_REQUEST_ENVELOPE.maxOutputTokens);

    const lowered = resolveAIProviderConfig({
      AI_MAX_INPUT_TOKENS: "2000",
      AI_MAX_OUTPUT_TOKENS: "100",
    });
    expect(lowered.maxInputTokens).toBe(2000);
    expect(lowered.maxOutputTokens).toBe(100);
  });

  it("defaults provider limits to the authoritative request envelope", () => {
    expect(AI_PROVIDER_DEFAULTS.maxInputTokens).toBe(AI_REQUEST_ENVELOPE.maxInputTokens);
    expect(AI_PROVIDER_DEFAULTS.maxOutputTokens).toBe(AI_REQUEST_ENVELOPE.maxOutputTokens);
    const config = resolveAIProviderConfig({});
    expect(config.maxInputTokens).toBe(AI_REQUEST_ENVELOPE.maxInputTokens);
    expect(config.maxOutputTokens).toBe(AI_REQUEST_ENVELOPE.maxOutputTokens);
  });

});
