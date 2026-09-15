/**
 * Manual real-OpenAI Study-path production smoke test.
 *
 * PURPOSE
 *   Prove one controlled Study request can leave this process through the
 *   existing server-side Study orchestration path when — and only when —
 *   the full production gate is intentionally configured.
 *
 * Path exercised:
 *   isolated smoke actor (server-owned)
 *   → executeStudyTurnForActor (same post-auth path as sendStudyTurnAction)
 *   → validation / learning-first policy / context assembly
 *   → entitlement reservation → OpenAI provider → response validation
 *   → settlement / accounting → client-safe errors
 *
 * SAFETY
 *   - Does NOT run in CI (npm test / GitHub Actions never invoke this).
 *   - Does NOT run merely because OPENAI_API_KEY exists.
 *   - Requires AI_SMOKE_TEST_ALLOW=1 AND the full production gate.
 *   - Never prints, logs, or writes the API key / confirm secret.
 *   - Never silently falls back to the stub (fails closed instead).
 *   - Does NOT call provider.complete() directly.
 *   - Uses the smallest practical routed model when possible (flux-fast).
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
  assertNoSecretLeak,
  runStudyPathProductionSmoke,
  SmokePreconditionsError,
} from "../src/lib/ai/production-smoke";

function fail(message: string): never {
  console.error(`[flux-ai-smoke] FAIL: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  console.info("[flux-ai-smoke] Starting manual Study-path production AI smoke.");
  console.info(
    "[flux-ai-smoke] WARNING: This may incur real OpenAI API cost.",
  );

  let report;
  try {
    report = await runStudyPathProductionSmoke();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assertNoSecretLeak(message);
    if (error instanceof SmokePreconditionsError) {
      fail(message);
    }
    fail(`Study-path smoke failed: ${message}`);
  }

  console.info("[flux-ai-smoke] PASS");
  console.info(
    `[flux-ai-smoke] provider=${report.provider} modelKey=${report.modelKey} latencyMs=${report.latencyMs} outputChars=${report.outputChars} accounting=${report.accountingOutcome} replyNonEmpty=${report.replyNonEmpty} assistanceMode=${report.assistanceMode} taskType=${report.taskType}`,
  );
  console.info(
    "[flux-ai-smoke] Reminder: disable real AI with AI_PRODUCTION_ENABLED=false when finished.",
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  try {
    assertNoSecretLeak(message);
  } catch {
    fail("Refusing to continue — output would contain a configured secret.");
  }
  fail(message);
});
