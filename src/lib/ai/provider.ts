import type {
  AICompletionRequest,
  AICompletionResult,
  AIProvider,
  InternalModelKey,
} from "./types";

/**
 * Stub provider for Phase 1.
 * No real model calls yet — validates the orchestration path end-to-end.
 * Phase 4 will plug in real providers behind this interface.
 */
export class StubAIProvider implements AIProvider {
  readonly id = "stub";

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const started = Date.now();
    const lastUser = [...request.messages]
      .reverse()
      .find((m) => m.role === "user");

    const content = buildStubReply(lastUser?.content ?? "", request.modelKey);

    return {
      content,
      modelKey: request.modelKey,
      provider: this.id,
      inputTokens: estimateTokens(request.messages.map((m) => m.content).join(" ")),
      outputTokens: estimateTokens(content),
      estimatedCostMicros: 50, // negligible stub cost for accounting path
      latencyMs: Date.now() - started,
    };
  }
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function buildStubReply(userMessage: string, modelKey: InternalModelKey): string {
  return [
    "I'm Flux — your academic learning companion.",
    "",
    "In this foundation build I can confirm the AI orchestration path is wired:",
    `• Request received`,
    `• Model route: ${modelKey} (internal)`,
    `• Learning-first policy: I'll guide rather than dump answers`,
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

let provider: AIProvider = new StubAIProvider();

export function getAIProvider(): AIProvider {
  return provider;
}

/** Test/DI hook — swap providers without changing call sites */
export function setAIProvider(next: AIProvider): void {
  provider = next;
}
