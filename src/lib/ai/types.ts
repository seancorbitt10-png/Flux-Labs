/**
 * Provider-agnostic AI types.
 * Flux Labs chooses models server-side — clients never select models.
 */

export type AITaskType =
  | "general_conversation"
  | "tutoring"
  | "homework_guidance"
  | "concept_explanation"
  | "document_analysis"
  | "summarization"
  | "study_planning"
  | "practice_generation"
  | "quiz_generation"
  | "resource_retrieval"
  | "academic_planning"
  | "task_assistance"
  | "progress_analysis"
  | "administrative";

export type AssistanceMode =
  | "explain"
  | "teach"
  | "ask_question"
  | "hint"
  | "break_into_steps"
  | "check_work"
  | "identify_misconception"
  | "analogous_example"
  | "partial_assistance"
  | "limited_answer"
  | "refuse_direct_completion";

/** Internal model keys — never primary product UI abstractions */
export type InternalModelKey =
  | "flux-fast"
  | "flux-standard"
  | "flux-advanced";

export type AIMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AICompletionRequest = {
  modelKey: InternalModelKey;
  messages: AIMessage[];
  maxTokens?: number;
  temperature?: number;
};

export type AICompletionResult = {
  content: string;
  modelKey: InternalModelKey;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostMicros: number;
  latencyMs: number;
};

export type AIProvider = {
  readonly id: string;
  complete(request: AICompletionRequest): Promise<AICompletionResult>;
};

export type AssembledContext = {
  studentSummary?: string;
  classContext?: string;
  taskContext?: string;
  resourceExcerpts?: string[];
};

/** Prisma UsageCapability values used by orchestration (avoids client imports in types). */
export type UsageCapabilityName =
  | "AI_SESSION"
  | "DOCUMENT_ANALYSIS"
  | "ADVANCED_TUTORING"
  | "GENERAL";

export type OrchestrationRequest = {
  userId: string;
  userMessage: string;
  /**
   * Optional server-validated focus concept IDs.
   * Validated again inside assembleAIContext (ownership + existence).
   */
  conceptIds?: string[];
  /**
   * Optional server-only classification hint for tests/internal callers.
   * Never accept this from the client — orchestration ignores client-supplied routing.
   */
  taskTypeHint?: AITaskType;
  /**
   * @deprecated Phase 1 free-form context. Ignored by the orchestration boundary.
   * Student facts must come from assembleAIContext, not the client.
   */
  context?: AssembledContext;
};

export type OrchestrationResult = {
  taskType: AITaskType;
  assistanceMode: AssistanceMode;
  modelKey: InternalModelKey;
  reply: string;
  requiresStudentParticipation: boolean;
  /** True when the provider reply was truncated to the server max length. */
  replyTruncated: boolean;
  /** Context assembly version consumed for this turn. */
  contextVersion: string;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostMicros: number;
    latencyMs: number;
  };
};
