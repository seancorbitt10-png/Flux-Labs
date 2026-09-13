import { createHash } from "node:crypto";
import {
  beginUsageReservation,
  finalizeUsageReservation,
  releaseUsageReservationIfHeld,
  settlementOutcomeForProviderError,
} from "@/lib/entitlements/operations";
import { AIProviderError } from "@/lib/ai/provider-errors";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";
import { assembleAIContext } from "./context-assembly";
import { decideAssistancePolicy } from "./policy";
import { ingestProposalsFromProviderReply } from "./proposals";
import { buildOrchestrationMessages } from "./prompt";
import { getAIProvider } from "./provider";
import { validateProviderCompletion } from "./response-validation";
import { routeAITask } from "./router";
import type {
  AITaskType,
  InternalModelKey,
  OrchestrationRequest,
  OrchestrationResult,
  UsageCapabilityName,
} from "./types";

const MAX_USER_MESSAGE_CHARS = 4_000;
const MAX_PRIOR_TURNS = 8;
const MAX_PRIOR_TURN_CHARS = 2_000;

/**
 * Central AI orchestration boundary.
 *
 * Auth (caller) → entitlement reserve → route → policy → assembleAIContext
 * → prompt hierarchy → provider → validate reply → optional proposal ingest
 * → usage log
 *
 * Accounting (conservative):
 *   - Safe non-execution (never dispatched) → RELEASE reservation
 *   - Ambiguous / dispatched provider failure → SETTLE / consume
 *   - Invalid output after dispatch → SETTLE / consume
 *   - Success → SETTLE
 *
 * - Consumes assembleAIContext (read-only Student Model slice)
 * - Student content is DATA in the prompt fence, never instructions
 * - AI proposals are validated/persisted as PENDING only — never auto-written
 * - Clients never select models, providers, provenance, confidence, cost, or plan
 * - Provider selected server-side (stub by default; production gated)
 */
