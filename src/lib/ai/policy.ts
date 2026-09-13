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
 *
 * A learningIntent cue may choose among legitimate tutoring modes, but it must
 * NEVER override a clear direct-completion request in the student message.
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
  /** Optional server-validated Study intent cue (UX posture, not authority). */
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
};

/** Server-authored Study compose prefixes — stripped before completion analysis. */
const STUDY_COMPOSE_PREFIXES = [
  "i need a hint:",
  "please check my work:",
  "explain this concept:",
  "help me break this into steps:",
  "here is my attempt. please give feedback and ask me to keep working:",
] as const;

/**
 * Central academic assistance policy.
 *
 * Precedence (server-authoritative):
 *   1. Non-academic task types → explain
 *   2. Clear direct-completion request → refuse_direct_completion
 *      (client learningIntent cannot downgrade this)
 *   3. Bounded reference (without completion) → limited_answer
 *   4. Structured learning cues / message signals → hint / check_work /
 *      break_into_steps / teach
 *   5. Guided defaults for homework/tutoring
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
  // learningIntent is applied only AFTER completion checks below — never to
  // suppress refuse_direct_completion.
  const signals = analyzeMessageSignals(text);

  if (taskType === "administrative" || taskType === "general_conversation") {
    return {
      mode: "explain",
      requiresStudentParticipation: false,
      systemDirective:
        "Be helpful and concise. This is not an academic integrity-sensitive request.",
      reason: "non_academic",
    };
  }

  // AUTHORITATIVE: finished-work requests refuse even if the client selected
  // explain/hint/steps/ask/attempt as a Study intent cue.
  if (signals.wantsDirectCompletion) {
    return {
      mode: "refuse_direct_completion",
      requiresStudentParticipation: true,
      systemDirective: [
        "Do not produce the completed academic work, final submission, or answer-only result.",
        "Briefly refuse direct completion in natural language.",
        "Immediately offer the strongest allowed learning help: ask for their attempt, give one hint, or outline approach steps without finishing the last step.",
        "Never paste internal policy mode names or control tags into the student-visible reply.",
      ].join(" "),
      reason: learningIntent
        ? "direct_completion_refused_over_learning_intent"
        : "direct_completion_refused",
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

  // Structured Study intents / message signals choose among legitimate modes.
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
 * Strip server-authored Study compose prefixes so completion analysis inspects
 * the student's underlying request body — not the UX framing wrapper.
 */
function extractStudentRequestBody(text: string): string {
  for (const prefix of STUDY_COMPOSE_PREFIXES) {
    if (text.startsWith(prefix)) {
      return text.slice(prefix.length).trim();
    }
  }
  // Also strip optional focus header: [Working on: ...]\n
  const focusStripped = text.replace(/^\[working on:[^\]]*\]\s*/i, "").trim();
  for (const prefix of STUDY_COMPOSE_PREFIXES) {
    if (focusStripped.startsWith(prefix)) {
      return focusStripped.slice(prefix.length).trim();
    }
  }
  return focusStripped;
}

/**
 * Derive message posture from structure.
 * Does not consult learningIntent — cues cannot suppress completion detection.
 */
function analyzeMessageSignals(text: string): MessageSignals {
  const body = extractStudentRequestBody(text);

  // Message-native learning signals (not client intent authority).
  const wantsCheckWork =
    text.startsWith("please check my work:") ||
    /\b(check my work|check my answer|did i get this right|is this right|is my answer correct)\b/.test(
      body,
    );

  const wantsHint =
    text.startsWith("i need a hint:") ||
    /\b(give me a hint|need a hint|i(?:'| a)?m stuck|nudge me|point me in the right direction)\b/.test(
      body,
    );

  const wantsSteps =
    text.startsWith("help me break this into steps:") ||
    /\b(break (this|it) into steps|step by step|walk me through the steps|outline the steps)\b/.test(
      body,
    );

  const wantsExplanation =
    text.startsWith("explain this concept:") ||
    /\b(explain (the |this )?(concept|idea|theory|topic)|help me understand|how does .* work|how (do|should|can) i (approach|write|solve)|explain how to)\b/.test(
      body,
    );

  // Genuine attempt content: student work present, not a completion demand.
  const providesAttempt =
    text.startsWith("here is my attempt.") ||
    /\b(here(?:'| i)s my (attempt|work|solution)|i tried this|my work so far)\b/.test(
      body,
    );

  // Completion-shaped asks against the underlying student body.
  // Keep patterns focused on finished-work requests — not every use of "answer".
  const wantsDirectCompletion =
    /\b(do my homework|do this (homework|assignment|problem) for me|complete (this|my) (homework|assignment|essay|paper)|write my (entire |whole |complete )?(essay|paper|lab report|assignment|homework)|finish (this |my )?(assignment|homework|essay)( for me)?)\b/.test(
      body,
    ) ||
    /\b(give me the (full |final |complete )?(answer|solution)|just (give|tell) me the (answer|solution)|answer only|final answer only|don'?t explain|solve this for me|solve it for me)\b/.test(
      body,
    ) ||
    /^(solve this|do my homework|give me the answer|just tell me the answer|write my (entire |whole |complete )?(essay|paper|assignment|homework))\b/.test(
      body,
    );

  // Minimal reference that unblocks without completing the submission.
  // Allow a short qualifier between "the" and formula/definition/theorem
  // ("quadratic formula", "definition of a derivative").
  const wantsBoundedReference =
    !wantsDirectCompletion &&
    (/\b(what(?:'| i)?s the formula for|remind me (of )?the .{0,40}?\b(formula|definition|theorem)\b|what is the definition of)\b/.test(
      body,
    ) ||
      /\bwhat does [a-z0-9 _-]{1,40} stand for\b/.test(body));

  return {
    wantsCheckWork,
    wantsHint,
    wantsSteps,
    wantsExplanation,
    providesAttempt,
    wantsDirectCompletion,
    wantsBoundedReference,
  };
}
