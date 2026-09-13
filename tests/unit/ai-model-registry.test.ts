import { describe, expect, it } from "vitest";
import {
  assertO200kModel,
  defaultVerifiedVendorModelIds,
  getVerifiedModelMapping,
  listInternalModelKeys,
  O200K_BASE_VENDOR_MODEL_ALLOWLIST,
  resolveVerifiedModelBinding,
  resolveVerifiedTokenizerEncoding,
  resolveVerifiedVendorModelId,
  resolveVerifiedVendorModelIds,
  VERIFIED_MODEL_ENCODING_REGISTRY,
} from "@/lib/ai/model-registry";
import {
  AI_PROVIDER_DEFAULTS,
  resolveAIProviderConfig,
} from "@/lib/ai/provider-config";
import { AIProviderConfigError } from "@/lib/ai/provider-errors";
import { OpenAIChatProvider } from "@/lib/ai/providers/openai-chat";
import {
  countBillableInputTokens,
  PRODUCTION_OPENAI_ENCODING,
} from "@/lib/ai/tokenization";
import type { AICompletionRequest, InternalModelKey } from "@/lib/ai/types";
import {
  INTERNAL_MODEL_COST_TABLE,
  reservationCostCeilingMicros,
} from "@/lib/entitlements/cost-table";
import { assertNoClientStudyAuthority } from "@/lib/study/client-guards";

