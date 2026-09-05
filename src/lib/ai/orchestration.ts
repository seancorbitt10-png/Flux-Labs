import { createHash } from "node:crypto";
import { reserveCapability } from "@/lib/entitlements/check";
import { recordUsage } from "@/lib/entitlements/usage";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";
import { assembleAIContext } from "./context-assembly";
import { decideAssistancePolicy } from "./policy";
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

/**
 * Central AI orchestration boundary.
 *
 * Auth (caller) → entitlement reserve → route → policy → assembleAIContext
 * → prompt hierarchy → provider → validate reply → usage log
 *
 * - Consumes assembleAIContext (read-only Student Model slice)
 * - Student content is DATA in the prompt fence, never instructions
 * - No Student Model writes / no AI proposal persistence in this layer
 * - Clients never select models, providers, provenance, or confidence
 * - Stub provider remains the default until a later provider slice
 */
export async function runAIOrchestration(
  request: OrchestrationRequest,
): Promise<OrchestrationResult> {
  rejectClientAuthority(request);

  if (typeof request.userId !== "string" || !request.userId) {
    throw new ValidationError("userId is required.");
  }
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

  // Server-side classification only — never honor client routing.
  const route = routeAITask(userMessage);
  const capability = capabilityForRoute(route.taskType, route.modelKey);

  await reserveCapability(request.userId, capability);

  const policy = decideAssistancePolicy(route.taskType, userMessage);

  const assembled = await assembleAIContext({
    actorUserId: request.userId,
    userId: request.userId,
    taskType: route.taskType,
    conceptIds: request.conceptIds,
    userMessage,
  });

  const messages = buildOrchestrationMessages({
    taskType: route.taskType,
    assistanceMode: policy.mode,
    systemDirective: policy.systemDirective,
    assembled,
    userMessage,
  });

  const provider = getAIProvider();
  let completion;
  try {
    completion = await provider.complete({
      modelKey: route.modelKey,
      messages,
      maxTokens: 800,
    });
  } catch (error) {
    await recordUsage({
      userId: request.userId,
      capability,
      feature: "ai.orchestration",
      aiTaskType: route.taskType,
      modelKey: route.modelKey,
      success: false,
      errorCode: "PROVIDER_ERROR",
      capabilityReserved: true,
      metadata: {
        assistanceMode: policy.mode,
        routeReason: route.reason,
        policyReason: policy.reason,
        contextVersion: assembled.version,
      },
    });
    throw error;
  }

  let validated;
  try {
    validated = validateProviderCompletion(completion);
  } catch (error) {
    await recordUsage({
      userId: request.userId,
      capability,
      feature: "ai.orchestration",
      aiTaskType: route.taskType,
      modelKey: route.modelKey,
      success: false,
      errorCode: "PROVIDER_OUTPUT_INVALID",
      capabilityReserved: true,
      metadata: {
        assistanceMode: policy.mode,
        routeReason: route.reason,
        policyReason: policy.reason,
        contextVersion: assembled.version,
      },
    });
    throw error;
  }

  await recordUsage({
    userId: request.userId,
    capability,
    feature: "ai.orchestration",
    aiTaskType: route.taskType,
    modelKey: completion.modelKey,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
    estimatedCostMicros: completion.estimatedCostMicros,
    latencyMs: completion.latencyMs,
    success: true,
    capabilityReserved: true,
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
  await prisma.aIInteraction.create({
    data: {
      userId: request.userId,
      taskType: route.taskType,
      assistanceMode: policy.mode,
      modelKey: completion.modelKey,
      requestSummary: redactRequestSummary(userMessage),
      success: true,
    },
  });

  return {
    taskType: route.taskType,
    assistanceMode: policy.mode,
    modelKey: completion.modelKey,
    reply: validated.text,
    requiresStudentParticipation: policy.requiresStudentParticipation,
    replyTruncated: validated.truncated,
    contextVersion: assembled.version,
    usage: {
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
      estimatedCostMicros: completion.estimatedCostMicros,
      latencyMs: completion.latencyMs,
    },
  };
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
    "systemPrompt",
    "instructions",
    "systemDirective",
    "assistanceMode",
    "taskType",
    "attributes",
    "goals",
    "extraContext",
    "messages",
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
