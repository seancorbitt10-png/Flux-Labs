import { describe, expect, it } from "vitest";
import { encode as independentO200kEncode } from "gpt-tokenizer/encoding/o200k_base";
import {
  AI_REQUEST_ENVELOPE,
  assertCompletionRequestWithinEnvelope,
  clampToRequestEnvelope,
  reservationInputTokenCeiling,
  reservationOutputTokenCeiling,
} from "@/lib/ai/request-envelope";
import {
  CHAT_REPLY_PRIMING_TOKENS,
  CHAT_TOKENS_PER_MESSAGE,
  countBillableInputTokens,
  countContentTokensOnly,
  countStringTokens,
  PRODUCTION_OPENAI_ENCODING,
} from "@/lib/ai/tokenization";
import { AIProviderLimitError } from "@/lib/ai/provider-errors";
import {
  AI_PROVIDER_DEFAULTS,
  resolveAIProviderConfig,
} from "@/lib/ai/provider-config";
import {
  estimateCostMicros,
  INTERNAL_MODEL_COST_TABLE,
  maxEnvelopeCostMicros,
  reservationCostCeilingMicros,
} from "@/lib/entitlements/cost-table";
import { StubAIProvider } from "@/lib/ai/providers/stub";
import { OpenAIChatProvider } from "@/lib/ai/providers/openai-chat";
import type { AICompletionRequest, InternalModelKey } from "@/lib/ai/types";

const MODEL: InternalModelKey = "flux-standard";

/** Independent o200k encode — does NOT go through production helpers. */
function independentEncodeLength(text: string): number {
  return independentO200kEncode(text).length;
}

/**
 * Independently reconstruct billable input tokens with gpt-tokenizer o200k_base.
 * Must NOT call countBillableInputTokens / reservation helpers for the proof side.
 */
function independentBillableInputTokens(request: AICompletionRequest): number {
  let total = CHAT_REPLY_PRIMING_TOKENS;
  for (const message of request.messages) {
    total += CHAT_TOKENS_PER_MESSAGE;
    total += independentO200kEncode(message.role).length;
    total += independentO200kEncode(message.content).length;
  }
  return total;
}

function requestWithContent(content: string): AICompletionRequest {
  return {
    modelKey: MODEL,
    messages: [
      { role: "system", content: "You are a study coach." },
      { role: "user", content },
    ],
  };
}

function growUntilOverCeiling(): AICompletionRequest {
  // 漢 is 1 o200k token; overshoot the envelope without iterative re-encoding.
  const content = "漢".repeat(AI_REQUEST_ENVELOPE.maxInputTokens + 500);
  const req = requestWithContent(content);
  if (independentBillableInputTokens(req) <= AI_REQUEST_ENVELOPE.maxInputTokens) {
    throw new Error("fixture failed to exceed token ceiling");
  }
  return req;
}

