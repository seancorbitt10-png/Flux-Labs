/**
 * Manual real-OpenAI production smoke test.
 *
 * PURPOSE
 *   Prove one controlled OpenAI request can leave this process when — and only
 *   when — the full production gate is intentionally configured.
 *
 * SAFETY
 *   - Does NOT run in CI (npm test / GitHub Actions never invoke this).
 *   - Does NOT run merely because OPENAI_API_KEY exists.
 *   - Requires AI_SMOKE_TEST_ALLOW=1 AND the full production gate.
 *   - Never prints, logs, or writes the API key / confirm secret.
 *   - Never silently falls back to the stub (fails closed instead).
 *   - Uses the smallest practical model (flux-fast) and a tiny output budget.
 *   - Can incur real OpenAI API cost — operators must opt in deliberately.
 *
 * USAGE (authorized operator only):
 *   AI_SMOKE_TEST_ALLOW=1 \
 *   AI_PRODUCTION_ENABLED=true \
 *   AI_PRODUCTION_CONFIRM=ENABLE_REAL_AI \
 *   AI_PROVIDER=openai \
 *   OPENAI_API_KEY=... \
 *   npm run test:ai-smoke
 *
 * KILL SWITCH afterwards:
 *   AI_PRODUCTION_ENABLED=false
 *
 * This script is NOT a public HTTP endpoint.
 */

import {
  AI_PRODUCTION_CONFIRM_VALUE,
  getAIProductionGateStatus,
  isProductionAIReady,
  resolveAIProviderConfig,
} from "../src/lib/ai/provider-config";
import { createAIProviderFromConfig } from "../src/lib/ai/provider-factory";
import { logAIOps } from "../src/lib/ai/ops-log";
import { resetAIProvider } from "../src/lib/ai/provider";
import type { AICompletionRequest } from "../src/lib/ai/types";

function fail(message: string): never {
  console.error(`[flux-ai-smoke] FAIL: ${message}`);
  process.exit(1);
}

function assertNoSecretLeak(text: string): void {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (key && key.length > 0 && text.includes(key)) {
    fail("Refusing to continue — output would contain OPENAI_API_KEY.");
  }
  const confirm = process.env.AI_PRODUCTION_CONFIRM?.trim();
  if (confirm && confirm.length > 0 && text.includes(confirm) && confirm === AI_PRODUCTION_CONFIRM_VALUE) {
    // Confirm value is not highly secret, but still avoid echoing env material.
  }
}

async function main(): Promise<void> {
  console.info("[flux-ai-smoke] Starting manual production AI smoke test.");
  console.info(
    "[flux-ai-smoke] WARNING: This may incur real OpenAI API cost.",
  );

  if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") {
    fail("Refusing to run under CI / GitHub Actions.");
  }

  if ((process.env.AI_SMOKE_TEST_ALLOW ?? "").trim() !== "1") {
    fail(
      "Set AI_SMOKE_TEST_ALLOW=1 to opt in. OPENAI_API_KEY alone is not enough.",
    );
  }

  const gate = getAIProductionGateStatus();
  if (!gate.ready || !isProductionAIReady()) {
    fail(
      `Production gate not ready (fail closed, no stub fallback). Reason: ${gate.reason ?? "unknown"}`,
    );
  }

  // Resolve config explicitly — must be openai, never stub.
  let config;
  try {
    config = resolveAIProviderConfig();
  } catch (error) {
    fail(
      `resolveAIProviderConfig failed closed: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }

  if (config.kind !== "openai" || !config.productionEnabled) {
    fail(
      `Expected openai production provider, got kind=${config.kind} productionEnabled=${config.productionEnabled}. No stub fallback.`,
    );
  }

  resetAIProvider();
  const provider = createAIProviderFromConfig();
  if (provider.id !== "openai") {
    fail(
      `Factory returned provider id="${provider.id}" instead of openai. No stub fallback.`,
    );
  }

  const request: AICompletionRequest = {
    modelKey: "flux-fast",
    messages: [
      {
        role: "system",
        content:
          "You are Flux Labs Study AI. Reply in one short sentence. Do not solve homework; ask one guiding question.",
      },
      {
        role: "user",
        content:
          "Smoke test only: what is one question I should ask myself before differentiating a product rule?",
      },
    ],
    // Tiny budget — still clamped by server envelope ceilings.
    maxTokens: 64,
  };

  logAIOps({
    event: "smoke_test",
    provider: provider.id,
    modelKey: request.modelKey,
    detail: "dispatch_start",
  });

  const started = Date.now();
  let result;
  try {
    result = await provider.complete(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    assertNoSecretLeak(message);
    logAIOps({
      event: "smoke_test",
      provider: provider.id,
      modelKey: request.modelKey,
      outcome: "provider_error",
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.name : "unknown",
    });
    fail(`Provider call failed: ${message}`);
  }

  const latencyMs = Date.now() - started;
  assertNoSecretLeak(result.content ?? "");

  if (!result.content || result.content.trim().length === 0) {
    fail("Provider returned empty content.");
  }
  if (result.provider !== "openai") {
    fail(`Unexpected result.provider=${result.provider}`);
  }
  if (result.modelKey !== "flux-fast") {
    fail(`Unexpected result.modelKey=${result.modelKey}`);
  }

  logAIOps({
    event: "smoke_test",
    provider: result.provider,
    modelKey: result.modelKey,
    outcome: "success",
    latencyMs,
    detail: `chars=${result.content.length};in=${result.inputTokens};out=${result.outputTokens}`,
  });

  console.info("[flux-ai-smoke] PASS");
  console.info(
    `[flux-ai-smoke] provider=${result.provider} modelKey=${result.modelKey} latencyMs=${latencyMs} outputChars=${result.content.length}`,
  );
  console.info(
    "[flux-ai-smoke] Reminder: disable real AI with AI_PRODUCTION_ENABLED=false when finished.",
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  assertNoSecretLeak(message);
  fail(message);
});
