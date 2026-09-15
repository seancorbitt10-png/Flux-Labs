/**
 * Manual Study-path production AI smoke harness (server-side).
 *
 * PURPOSE
 *   Prove one deliberately authorized real-AI Study request travels the same
 *   production orchestration path as normal Study traffic:
 *
 *   isolated smoke actor (server-owned identity)
 *   → executeStudyTurnForActor (same post-auth path as sendStudyTurnAction)
 *   → validation + learning-first policy + context assembly
 *   → entitlement reservation → provider (OpenAI when gate ready)
 *   → response validation → settlement → client-safe errors
 *
 * SAFETY
 *   - Manual / explicit opt-in only (AI_SMOKE_TEST_ALLOW=1)
 *   - Never part of npm test / CI / GitHub Actions
 *   - Never triggered by OPENAI_API_KEY alone
 *   - Fails closed — never silently substitutes StubAIProvider
 *   - Does NOT call provider.complete() directly
 *   - Does NOT invent a parallel AI pipeline
 *   - Clients/smoke raw payloads cannot supply userId / policy / context bags
 *
 * Real OpenAI cost may be incurred when the full production gate is ready.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import {
  executeStudyTurnForActor,
  type StudyTurnResult,
} from "@/lib/study/execute-turn";
import { logAIOps } from "./ops-log";
import {
  AI_PRODUCTION_CONFIRM_VALUE,
  getAIProductionGateStatus,
  isProductionAIReady,
  resolveAIProviderConfig,
} from "./provider-config";
import { getAIProvider, resetAIProvider } from "./provider";

/** Minimal learning-first Study body — does not request homework completion. */
export const SMOKE_STUDY_MESSAGE =
  "Before differentiating a product, what should I identify first?";

export const SMOKE_STUDY_INTENT = "ask" as const;

export type SmokeActorHandle = {
  userId: string;
  email: string;
  cleanup: () => Promise<void>;
};

export type StudyPathSmokeReport = {
  ok: true;
  provider: string;
  modelKey: string;
  latencyMs: number;
  outputChars: number;
  assistanceMode: string;
  taskType: string;
  accountingOutcome: "success";
  replyNonEmpty: true;
};

export class SmokePreconditionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmokePreconditionsError";
  }
}

/**
 * Refuse to continue/report if output contains configured secrets.
 * Safe when env vars are absent. Does not print the offending value.
 */
export function assertNoSecretLeak(text: string): void {
  if (typeof text !== "string" || text.length === 0) return;

  const key = process.env.OPENAI_API_KEY?.trim();
  if (key && key.length > 0 && text.includes(key)) {
    throw new SmokePreconditionsError(
      "Refusing to continue — output would contain OPENAI_API_KEY.",
    );
  }

  const confirm = process.env.AI_PRODUCTION_CONFIRM?.trim();
  // Only treat the configured production confirmation token as a leak —
  // not arbitrary common words that happen to appear in student text.
  if (
    confirm &&
    confirm.length > 0 &&
    confirm === AI_PRODUCTION_CONFIRM_VALUE &&
    text.includes(confirm)
  ) {
    throw new SmokePreconditionsError(
      "Refusing to continue — output would contain AI_PRODUCTION_CONFIRM.",
    );
  }
}

/** CI / Actions must never run the billable Study-path smoke. */
export function assertNotRunningInCI(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.CI === "true" || env.GITHUB_ACTIONS === "true") {
    throw new SmokePreconditionsError(
      "Refusing to run under CI / GitHub Actions.",
    );
  }
}

/** Explicit opt-in — API key alone is never enough. */
export function assertSmokeOptIn(env: NodeJS.ProcessEnv = process.env): void {
  if ((env.AI_SMOKE_TEST_ALLOW ?? "").trim() !== "1") {
    throw new SmokePreconditionsError(
      "Set AI_SMOKE_TEST_ALLOW=1 to opt in. OPENAI_API_KEY alone is not enough.",
    );
  }
}

/**
 * Full production gate must be ready. Fail closed — no stub fallback.
 */