export async function runAIOrchestration(
  request: OrchestrationRequest,
): Promise<OrchestrationResult> {
  rejectClientAuthority(request);

  const actorUserId = resolveAuthenticatedActor(request);

  if (typeof request.userMessage !== "string") {
    throw new ValidationError("userMessage must be a string.");
  }
  const userMessage = request.userMessage.trim();
  if (!userMessage) {
    throw new ValidationError("userMessage must not be empty.");
  }
  if (userMessage.length > MAX_USER_MESSAGE_CHARS) {
    throw new ValidationError("userMessage exceeds maximum length.");
  }

  const priorTurns = normalizePriorTurns(request.priorTurns);

  // Server-side classification only — never honor client routing.
  const route = routeAITask(userMessage);
  const capability = capabilityForRoute(route.taskType, route.modelKey);

  // Authorize + reserve BEFORE any provider dispatch. Fail closed.
  const reservation = await beginUsageReservation({
    userId: actorUserId,
    capability,
    feature: "ai.orchestration",
    modelKey: route.modelKey,
  });

  // Once provider.complete() is entered, never auto-RELEASE on outer cleanup
  // (timeout/network may have executed upstream — fail closed / consume).
  let providerDispatchAttempted = false;

  try {
    const policy = decideAssistancePolicy(route.taskType, userMessage);

    const assembled = await assembleAIContext({
      actorUserId,
      userId: actorUserId,
      taskType: route.taskType,
      conceptIds: request.conceptIds,
      classId: request.classId,
      taskId: request.taskId,
      userMessage,
    });

    const messages = buildOrchestrationMessages({
      taskType: route.taskType,
      assistanceMode: policy.mode,
      systemDirective: policy.systemDirective,
      assembled,
      userMessage,
      priorTurns,
    });

    // Provider construction may throw not_dispatched config errors (safe release).
    const provider = getAIProvider();
    let completion;
    try {
      providerDispatchAttempted = true;
      completion = await provider.complete({
        modelKey: route.modelKey,
        messages,
        maxTokens: 800,
      });
    } catch (error) {
      // Certainty-driven: not_dispatched → RELEASE; ambiguous/dispatched → SETTLE.
      await finalizeUsageReservation({
        operationId: reservation.operationId,
        userId: actorUserId,
        outcome: settlementOutcomeForProviderError(error),
        feature: "ai.orchestration",
        aiTaskType: route.taskType,
        modelKey: route.modelKey,
        errorCode:
          error instanceof AIProviderError ? error.code : "PROVIDER_ERROR",
        metadata: {
          assistanceMode: policy.mode,
          routeReason: route.reason,
          policyReason: policy.reason,
          contextVersion: assembled.version,
          executionCertainty:
            error instanceof AIProviderError
              ? error.executionCertainty
              : "ambiguous",
        },
      });
      throw error;
    }

    let validated;
    try {
      validated = validateProviderCompletion(completion);
    } catch (error) {
      // Invalid output after dispatch → consume (conservative).
      await finalizeUsageReservation({
        operationId: reservation.operationId,
        userId: actorUserId,
        outcome: "failed_consumed",
        feature: "ai.orchestration",
        aiTaskType: route.taskType,
        modelKey: route.modelKey,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        providerEstimateMicros: completion.estimatedCostMicros,
        latencyMs: completion.latencyMs,
        errorCode: "PROVIDER_OUTPUT_INVALID",
        metadata: {
          assistanceMode: policy.mode,
          routeReason: route.reason,
          policyReason: policy.reason,
          contextVersion: assembled.version,
        },
      });
      throw error;
    }

    await finalizeUsageReservation({
      operationId: reservation.operationId,
      userId: actorUserId,
      outcome: "success",
      feature: "ai.orchestration",
      aiTaskType: route.taskType,
      modelKey: completion.modelKey,
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
      providerEstimateMicros: completion.estimatedCostMicros,
      latencyMs: completion.latencyMs,
      metadata: {
        provider: completion.provider,
        assistanceMode: policy.mode,
        routeReason: route.reason,
        policyReason: policy.reason,
        contextVersion: assembled.version,
        replyTruncated: validated.truncated,
      },
    });

    // Operational interaction log only — not Student Model persistence.
    const interaction = await prisma.aIInteraction.create({
      data: {
        userId: actorUserId,
        taskType: route.taskType,
        assistanceMode: policy.mode,
        modelKey: completion.modelKey,
        requestSummary: redactRequestSummary(userMessage),
        success: true,
      },
    });

    // Controlled proposal ingest — PENDING only; never auto-mutates Student Model.
    const ingested = await ingestProposalsFromProviderReply({
      actorUserId,
      reply: validated.text,
      aiInteractionId: interaction.id,
    });

    return {
      taskType: route.taskType,
      assistanceMode: policy.mode,
      modelKey: completion.modelKey,
      reply: validated.text,
      requiresStudentParticipation: policy.requiresStudentParticipation,
      replyTruncated: validated.truncated,
      contextVersion: assembled.version,
      proposals: ingested.proposals
        .filter((p) => p.status === "PENDING")
        .map((p) => ({
          id: p.id,
          type: p.type,
          status: p.status,
          target: p.target,
          proposedValue: p.proposedValue,
          rationale: p.rationale,
        })),
      usage: {
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        estimatedCostMicros: completion.estimatedCostMicros,
        latencyMs: completion.latencyMs,
      },
    };
  } catch (error) {
    // Pre-dispatch only: safe RELEASE. After dispatch, settlement path owns outcome
    // (or leave RESERVED if settlement itself failed — fail closed).
    if (!providerDispatchAttempted) {
      await releaseUsageReservationIfHeld({
        operationId: reservation.operationId,
        userId: actorUserId,
        feature: "ai.orchestration",
        errorCode: "PRE_DISPATCH_FAILURE",
      });
    }
    throw error;
  }
}

/**
 * Bind orchestration to the authenticated actor.
 * Rejects legacy/caller-supplied userId bags that disagree with actorUserId.
 */
