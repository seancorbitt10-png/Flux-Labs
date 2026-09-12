/**
 * OpenAI Chat Completions adapter.
 *
 * Vendor-specific HTTP mapping stays here. Orchestration depends only on
 * AIProvider — never on OpenAI SDKs or response shapes.
 *
 * Uses fetch (no SDK) to keep the dependency surface small.
 */

import type {
  AICompletionRequest,
  AICompletionResult,
  AIProvider,
  InternalModelKey,
} from "@/lib/ai/types";
import type { AIProviderRuntimeConfig } from "@/lib/ai/provider-config";
import {
  AIProviderConfigError,
  AIProviderInvalidResponseError,
  AIProviderLimitError,
  AIProviderRateLimitError,
  AIProviderTimeoutError,
  AIProviderUpstreamError,
} from "@/lib/ai/provider-errors";
import { MAX_PROVIDER_REPLY_CHARS } from "@/lib/ai/response-validation";

const DEFAULT_TEMPERATURE = 0.4;

/** Conservative micros-per-1k-token estimates for usage accounting (not billing). */
const COST_MICROS_PER_1K_INPUT: Record<InternalModelKey, number> = {
  "flux-fast": 150,
  "flux-standard": 150,
  "flux-advanced": 2_500,
};
const COST_MICROS_PER_1K_OUTPUT: Record<InternalModelKey, number> = {
  "flux-fast": 600,
  "flux-standard": 600,
  "flux-advanced": 10_000,
};

type OpenAIChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: { role?: string; content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string; code?: string };
};

export type OpenAIChatProviderOptions = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxOutputTokens: number;
  maxInputChars: number;
  modelIds: Record<InternalModelKey, string>;
  /** Injected for tests — defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

export class OpenAIChatProvider implements AIProvider {
  readonly id = "openai";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly maxInputChars: number;
  private readonly modelIds: Record<InternalModelKey, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIChatProviderOptions) {
    if (!options.apiKey) {
      throw new AIProviderConfigError(
        "OPENAI_API_KEY is required when AI_PROVIDER=openai and production AI is enabled.",
      );
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs;
    this.maxOutputTokens = options.maxOutputTokens;
    this.maxInputChars = options.maxInputChars;
    this.modelIds = options.modelIds;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  static fromConfig(
    config: AIProviderRuntimeConfig,
    fetchImpl?: typeof fetch,
  ): OpenAIChatProvider {
    if (!config.openaiApiKey) {
      throw new AIProviderConfigError(
        "OPENAI_API_KEY is required when AI_PROVIDER=openai and production AI is enabled.",
      );
    }

    return new OpenAIChatProvider({
      apiKey: config.openaiApiKey,
      baseUrl: config.openaiBaseUrl,
      timeoutMs: config.timeoutMs,
      maxOutputTokens: config.maxOutputTokens,
      maxInputChars: config.maxInputChars,
      modelIds: config.modelIds,
      fetchImpl,
    });
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const started = Date.now();
    this.assertInputBounds(request);

    const vendorModel = this.resolveVendorModel(request.modelKey);
    const maxTokens = Math.min(
      request.maxTokens ?? this.maxOutputTokens,
      this.maxOutputTokens,
    );
    if (maxTokens < 1) {
      throw new AIProviderLimitError("Requested maxTokens is below minimum.");
    }

    // Temperature is server-clamped; client cannot raise it via orchestration bag.
    const temperature = clamp(
      request.temperature ?? DEFAULT_TEMPERATURE,
      0,
      1,
    );

    const body = {
      model: vendorModel,
      messages: request.messages.map(
        (m): OpenAIChatMessage => ({
          role: m.role,
          content: m.content,
        }),
      ),
      max_tokens: maxTokens,
      temperature,
    };

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    const result = await this.parseResponse(response, request.modelKey);
    return {
      ...result,
      latencyMs: Date.now() - started,
    };
  }

  private assertInputBounds(request: AICompletionRequest): void {
    const totalChars = request.messages.reduce(
      (sum, m) => sum + m.content.length,
      0,
    );
    if (totalChars > this.maxInputChars) {
      throw new AIProviderLimitError(
        `Input exceeds server max of ${this.maxInputChars} characters`,
      );
    }
  }

  private resolveVendorModel(internal: InternalModelKey): string {
    const mapped = this.modelIds[internal];
    if (!mapped) {
      throw new AIProviderConfigError(
        `No vendor model mapped for internal key ${internal}`,
      );
    }
    return mapped;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new AIProviderTimeoutError(
          `OpenAI request timed out after ${this.timeoutMs}ms`,
        );
      }
      throw new AIProviderUpstreamError("OpenAI network request failed");
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseResponse(
    response: Response,
    internalModel: InternalModelKey,
  ): Promise<Omit<AICompletionResult, "latencyMs">> {
    const rawText = await response.text();

    if (response.status === 429) {
      throw new AIProviderRateLimitError("OpenAI rate limit exceeded");
    }

    if (response.status === 401 || response.status === 403) {
      // Do not forward provider auth details to callers.
      throw new AIProviderUpstreamError("OpenAI authentication failed");
    }

    if (!response.ok) {
      throw new AIProviderUpstreamError(
        `OpenAI upstream failure (HTTP ${response.status})`,
      );
    }

    let parsed: OpenAIChatCompletionResponse;
    try {
      parsed = JSON.parse(rawText) as OpenAIChatCompletionResponse;
    } catch {
      throw new AIProviderInvalidResponseError(
        "OpenAI returned non-JSON response",
      );
    }

    if (parsed.error) {
      // Never surface parsed.error.message — may contain provider internals.
      throw new AIProviderUpstreamError("OpenAI returned an error payload");
    }

    const choice = parsed.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string") {
      throw new AIProviderInvalidResponseError(
        "OpenAI response missing message content",
      );
    }

    const trimmed = content.trim();
    if (!trimmed) {
      throw new AIProviderInvalidResponseError(
        "OpenAI response content was empty",
      );
    }

    // Bound output characters at the adapter (response-validation also caps).
    const bounded =
      trimmed.length > MAX_PROVIDER_REPLY_CHARS
        ? trimmed.slice(0, MAX_PROVIDER_REPLY_CHARS)
        : trimmed;

    const inputTokens = parsed.usage?.prompt_tokens ?? 0;
    const outputTokens = parsed.usage?.completion_tokens ?? 0;

    return {
      content: bounded,
      modelKey: internalModel,
      provider: this.id,
      inputTokens,
      outputTokens,
      estimatedCostMicros: estimateCostMicros(
        internalModel,
        inputTokens,
        outputTokens,
      ),
    };
  }
}

function estimateCostMicros(
  modelKey: InternalModelKey,
  inputTokens: number,
  outputTokens: number,
): number {
  const inCost =
    (Math.max(0, inputTokens) / 1000) * COST_MICROS_PER_1K_INPUT[modelKey];
  const outCost =
    (Math.max(0, outputTokens) / 1000) * COST_MICROS_PER_1K_OUTPUT[modelKey];
  return Math.max(1, Math.ceil(inCost + outCost));
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError" || name === "TimeoutError";
}