export function assertProductionGateReadyForSmoke(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const gate = getAIProductionGateStatus(env);
  if (!gate.ready || !isProductionAIReady(env)) {
    throw new SmokePreconditionsError(
      `Production gate not ready (fail closed, no stub fallback). Reason: ${
        gate.reason ?? "unknown"
      }`,
    );
  }

  let config;
  try {
    config = resolveAIProviderConfig(env);
  } catch (error) {
    throw new SmokePreconditionsError(
      `resolveAIProviderConfig failed closed: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }

  if (config.kind !== "openai" || !config.productionEnabled) {
    throw new SmokePreconditionsError(
      `Expected openai production provider, got kind=${config.kind} productionEnabled=${config.productionEnabled}. No stub fallback.`,
    );
  }
}

/** Client-legitimate Study inputs only — no identity / policy / context bags. */
export function buildSmokeStudyRaw(): Record<string, unknown> {
  return {
    message: SMOKE_STUDY_MESSAGE,
    intent: SMOKE_STUDY_INTENT,
  };
}

/**
 * Create an isolated FREE_TRIAL smoke identity server-side.
 * Never accepts a client-supplied userId. Temporary rows are cleaned up after.
 */
export async function createIsolatedSmokeActor(): Promise<SmokeActorHandle> {
  const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const email = `ai-smoke.${suffix}@fluxlabs.smoke.local`;
  const endsAt = new Date(Date.now() + 7 * 86_400_000);

  const user = await prisma.user.create({
    data: {
      email,
      name: "AI Smoke Actor",
      passwordHash: "smoke-not-a-login",
      studentProfile: {
        create: {
          displayName: "AI Smoke Actor",
          academicLevel: "undergrad",
        },
      },
      entitlements: {
        create: {
          plan: "FREE_TRIAL",
          status: "ACTIVE",
          endsAt,
        },
      },
      trials: {
        create: {
          endsAt,
          aiSessionsUsed: 0,
          documentAnalysesUsed: 0,
          advancedTutoringUsed: 0,
          estimatedCostMicros: 0,
        },
      },
    },
  });

  return {
    userId: user.id,
    email,
    cleanup: async () => {
      await cleanupSmokeUser(user.id);
    },
  };
}

async function cleanupSmokeUser(userId: string): Promise<void> {
  await prisma.aIProposal.deleteMany({ where: { userId } });
  await prisma.learningEvidence.deleteMany({ where: { userId } });
  await prisma.studentConceptState.deleteMany({ where: { userId } });
  await prisma.studentMisconception.deleteMany({ where: { userId } });
  await prisma.studentObservation.deleteMany({ where: { userId } });
  await prisma.studentAttribute.deleteMany({ where: { userId } });
  await prisma.studentGoal.deleteMany({ where: { userId } });
  await prisma.taskConcept.deleteMany({ where: { task: { userId } } });
  await prisma.task.deleteMany({ where: { userId } });
  await prisma.class.deleteMany({ where: { userId } });
  await prisma.aIInteraction.deleteMany({ where: { userId } });
  await prisma.usageRecord.deleteMany({ where: { userId } });
  await prisma.aiUsageOperation.deleteMany({ where: { userId } });
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.trial.deleteMany({ where: { userId } });
  await prisma.entitlement.deleteMany({ where: { userId } });
  await prisma.studentProfile.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

export type RunStudyPathSmokeDeps = {
  /** Defaults to executeStudyTurnForActor — the real Study post-auth path. */
  executeTurn?: typeof executeStudyTurnForActor;
  createActor?: typeof createIsolatedSmokeActor;
  getProvider?: typeof getAIProvider;
  resetProvider?: typeof resetAIProvider;
  /**
   * Tests only: after reset, allow a DI provider override (setAIProvider)
   * instead of requiring live openai identity. CLI never sets this.
   */
  allowTestProviderOverride?: boolean;
};

/**
 * Run one Study-path production smoke turn.
 *
 * Does not call provider.complete() — orchestration does, via the same path
 * sendStudyTurnAction uses after requireUserId.
 */
export async function runStudyPathProductionSmoke(
  deps: RunStudyPathSmokeDeps = {},
): Promise<StudyPathSmokeReport> {
  const executeTurn = deps.executeTurn ?? executeStudyTurnForActor;
  const createActor = deps.createActor ?? createIsolatedSmokeActor;
  const getProvider = deps.getProvider ?? getAIProvider;
  const resetProvider = deps.resetProvider ?? resetAIProvider;

  assertNotRunningInCI();
  assertSmokeOptIn();
  assertProductionGateReadyForSmoke();

  // Production CLI always resets so a stale DI override cannot mask the gate.
  // Tests may keep a DI override (setAIProvider) by setting allowTestProviderOverride.
  if (!deps.allowTestProviderOverride) {
    resetProvider();
    const provider = getProvider();
    if (provider.id !== "openai") {
      throw new SmokePreconditionsError(
        `Expected openai provider after gate, got id="${provider.id}". No stub fallback.`,
      );
    }
  }

  const actor = await createActor();
  const started = Date.now();

  logAIOps({
    event: "smoke_test",
    provider: "openai",
    modelKey: "flux-fast",
    outcome: "dispatch_start",
    detail: "study_path_start",
  });

  let result: StudyTurnResult;
  try {
    result = await executeTurn({
      actorUserId: actor.userId,
      raw: buildSmokeStudyRaw(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    assertNoSecretLeak(message);
    logAIOps({
      event: "smoke_test",
      provider: "openai",
      outcome: "smoke_fail",
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.name : "unknown",
    });
    await safeCleanup(actor);
    throw error;
  }

  const latencyMs = Date.now() - started;

  if (!result.ok) {
    assertNoSecretLeak(result.message);
    logAIOps({
      event: "smoke_test",
      provider: "openai",
      outcome: "smoke_fail",
      latencyMs,
      detail: "study_turn_not_ok",
    });
    await safeCleanup(actor);
    throw new SmokePreconditionsError(result.message);
  }

  assertNoSecretLeak(result.reply);
  assertNoSecretLeak(result.composedMessage);

  if (!result.reply || result.reply.trim().length === 0) {
    await safeCleanup(actor);
    throw new SmokePreconditionsError("Study path returned empty reply.");
  }

  // Prefer flux-fast for smoke cost; router may still choose another internal key.
  // Report the authoritative server-selected modelKey — never a client choice.
  const modelKey = result.modelKey;
  const outputChars = result.reply.length;

  logAIOps({
    event: "smoke_test",
    provider: "openai",
    modelKey,
    outcome: "smoke_pass",
    latencyMs,
    detail: `chars=${outputChars};in=${result.usage.inputTokens ?? 0};out=${result.usage.outputTokens ?? 0}`,
  });

  await safeCleanup(actor);

  return {
    ok: true,
    provider: "openai",
    modelKey,
    latencyMs,
    outputChars,
    assistanceMode: result.assistanceMode,
    taskType: result.taskType,
    accountingOutcome: "success",
    replyNonEmpty: true,
  };
}

async function safeCleanup(actor: SmokeActorHandle): Promise<void> {
  try {
    await actor.cleanup();
  } catch {
    // Best-effort cleanup — do not mask the primary smoke result.
  }
}
