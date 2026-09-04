import type { AITaskType, AssistanceMode } from "./types";

export type PolicyDecision = {
  mode: AssistanceMode;
  requiresStudentParticipation: boolean;
  systemDirective: string;
  reason: string;
};

/**
 * Central academic assistance policy.
 * Learning-first, not a rigid "never give answers" rule.
 * Determines appropriate assistance level from task + message signals.
 */
export function decideAssistancePolicy(
  taskType: AITaskType,
  userMessage: string,
): PolicyDecision {
  const text = userMessage.toLowerCase().trim();

  const asksForDirectAnswer =
    /^(what is|what's|give me the answer|just tell me|solve this|do my homework)\b/.test(
      text,
    ) || /\b(answer only|final answer|don't explain)\b/.test(text);

  const asksToCheckWork =
    /\b(check my|did i get|is this right|is my answer)\b/.test(text);

  const asksForHint = /\b(hint|stuck|nudge|point me)\b/.test(text);

  if (taskType === "administrative" || taskType === "general_conversation") {
    return {
      mode: "explain",
      requiresStudentParticipation: false,
      systemDirective:
        "Be helpful and concise. This is not an academic integrity-sensitive request.",
      reason: "non_academic",
    };
  }

  if (asksToCheckWork) {
    return {
      mode: "check_work",
      requiresStudentParticipation: true,
      systemDirective:
        "Verify the student's reasoning. Affirm correct steps, probe errors, do not replace their work with a finished solution.",
      reason: "check_work_request",
    };
  }

  if (asksForHint) {
    return {
      mode: "hint",
      requiresStudentParticipation: true,
      systemDirective:
        "Provide a single useful hint that advances thinking. Do not give the full solution.",
      reason: "hint_request",
    };
  }

  if (
    taskType === "homework_guidance" ||
    taskType === "tutoring" ||
    asksForDirectAnswer
  ) {
    return {
      mode: "break_into_steps",
      requiresStudentParticipation: true,
      systemDirective:
        "Guide with Socratic questions and small steps. Require the student to attempt intermediate reasoning. Do not provide a complete worked solution unless they have shown substantial effort and ask to verify.",
      reason: "guided_learning_default",
    };
  }

  if (taskType === "concept_explanation") {
    return {
      mode: "teach",
      requiresStudentParticipation: true,
      systemDirective:
        "Teach the concept clearly, then ask a short check question to confirm understanding.",
      reason: "concept_teaching",
    };
  }

  return {
    mode: "explain",
    requiresStudentParticipation: false,
    systemDirective:
      "Be clear and learning-oriented. Prefer understanding over answer extraction.",
    reason: "default",
  };
}
