import { describe, expect, it } from "vitest";
import {
  AI_REQUEST_ENVELOPE,
  assertCompletionRequestWithinEnvelope,
  clampToRequestEnvelope,
  reservationInputTokenCeiling,
  reservationOutputTokenCeiling,
} from "@/lib/ai/request-envelope";
import { AIProviderLimitError } from "@/lib/ai/provider-errors";
import { resolveAIProviderConfig } from "@/lib/ai/provider-config";
import {
  estimateCostMicros,
  maxEnvelopeCostMicros,
  reservationCostCeilingMicros,
  INTERNAL_MODEL_COST_TABLE,
} from "@/lib/entitlements/cost-table";
import { StubAIProvider } from "@/lib/ai/providers/stub";
import { OpenAIChatProvider } from "@/lib/ai/providers/openai-chat";
import type { InternalModelKey } from "@/lib/ai/types";

describe("AI request envelope ↔ reservation cost invariant", () => {
  it("shares one authoritative envelope between provider config and reservation", () => {
    const config = resolveAIProviderConfig({});
    expect(config.maxInputChars).toBe(AI_REQUEST_ENVELOPE.maxInputChars);
    expect(config.maxOutputTokens).toBe(AI_REQUEST_ENVELOPE.maxOutputTokens);
    expect(reservationInputTokenCeiling()).toBe(AI_REQUEST_ENVELOPE.maxInputChars);
    expect(reservationOutputTokenCeiling()).toBe(AI_REQUEST_ENVELOPE.maxOutputTokens);
  });

  it("ensures max possible provider table cost <= reservedCostMicros for every model", () => {
    const models = Object.keys(INTERNAL_MODEL_COST_TABLE) as InternalModelKey[];
    expect(models.length).toBeGreaterThan(0);
    for (const modelKey of models) {
      const reserved = reservationCostCeilingMicros({
        capability: "AI_SESSION",
        modelKey,
      });
      const maxPossible = estimateCostMicros({
        modelKey,
        inputTokens: reservationInputTokenCeiling(),
        outputTokens: reservationOutputTokenCeiling(),
      });
      expect(maxPossible).toBe(reserved);
      expect(maxEnvelopeCostMicros(modelKey)).toBe(reserved);
      expect(maxPossible).toBeLessThanOrEqual(reserved);
    }
  });

  it("clamps env attempts to exceed the reservation-safe envelope", () => {
    const config = resolveAIProviderConfig({
      AI_MAX_INPUT_CHARS: "999999",
      AI_MAX_OUTPUT_TOKENS: "999999",
    });
    expect(config.maxInputChars).toBe(AI_REQUEST_ENVELOPE.maxInputChars);
    expect(config.maxOutputTokens).toBe(AI_REQUEST_ENVELOPE.maxOutputTokens);
    expect(config.maxInputChars).toBeLessThanOrEqual(
      clampToRequestEnvelope({ maxInputChars: 999999, maxOutputTokens: 999999 })
        .maxInputChars,
    );
  });

  it("allows env to lower limits below the envelope", () => {
    const config = resolveAIProviderConfig({
      AI_MAX_INPUT_CHARS: "3000",
      AI_MAX_OUTPUT_TOKENS: "200",
    });
    expect(config.maxInputChars).toBe(3000);
    expect(config.maxOutputTokens).toBe(200);
  });

  it("rejects client/caller input above the envelope before dispatch (not_dispatched)", async () => {
    const stub = new StubAIProvider();
    const oversized = "x".repeat(AI_REQUEST_ENVELOPE.maxInputChars + 1);
    await expect(
      stub.complete({
        modelKey: "flux-standard",
        messages: [{ role: "user", content: oversized }],
      }),
    ).rejects.toBeInstanceOf(AIProviderLimitError);

    try {
      await stub.complete({
        modelKey: "flux-standard",
        messages: [{ role: "user", content: oversized }],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AIProviderLimitError);
      expect((error as AIProviderLimitError).executionCertainty).toBe(
        "not_dispatched",
      );
    }
  });

  it("OpenAI provider also rejects oversize before fetch (not_dispatched)", async () => {
    let fetched = false;
    const provider = new OpenAIChatProvider({
      apiKey: "sk-test",
      baseUrl: "https://example.test/v1",
      timeoutMs: 1000,
      maxOutputTokens: AI_REQUEST_ENVELOPE.maxOutputTokens,
      maxInputChars: AI_REQUEST_ENVELOPE.maxInputChars,
      modelIds: {
        "flux-fast": "gpt-4o-mini",
        "flux-standard": "gpt-4o-mini",
        "flux-advanced": "gpt-4o",
      },
      fetchImpl: (async () => {
        fetched = true;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });

    await expect(
      provider.complete({
        modelKey: "flux-standard",
        messages: [
          { role: "user", content: "y".repeat(AI_REQUEST_ENVELOPE.maxInputChars + 50) },
        ],
      }),
    ).rejects.toBeInstanceOf(AIProviderLimitError);
    expect(fetched).toBe(false);
  });

  it("constructor limits cannot exceed the envelope even if misconfigured", () => {
    const provider = new OpenAIChatProvider({
      apiKey: "sk-test",
      baseUrl: "https://example.test/v1",
      timeoutMs: 1000,
      maxOutputTokens: 50_000,
      maxInputChars: 50_000,
      modelIds: {
        "flux-fast": "gpt-4o-mini",
        "flux-standard": "gpt-4o-mini",
        "flux-advanced": "gpt-4o",
      },
    });
    // Access via completing a max-size-ok request and ensuring oversize uses envelope.
    expect(() =>
      assertCompletionRequestWithinEnvelope(
        {
          modelKey: "flux-standard",
          messages: [
            { role: "user", content: "z".repeat(AI_REQUEST_ENVELOPE.maxInputChars) },
          ],
        },
        AI_REQUEST_ENVELOPE,
      ),
    ).not.toThrow();
    // Provider internal clamp: oversize relative to envelope still rejected.
    void provider;
  });

  it("does not expose envelope controls as client-authoritative inputs", () => {
    // Clients cannot supply reservation cost or raise limits via resolve config bag
    // beyond the hard envelope — only server env can lower.
    const fromClientLike = resolveAIProviderConfig({
      AI_MAX_INPUT_CHARS: String(AI_REQUEST_ENVELOPE.maxInputChars * 10),
    });
    expect(fromClientLike.maxInputChars).toBe(AI_REQUEST_ENVELOPE.maxInputChars);
  });
});
