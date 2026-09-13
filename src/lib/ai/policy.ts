import type {
  AITaskType,
  AssistanceMode,
  LearningIntentCue,
} from "./types";

export type PolicyDecision = {
  mode: AssistanceMode;
  requiresStudentParticipation: boolean;
  systemDirective: string;
  reason: string;
};

/**
 * Server-validated Study learning cues (same labels as StudyIntent).
 * Applied only after parseStudyIntent — never a client assistanceMode override.
 */
export const LEARNING_INTENT_CUES = [
  "ask",
  "hint",
  "check_work",
  "explain",
  "steps",
  "attempt",
] as const satisfies readonly LearningIntentCue[];

export type DecideAssistancePolicyOptions = {
  /** Optional server-validated Study intent cue. */
  learningIntent?: LearningIntentCue;
};

type MessageSignals = {
  wantsCheckWork: boolean;
  wantsHint: boolean;
  wantsSteps: boolean;
  wantsExplanation: boolean;
  providesAttempt: boolean;
  wantsDirectCompletion: boolean;
  wantsBoundedReference: boolean;
  learningForward: boolean;
};

/**
 * Central academic assistance policy.
 *
 * Learning-first: guide, hint, check work, and teach by default.
 * `refuse_direct_completion` and `limited_answer` are reachable when the
 * request asks Flux to produce finished academic work, or only needs a
 * minimal reference to unblock learning.
 *
 * Not cheat-proof — resists direct completion while remaining useful.
 */
