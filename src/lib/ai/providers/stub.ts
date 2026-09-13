import type {
  AICompletionRequest,
  AICompletionResult,
  AIProvider,
  InternalModelKey,
} from "@/lib/ai/types";
import {
  AI_REQUEST_ENVELOPE,
  assertCompletionRequestWithinEnvelope,
  clampToRequestEnvelope,
  type AIRequestEnvelopeLimits,
} from "@/lib/ai/request-envelope";

/**
 * Stub provider for tests, local development, and the default runtime.
 * No real model calls — validates the orchestration path end-to-end.
 *
 * Enforces the same authoritative token envelope as production providers
 * (o200k_base gate) so reservation cost and acceptance limits cannot diverge.
 */
export class StubAIProvider implements AIProvider {
  readonly id = "stub";

  private readonly limits: Required<AIRequestEnvelopeLimits>;

  constructor(limits: Partial<AIRequestEnvelopeLimits> = {}) {
    this.limits = clampToRequestEnvelope({
      maxInputTokens:
        limits.maxInputTokens ?? AI_REQUEST_ENVELOPE.maxInputTokens,
      maxOutputTokens:
        limits.maxOutputTokens ?? AI_REQUEST_ENVELOPE.maxOutputTokens,
      maxInputUtf16Units:
        limits.maxInputUtf16Units ?? AI_REQUEST_ENVELOPE.maxInputUtf16Units,
    });
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const started = Date.now();
    // Same pre-dispatch envelope check as OpenAI — oversize => not_dispatched.
    assertCompletionRequestWithinEnvelope(request, this.limits);

    const lastUser = [...request.messages]
      .reverse()
      .find((m) => m.role === "user");

    const content = buildStubReply(lastUser?.content ?? "", request.modelKey);

    return {
      content,
      modelKey: request.modelKey,
      provider: this.id,
      inputTokens: estimateTokens(
        request.messages.map((m) => m.content).join(" "),
      ),
      outputTokens: estimateTokens(content),
      estimatedCostMicros: 50, // negligible stub cost for accounting path
      latencyMs: Date.now() - started,
    };
  }
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function buildStubReply(
  userMessage: string,
  modelKey: InternalModelKey,
): string {
  return [
    "I'm Flux — your academic learning companion.",
    "",
    "In this foundation build I can confirm the AI orchestration path is wired:",
    "• Request received",
    `• Model route: ${modelKey} (internal)`,
    "• Learning-first policy: I'll guide rather than dump answers",
    "",
    `You asked: “${truncate(userMessage, 160)}”`,
    "",
    "Before I help further, what have you already tried on this?",
  ].join("\n");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