function resolveAuthenticatedActor(request: OrchestrationRequest): string {
  if (typeof request.actorUserId !== "string" || !request.actorUserId) {
    throw new ValidationError("actorUserId is required.");
  }

  const bag = request as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(bag, "userId")) {
    throw new ValidationError(
      "Orchestration rejects caller-supplied userId; use authenticated actorUserId only.",
    );
  }

  return request.actorUserId;
}

function normalizePriorTurns(
  raw: OrchestrationRequest["priorTurns"],
): Array<{ role: "user" | "assistant"; content: string }> {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new ValidationError("priorTurns must be an array.");
  }
  if (raw.length > MAX_PRIOR_TURNS) {
    throw new ValidationError(
      `At most ${MAX_PRIOR_TURNS} prior conversation turns are allowed.`,
    );
  }

  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of raw) {
    if (turn == null || typeof turn !== "object" || Array.isArray(turn)) {
      throw new ValidationError("Invalid prior conversation turn.");
    }
    const bag = turn as Record<string, unknown>;
    for (const key of Object.keys(bag)) {
      if (key !== "role" && key !== "content") {
        throw new ValidationError(
          "Prior turns may only include role and content.",
        );
      }
    }
    if (bag.role !== "user" && bag.role !== "assistant") {
      throw new ValidationError("Invalid prior turn role.");
    }
    if (typeof bag.content !== "string") {
      throw new ValidationError("Prior turn content must be a string.");
    }
    const content = bag.content.trim();
    if (!content) {
      throw new ValidationError("Prior turn content must not be empty.");
    }
    if (content.length > MAX_PRIOR_TURN_CHARS) {
      throw new ValidationError("Prior turn content exceeds maximum length.");
    }
    out.push({ role: bag.role, content });
  }
  return out;
}

/**
 * Reject caller-controlled authority / injection fields on the orchestration bag.
 * Legacy `context` blobs are ignored (not applied) but authority keys are rejected.
 */
function rejectClientAuthority(request: OrchestrationRequest): void {
  const bag = request as Record<string, unknown>;
  const forbidden = [
    "provenance",
    "confidence",
    "source",
    "modelKey",
    "provider",
    "providerId",
    "apiKey",
    "endpoint",
    "baseUrl",
    "temperature",
    "maxTokens",
    "systemPrompt",
    "instructions",
    "systemDirective",
    "assistanceMode",
    "taskType",
    "attributes",
    "goals",
    "extraContext",
    "messages",
    "approved",
    "authorized",
    "entitlement",
    "ownership",
    // Accounting / settlement authority — server-only.
    "plan",
    "planTier",
    "outcome",
    "settlement",
    "settlementOutcome",
    "reservedCost",
    "reservedCostMicros",
    "estimatedCostMicros",
    "operationId",
    "usageOperationId",
  ] as const;

  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(bag, key)) {
      throw new ValidationError(
        "Orchestration rejects caller-supplied authority, routing, or prompt fields.",
      );
    }
  }

  if (bag.context != null && typeof bag.context === "object") {
    const ctx = bag.context as Record<string, unknown>;
    for (const key of [
      "provenance",
      "confidence",
      "source",
      "systemPrompt",
      "instructions",
      "userId",
    ] as const) {
      if (Object.prototype.hasOwnProperty.call(ctx, key)) {
        throw new ValidationError(
          "Orchestration rejects authority fields inside client context blobs.",
        );
      }
    }
  }
}

export function capabilityForRoute(
  taskType: AITaskType,
  modelKey: InternalModelKey,
): UsageCapabilityName {
  if (taskType === "document_analysis") return "DOCUMENT_ANALYSIS";
  if (modelKey === "flux-advanced") return "ADVANCED_TUTORING";
  if (
    taskType === "tutoring" ||
    taskType === "homework_guidance" ||
    taskType === "practice_generation" ||
    taskType === "quiz_generation"
  ) {
    return "AI_SESSION";
  }
  return "AI_SESSION";
}

/** Hash + length only — never store raw educational content in interaction logs. */
export function redactRequestSummary(message: string): string {
  const hash = createHash("sha256").update(message).digest("hex").slice(0, 16);
  return `sha256:${hash}:len=${message.length}`;
}
