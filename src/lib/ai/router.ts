import type { AITaskType, InternalModelKey } from "./types";

export type RouteDecision = {
  taskType: AITaskType;
  modelKey: InternalModelKey;
  reason: string;
};

/**
 * Heuristic task router (Phase 1).
 * Phase 4 will replace heuristics with a proper classifier while keeping
 * this interface stable. Optimizes for correctness → experience → learning → cost.
 */
export function routeAITask(
  userMessage: string,
  hint?: AITaskType,
): RouteDecision {
  if (hint) {
    return {
      taskType: hint,
      modelKey: modelForTask(hint),
      reason: "client_hint",
    };
  }

  const text = userMessage.toLowerCase();

  if (/(quiz|practice|flashcard)/.test(text)) {
    return {
      taskType: "practice_generation",
      modelKey: "flux-standard",
      reason: "practice_keywords",
    };
  }

  if (/(summarize|summary|document|pdf|notes)/.test(text)) {
    return {
      taskType: "document_analysis",
      modelKey: "flux-standard",
      reason: "document_keywords",
    };
  }

  if (/(study plan|schedule|plan my|workload)/.test(text)) {
    return {
      taskType: "study_planning",
      modelKey: "flux-standard",
      reason: "planning_keywords",
    };
  }

  if (/(explain|what is|how does|concept|why)/.test(text)) {
    return {
      taskType: "concept_explanation",
      modelKey: "flux-fast",
      reason: "explanation_keywords",
    };
  }

  if (/(homework|solve|answer this|do this problem|calculate)/.test(text)) {
    return {
      taskType: "homework_guidance",
      modelKey: "flux-standard",
      reason: "homework_keywords",
    };
  }

  if (/(tutor|help me learn|walk me through|step by step)/.test(text)) {
    return {
      taskType: "tutoring",
      modelKey: "flux-standard",
      reason: "tutoring_keywords",
    };
  }

  return {
    taskType: "general_conversation",
    modelKey: "flux-fast",
    reason: "default",
  };
}

function modelForTask(task: AITaskType): InternalModelKey {
  switch (task) {
    case "document_analysis":
    case "progress_analysis":
      return "flux-advanced";
    case "tutoring":
    case "homework_guidance":
    case "study_planning":
    case "practice_generation":
    case "quiz_generation":
      return "flux-standard";
    default:
      return "flux-fast";
  }
}