describe("AI request envelope — tokenizer-backed reservation safety", () => {
  it("uses o200k_base as the production encoding", () => {
    expect(PRODUCTION_OPENAI_ENCODING).toBe("o200k_base");
    expect(independentEncodeLength("Hello world")).toBe(
      countStringTokens("Hello world", MODEL),
    );
  });

  it("shares one authoritative token envelope between config and reservation", () => {
    const config = resolveAIProviderConfig({});
    expect(config.maxInputTokens).toBe(AI_REQUEST_ENVELOPE.maxInputTokens);
    expect(config.maxOutputTokens).toBe(AI_REQUEST_ENVELOPE.maxOutputTokens);
    expect(reservationInputTokenCeiling()).toBe(
      AI_REQUEST_ENVELOPE.maxInputTokens,
    );
    expect(reservationOutputTokenCeiling()).toBe(
      AI_REQUEST_ENVELOPE.maxOutputTokens,
    );
  });

  it("reservation cost equals estimate at envelope token ceilings", () => {
    for (const modelKey of Object.keys(
      INTERNAL_MODEL_COST_TABLE,
    ) as InternalModelKey[]) {
      const reserved = reservationCostCeilingMicros({
        capability: "AI_SESSION",
        modelKey,
      });
      const expected = estimateCostMicros({
        modelKey,
        inputTokens: AI_REQUEST_ENVELOPE.maxInputTokens,
        outputTokens: AI_REQUEST_ENVELOPE.maxOutputTokens,
      });
      expect(reserved).toBe(expected);
      expect(maxEnvelopeCostMicros(modelKey)).toBe(reserved);
    }
  });

  /**
   * CRITICAL independent proof:
   * left side  = tokenizer-measured billable tokens
   * right side = reservationInputTokenCeiling() from the envelope constant
   * These are not the same helper compared to itself via a char conversion.
   */
  it("independently measured billable tokens stay ≤ reservation ceiling for Unicode fixtures", () => {
    const fixtures: Array<{ name: string; text: string }> = [
      { name: "ascii", text: "Explain the derivative of x^2 step by step." },
      { name: "accented", text: "Résolvez l'équation: café naïve résumé." },
      { name: "cjk", text: "请解释光合作用。日本語の漢字テスト。한국어 문법." },
      { name: "emoji", text: "Study tips 📚✨ for tomorrow's exam 🎓🚀" },
      {
        name: "combining",
        text: "Combine: cafe\u0301 + e\u0301 + a\u0308 sequences.",
      },
      {
        name: "mixed",
        text: "C₆H₁₂O₆ metabolism — 光合作用 pathway 🧪 with résumé notes.",
      },
      {
        name: "zwj-emoji",
        text: "Teamwork 👨‍👩‍👧‍👦 and flags 🇺🇸 in the case study.",
      },
      {
        name: "long-unicode",
        text: ("量子力学の基礎。".repeat(40) + " " + "🔬".repeat(20)).slice(
          0,
          2000,
        ),
      },
    ];

    // Right side: reservation ceiling from envelope constant (not from tokenizer).
    const ceiling = reservationInputTokenCeiling();
    expect(ceiling).toBe(AI_REQUEST_ENVELOPE.maxInputTokens);

    for (const fixture of fixtures) {
      const req = requestWithContent(fixture.text);
      expect(() => assertCompletionRequestWithinEnvelope(req)).not.toThrow();

      // Left side: independent o200k encode (not reservationInputTokenCeiling,
      // and not the same helper used to derive reservedCostMicros).
      const independentBillable = independentBillableInputTokens(req);
      const rawContent = independentEncodeLength(fixture.text);
      expect(rawContent).toBe(countContentTokensOnly([fixture.text], MODEL));

      expect(
        independentBillable,
        `${fixture.name}: independent billable ${independentBillable} must be ≤ ceiling ${ceiling}`,
      ).toBeLessThanOrEqual(ceiling);

      // Production gate helper must agree with the independent reconstruction.
      expect(countBillableInputTokens(req)).toBe(independentBillable);
      expect(independentBillable).toBeGreaterThan(rawContent);
    }
  });

  it("documents chat framing overhead used in the billable definition", () => {
    expect(CHAT_TOKENS_PER_MESSAGE).toBeGreaterThanOrEqual(3);
    expect(CHAT_REPLY_PRIMING_TOKENS).toBeGreaterThanOrEqual(3);
    const req = requestWithContent("hi");
    const billable = countBillableInputTokens(req);
    const contentOnly = countContentTokensOnly(
      req.messages.map((m) => m.content),
      MODEL,
    );
    expect(billable).toBeGreaterThan(contentOnly);
  });

  it("rejects input whose independently counted billable tokens exceed the ceiling", () => {
    const req = growUntilOverCeiling();
    expect(independentBillableInputTokens(req)).toBeGreaterThan(
      AI_REQUEST_ENVELOPE.maxInputTokens,
    );
    expect(countBillableInputTokens(req)).toBe(
      independentBillableInputTokens(req),
    );
    expect(() => assertCompletionRequestWithinEnvelope(req)).toThrow(
      AIProviderLimitError,
    );
  });

  it("accepts near-ceiling input and rejects clearly oversize Unicode input", () => {
    const over = growUntilOverCeiling();
    // Binary-search a CJK payload that sits just under the billable ceiling.
    let lo = 1;
    let hi = AI_REQUEST_ENVELOPE.maxInputTokens + 200;
    let best = "";
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const candidate = "漢".repeat(mid);
      const req = requestWithContent(candidate);
      const tokens = independentBillableInputTokens(req);
      if (tokens <= AI_REQUEST_ENVELOPE.maxInputTokens) {
        best = candidate;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const under = requestWithContent(best);
    expect(independentBillableInputTokens(under)).toBeLessThanOrEqual(
      AI_REQUEST_ENVELOPE.maxInputTokens,
    );
    expect(best.length).toBeGreaterThan(0);
    expect(() => assertCompletionRequestWithinEnvelope(under)).not.toThrow();
    expect(() => assertCompletionRequestWithinEnvelope(over)).toThrow(
      AIProviderLimitError,
    );
  });

  it("clamps env attempts to exceed the reservation-safe token envelope", () => {
    const raised = resolveAIProviderConfig({
      AI_MAX_INPUT_TOKENS: "999999",
      AI_MAX_OUTPUT_TOKENS: "999999",
    });
    expect(raised.maxInputTokens).toBe(AI_REQUEST_ENVELOPE.maxInputTokens);
    expect(raised.maxOutputTokens).toBe(AI_REQUEST_ENVELOPE.maxOutputTokens);
    expect(
      clampToRequestEnvelope({
        maxInputTokens: 999999,
        maxOutputTokens: 999999,
      }).maxInputTokens,
    ).toBe(AI_REQUEST_ENVELOPE.maxInputTokens);
  });

  it("allows env to lower token limits below the envelope", () => {
    const lowered = resolveAIProviderConfig({
      AI_MAX_INPUT_TOKENS: "1000",
      AI_MAX_OUTPUT_TOKENS: "100",
    });
    expect(lowered.maxInputTokens).toBe(1000);
    expect(lowered.maxOutputTokens).toBe(100);
  });

  it("defaults provider limits to the authoritative token envelope", () => {
    expect(AI_PROVIDER_DEFAULTS.maxInputTokens).toBe(
      AI_REQUEST_ENVELOPE.maxInputTokens,
    );
    expect(AI_PROVIDER_DEFAULTS.maxOutputTokens).toBe(
      AI_REQUEST_ENVELOPE.maxOutputTokens,
    );
  });

  it("stub and OpenAI providers reject oversize before dispatch (not_dispatched)", async () => {
    const req = growUntilOverCeiling();

    const stub = new StubAIProvider();
    await expect(stub.complete(req)).rejects.toBeInstanceOf(
      AIProviderLimitError,
    );
    try {
      await stub.complete(req);
    } catch (error) {
      expect((error as AIProviderLimitError).executionCertainty).toBe(
        "not_dispatched",
      );
    }

    let fetched = false;
    const provider = new OpenAIChatProvider({
      apiKey: "sk-test",
      baseUrl: "https://example.test/v1",
      timeoutMs: 1000,
      maxOutputTokens: AI_REQUEST_ENVELOPE.maxOutputTokens,
      maxInputTokens: AI_REQUEST_ENVELOPE.maxInputTokens,
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
    await expect(provider.complete(req)).rejects.toBeInstanceOf(
      AIProviderLimitError,
    );
    expect(fetched).toBe(false);
  });

  it("constructor limits cannot exceed the envelope even if misconfigured", async () => {
    const provider = new OpenAIChatProvider({
      apiKey: "sk-test",
      baseUrl: "https://example.test/v1",
      timeoutMs: 1000,
      maxOutputTokens: 50_000,
      maxInputTokens: 50_000,
      modelIds: {
        "flux-fast": "gpt-4o-mini",
        "flux-standard": "gpt-4o-mini",
        "flux-advanced": "gpt-4o",
      },
    });
    const req = growUntilOverCeiling();
    await expect(provider.complete(req)).rejects.toBeInstanceOf(
      AIProviderLimitError,
    );
  });

  it("does not let client-like env values raise the reservation envelope", () => {
    const fromClientLike = resolveAIProviderConfig({
      AI_MAX_INPUT_TOKENS: String(AI_REQUEST_ENVELOPE.maxInputTokens * 10),
      AI_MAX_OUTPUT_TOKENS: String(AI_REQUEST_ENVELOPE.maxOutputTokens * 10),
    });
    expect(fromClientLike.maxInputTokens).toBe(
      AI_REQUEST_ENVELOPE.maxInputTokens,
    );
    expect(fromClientLike.maxOutputTokens).toBe(
      AI_REQUEST_ENVELOPE.maxOutputTokens,
    );
  });

  it("reservedCostMicros covers independently measured cost for permitted Unicode traffic", () => {
    const fixtures = [
      "ASCII review session notes.",
      "café naïve résumé",
      "光合作用と量子力学",
      "📚🎓🚀",
      "cafe\u0301 combining marks",
    ];
    const reserved = reservationCostCeilingMicros({
      capability: "AI_SESSION",
      modelKey: MODEL,
    });
    for (const text of fixtures) {
      const req = requestWithContent(text);
      expect(() => assertCompletionRequestWithinEnvelope(req)).not.toThrow();
      const independentBillable = independentBillableInputTokens(req);
      const estimated = estimateCostMicros({
        modelKey: MODEL,
        inputTokens: independentBillable,
        outputTokens: AI_REQUEST_ENVELOPE.maxOutputTokens,
      });
      expect(independentBillable).toBeLessThanOrEqual(reservationInputTokenCeiling());
      expect(reserved).toBeGreaterThanOrEqual(estimated);
    }
  });

  it("reservation amount is not reduced by client-like env overrides", () => {
    const baseline = reservationCostCeilingMicros({
      capability: "AI_SESSION",
      modelKey: MODEL,
    });
    // Env may lower provider limits, but reservation ceiling stays at the
    // authoritative envelope (server-controlled; cannot be client-reduced).
    const lowered = resolveAIProviderConfig({
      AI_MAX_INPUT_TOKENS: "500",
      AI_MAX_OUTPUT_TOKENS: "50",
    });
    expect(lowered.maxInputTokens).toBe(500);
    expect(
      reservationCostCeilingMicros({
        capability: "AI_SESSION",
        modelKey: MODEL,
      }),
    ).toBe(baseline);
    expect(baseline).toBe(
      estimateCostMicros({
        modelKey: MODEL,
        inputTokens: AI_REQUEST_ENVELOPE.maxInputTokens,
        outputTokens: AI_REQUEST_ENVELOPE.maxOutputTokens,
      }),
    );
  });

  it("UTF-16 length is not used as the token-cost bound (emoji illustration)", () => {
    const rockets = "🚀".repeat(10);
    expect(rockets.length).toBe(20); // UTF-16 units
    const tokens = independentEncodeLength(rockets);
    expect(tokens).toBe(countStringTokens(rockets, MODEL));
    // Ceiling is the token envelope constant, not string.length.
    expect(reservationInputTokenCeiling()).toBe(
      AI_REQUEST_ENVELOPE.maxInputTokens,
    );
    expect(reservationInputTokenCeiling()).not.toBe(rockets.length);
  });
});