describe("verified model/encoding registry", () => {
  it("maps every internal model key to an explicitly verified o200k_base encoding", () => {
    for (const key of listInternalModelKeys()) {
      const mapping = getVerifiedModelMapping(key);
      expect(mapping.internalModelKey).toBe(key);
      expect(mapping.encoding).toBe("o200k_base");
      expect(resolveVerifiedTokenizerEncoding(key)).toBe("o200k_base");
      expect(O200K_BASE_VENDOR_MODEL_ALLOWLIST).toContain(mapping.vendorModelId);
      expect(() => assertO200kModel(key)).not.toThrow();
    }
  });

  it("uses verified production defaults (gpt-4o-mini / gpt-4o → o200k_base)", () => {
    expect(VERIFIED_MODEL_ENCODING_REGISTRY["flux-fast"]).toMatchObject({
      vendorModelId: "gpt-4o-mini",
      encoding: "o200k_base",
    });
    expect(VERIFIED_MODEL_ENCODING_REGISTRY["flux-standard"]).toMatchObject({
      vendorModelId: "gpt-4o-mini",
      encoding: "o200k_base",
    });
    expect(VERIFIED_MODEL_ENCODING_REGISTRY["flux-advanced"]).toMatchObject({
      vendorModelId: "gpt-4o",
      encoding: "o200k_base",
    });
    expect(PRODUCTION_OPENAI_ENCODING).toBe("o200k_base");
    expect(defaultVerifiedVendorModelIds()).toEqual({
      "flux-fast": "gpt-4o-mini",
      "flux-standard": "gpt-4o-mini",
      "flux-advanced": "gpt-4o",
    });
    expect(AI_PROVIDER_DEFAULTS.modelIds).toEqual(
      defaultVerifiedVendorModelIds(),
    );
  });

  it("fails closed for unknown internal model keys (no silent o200k_base)", () => {
    const unknown = "not-a-model" as InternalModelKey;
    expect(() => assertO200kModel(unknown)).toThrow(AIProviderConfigError);
    expect(() => resolveVerifiedTokenizerEncoding(unknown)).toThrow(
      AIProviderConfigError,
    );
    expect(() =>
      countBillableInputTokens({
        modelKey: unknown,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).toThrow(AIProviderConfigError);
  });

  it("rejects unsupported vendor model IDs before provider dispatch", () => {
    expect(() =>
      resolveVerifiedVendorModelId("flux-standard", "gpt-3.5-turbo"),
    ).toThrow(/not allowlisted/i);

    expect(() =>
      resolveVerifiedVendorModelIds({
        "flux-fast": "gpt-4o-mini",
        "flux-standard": "o1-preview",
        "flux-advanced": "gpt-4o",
      }),
    ).toThrow(AIProviderConfigError);

    expect(
      () =>
        new OpenAIChatProvider({
          apiKey: "sk-test",
          baseUrl: "https://api.openai.com/v1",
          timeoutMs: 5_000,
          maxOutputTokens: 100,
          maxInputTokens: 1_000,
          modelIds: {
            "flux-fast": "gpt-4o-mini",
            "flux-standard": "gpt-3.5-turbo",
            "flux-advanced": "gpt-4o",
          },
        }),
    ).toThrow(AIProviderConfigError);
  });

  it("allows only allowlisted env vendor model overrides", () => {
    const ok = resolveAIProviderConfig({
      AI_MODEL_FLUX_FAST: "gpt-4o",
      AI_MODEL_FLUX_STANDARD: "gpt-4o-mini",
      AI_MODEL_FLUX_ADVANCED: "gpt-4o-mini",
    });
    expect(ok.modelIds["flux-fast"]).toBe("gpt-4o");
    expect(ok.modelIds["flux-standard"]).toBe("gpt-4o-mini");
    expect(ok.modelIds["flux-advanced"]).toBe("gpt-4o-mini");

    expect(() =>
      resolveAIProviderConfig({
        AI_MODEL_FLUX_STANDARD: "gpt-4-turbo",
      }),
    ).toThrow(AIProviderConfigError);

    expect(() =>
      resolveAIProviderConfig({
        AI_MODEL_FLUX_ADVANCED: "claude-3-opus",
      }),
    ).toThrow(AIProviderConfigError);
  });

  it("does not let clients inject vendor model / provider authority", () => {
    expect(() =>
      assertNoClientStudyAuthority({ modelKey: "flux-advanced" }),
    ).toThrow(/cannot supply modelKey/i);
    expect(() =>
      assertNoClientStudyAuthority({ provider: "openai" }),
    ).toThrow(/cannot supply provider/i);
    expect(() =>
      assertNoClientStudyAuthority({ apiKey: "sk-x" }),
    ).toThrow(/cannot supply apiKey/i);
    expect(() =>
      assertNoClientStudyAuthority({ maxTokens: 99999 }),
    ).toThrow(/cannot supply maxTokens/i);
  });

  it("keeps provider mapping, tokenizer encoding, and reservation cost aligned", () => {
    const config = resolveAIProviderConfig({});
    for (const key of listInternalModelKeys()) {
      const binding = resolveVerifiedModelBinding(key, config.modelIds[key]);
      expect(binding.encoding).toBe("o200k_base");
      expect(config.modelIds[key]).toBe(binding.vendorModelId);
      expect(INTERNAL_MODEL_COST_TABLE[key]).toBeDefined();

      const reserved = reservationCostCeilingMicros({
        capability: "AI_SESSION",
        modelKey: key,
      });
      expect(reserved).toBeGreaterThan(0);

      const req: AICompletionRequest = {
        modelKey: key,
        messages: [{ role: "user", content: "Align registry paths." }],
      };
      expect(countBillableInputTokens(req)).toBeGreaterThan(0);
      assertO200kModel(key);
    }
  });

  it("OpenAI provider dispatches only registry-verified vendor model IDs", async () => {
    let dispatchedModel: string | null = null;
    const provider = new OpenAIChatProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      timeoutMs: 5_000,
      maxOutputTokens: 64,
      maxInputTokens: 1_000,
      modelIds: defaultVerifiedVendorModelIds(),
      fetchImpl: (async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          model?: string;
        };
        dispatchedModel = body.model ?? null;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 3, completion_tokens: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch,
    });

    await provider.complete({
      modelKey: "flux-standard",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(dispatchedModel).toBe("gpt-4o-mini");
    expect(O200K_BASE_VENDOR_MODEL_ALLOWLIST).toContain(dispatchedModel!);
  });
});