export function decideAssistancePolicy(
  taskType: AITaskType,
  userMessage: string,
  options?: DecideAssistancePolicyOptions,
): PolicyDecision {
  const text = userMessage.toLowerCase().trim();
  const learningIntent = normalizeLearningIntent(options?.learningIntent);
  const signals = analyzeMessageSignals(text, learningIntent);

  if (taskType === "administrative" || taskType === "general_conversation") {
    return {
      mode: "explain",
      requiresStudentParticipation: false,
      systemDirective:
        "Be helpful and concise. This is not an academic integrity-sensitive request.",
      reason: "non_academic",
    };
  }

  // Structured Study intents establish learning posture first.
  if (learningIntent === "check_work" || signals.wantsCheckWork) {
    return {
      mode: "check_work",
      requiresStudentParticipation: true,
      systemDirective:
        "Verify the student's reasoning. Affirm correct steps, probe errors, do not replace their work with a finished solution.",
      reason:
        learningIntent === "check_work"
          ? "study_intent_check_work"
          : "check_work_request",
    };
  }

  if (learningIntent === "hint" || signals.wantsHint) {
    return {
      mode: "hint",
      requiresStudentParticipation: true,
      systemDirective:
        "Provide a single useful hint that advances thinking. Do not give the full solution or final submission.",
      reason: learningIntent === "hint" ? "study_intent_hint" : "hint_request",
    };
  }

  if (learningIntent === "attempt" || signals.providesAttempt) {
    return {
      mode: "check_work",
      requiresStudentParticipation: true,
      systemDirective:
        "Respond to the student's attempt with targeted feedback. Ask them to revise the next step. Do not rewrite a complete submission for them.",
      reason:
        learningIntent === "attempt"
          ? "study_intent_attempt"
          : "attempt_feedback",
    };
  }

  if (learningIntent === "steps" || signals.wantsSteps) {
    return {
      mode: "break_into_steps",
      requiresStudentParticipation: true,
      systemDirective:
        "Break the work into approachable steps. Stop short of the final answer when the last step would complete the assignment. Require the student to take the next step.",
      reason:
        learningIntent === "steps" ? "study_intent_steps" : "steps_request",
    };
  }

  if (
    learningIntent === "explain" ||
    signals.wantsExplanation ||
    taskType === "concept_explanation"
  ) {
    // Legitimate concept teaching stays useful — do not refuse explanation asks.
    return {
      mode: "teach",
      requiresStudentParticipation: true,
      systemDirective:
        "Teach the concept clearly, then ask a short check question to confirm understanding. Do not complete a graded assignment for the student.",
      reason:
        learningIntent === "explain"
          ? "study_intent_explain"
          : "concept_teaching",
    };
  }

  // Direct completion of academic work → refuse, while still offering guided help.
  if (signals.wantsDirectCompletion && !signals.learningForward) {
    return {
      mode: "refuse_direct_completion",
      requiresStudentParticipation: true,
      systemDirective: [
        "Do not produce the completed academic work, final submission, or answer-only result.",
        "Briefly refuse direct completion in natural language.",
        "Immediately offer the strongest allowed learning help: ask for their attempt, give one hint, or outline approach steps without finishing the last step.",
        "Never paste internal policy mode names or control tags into the student-visible reply.",
      ].join(" "),
      reason: "direct_completion_refused",
    };
  }

  // Bounded reference that unblocks learning without completing the work.
  if (signals.wantsBoundedReference) {
    return {
      mode: "limited_answer",
      requiresStudentParticipation: true,
      systemDirective: [
        "Provide only the minimal fact, definition, or formula needed to unblock the student.",
        "Do not expand into a full worked solution or finished submission.",
        "After the bounded reference, return control with a next-step question or prompt for their attempt.",
        "Never paste internal policy mode names or control tags into the student-visible reply.",
      ].join(" "),
      reason: "bounded_reference",
    };
  }

  if (taskType === "homework_guidance" || taskType === "tutoring") {
    return {
      mode: "break_into_steps",
      requiresStudentParticipation: true,
      systemDirective:
        "Guide with Socratic questions and small steps. Require the student to attempt intermediate reasoning. Do not provide a complete worked solution unless they have shown substantial effort and ask to verify.",
      reason: "guided_learning_default",
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

function normalizeLearningIntent(
  value: LearningIntentCue | undefined,
): LearningIntentCue | undefined {
  if (!value) return undefined;
  return (LEARNING_INTENT_CUES as readonly string[]).includes(value)
    ? value
    : undefined;
}

/**
 * Derive learning vs completion posture from message structure + Study cue.
 * Avoids a giant keyword blacklist; uses intent framing and completion shapes.
 */
function analyzeMessageSignals(
  text: string,
  learningIntent: LearningIntentCue | undefined,
): MessageSignals {
  // Prefer Study compose prefixes (server-authored framing) when present.
  const framedCheck =
    learningIntent === "check_work" ||
    text.startsWith("please check my work:") ||
    /\b(check my work|check my answer|did i get this right|is this right|is my answer correct)\b/.test(
      text,
    );

  const framedHint =
    learningIntent === "hint" ||
    text.startsWith("i need a hint:") ||
    /\b(give me a hint|need a hint|i(?:'| a)?m stuck|nudge me|point me in the right direction)\b/.test(
      text,
    );

  const framedSteps =
    learningIntent === "steps" ||
    text.startsWith("help me break this into steps:") ||
    /\b(break (this|it) into steps|step by step|walk me through the steps|outline the steps)\b/.test(
      text,
    );

  const framedExplain =
    learningIntent === "explain" ||
    text.startsWith("explain this concept:") ||
    /\b(explain (the |this )?(concept|idea|theory|topic)|help me understand|how does .* work)\b/.test(
      text,
    );

  const framedAttempt =
    learningIntent === "attempt" ||
    text.startsWith("here is my attempt.") ||
    /\b(here(?:'| i)s my (attempt|work|solution)|i tried this|my work so far)\b/.test(
      text,
    );

  // Completion-shaped asks: produce the finished academic artifact for the student.
  const wantsDirectCompletion =
    /\b(do my homework|do this (homework|assignment|problem) for me|complete (this|my) (homework|assignment|essay|paper)|write my (essay|paper|lab report|assignment)|finish this (assignment|homework|essay) for me)\b/.test(
      text,
    ) ||
    /\b(give me the (full |final |complete )?(answer|solution)|just (give|tell) me the (answer|solution)|answer only|final answer only|don'?t explain|solve this for me|solve it for me)\b/.test(
      text,
    ) ||
    /^(solve this|do my homework|give me the answer|just tell me the answer)\b/.test(
      text,
    );

  // Minimal reference that unblocks without completing the submission.
  const wantsBoundedReference =
    !wantsDirectCompletion &&
    (/\b(what(?:'| i)?s the formula for|remind me (of )?the (formula|definition|theorem)|what is the definition of)\b/.test(
      text,
    ) ||
      /\bwhat does [a-z0-9 _-]{1,40} stand for\b/.test(text));

  const learningForward =
    framedCheck ||
    framedHint ||
    framedSteps ||
    framedExplain ||
    framedAttempt ||
    /\b(help me (learn|understand|approach)|why (is|does)|teach me)\b/.test(
      text,
    );

  return {
    wantsCheckWork: framedCheck,
    wantsHint: framedHint,
    wantsSteps: framedSteps,
    wantsExplanation: framedExplain,
    providesAttempt: framedAttempt,
    wantsDirectCompletion,
    wantsBoundedReference,
    learningForward,
  };
}
