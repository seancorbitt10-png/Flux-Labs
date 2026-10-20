import { ValidationError } from "@/lib/errors";
import type { ClientOnboardingQuestion } from "./catalog";

export type OnboardingResumeState = {
  questionIndex: number;
  questionId: string;
  draft: unknown;
  tagInput: string;
};

export type OnboardingViewState = {
  index: number;
  draft: unknown;
  tagInput: string;
};

type ResumeQuestion = Pick<
  ClientOnboardingQuestion,
  "questionId" | "answerType" | "options" | "maxLength" | "maxItems" | "itemMaxLength"
>;

export function isOnboardingDraftReady(
  question: Pick<ClientOnboardingQuestion, "answerType">,
  value: unknown,
): boolean {
  switch (question.answerType) {
    case "enum":
      return typeof value === "string" && value.length > 0;
    case "string":
      return typeof value === "string" && value.trim().length > 0;
    case "string_array":
      return Array.isArray(value) && value.length > 0;
    case "boolean":
      return typeof value === "boolean";
    default:
      return false;
  }
}

export function emptyDraftForQuestion(
  question: Pick<ClientOnboardingQuestion, "answerType"> | undefined,
): unknown {
  if (question?.answerType === "string_array") return [];
  if (question?.answerType === "boolean") return null;
  return "";
}

function optionValues(
  question: Pick<ClientOnboardingQuestion, "options">,
): readonly string[] {
  return question.options?.map((option) => option.value) ?? [];
}

/**
 * Validate an unfinished current-question draft for durable resume storage.
 * Allows empty / incomplete values; does not treat them as submitted answers.
 */
export function validateOnboardingResumeDraft(
  question: ResumeQuestion,
  draft: unknown,
  tagInput: unknown = "",
): { draft: unknown; tagInput: string } {
  const itemMax = question.itemMaxLength ?? 80;
  const rawTag = typeof tagInput === "string" ? tagInput : "";
  if (rawTag.length > itemMax) {
    throw new ValidationError("Pending item is too long to save.");
  }

  switch (question.answerType) {
    case "enum": {
      if (draft !== "" && typeof draft !== "string") {
        throw new ValidationError("Invalid draft for this question.");
      }
      if (typeof draft === "string" && draft.length > 0) {
        if (!optionValues(question).includes(draft)) {
          throw new ValidationError("Invalid draft for this question.");
        }
      }
      return { draft: typeof draft === "string" ? draft : "", tagInput: "" };
    }
    case "string": {
      if (typeof draft !== "string") {
        throw new ValidationError("Invalid draft for this question.");
      }
      const maxLength = question.maxLength ?? 300;
      if (draft.length > maxLength) {
        throw new ValidationError("Invalid draft for this question.");
      }
      return { draft, tagInput: "" };
    }
    case "boolean": {
      if (draft !== true && draft !== false && draft !== null) {
        throw new ValidationError("Invalid draft for this question.");
      }
      return { draft, tagInput: "" };
    }
    case "string_array": {
      if (!Array.isArray(draft)) {
        throw new ValidationError("Invalid draft for this question.");
      }
      const maxItems = question.maxItems ?? 12;
      if (draft.length > maxItems) {
        throw new ValidationError("Invalid draft for this question.");
      }
      const items: string[] = [];
      for (const item of draft) {
        if (typeof item !== "string") {
          throw new ValidationError("Invalid draft for this question.");
        }
        if (item.length > itemMax) {
          throw new ValidationError("Invalid draft for this question.");
        }
        items.push(item);
      }
      return { draft: items, tagInput: rawTag };
    }
    default:
      throw new ValidationError("Invalid draft for this question.");
  }
}

export function onboardingResumeDraftPayload(
  question: ResumeQuestion,
  draft: unknown,
  tagInput = "",
): { draft: unknown; tagInput: string } {
  return validateOnboardingResumeDraft(question, draft, tagInput);
}

export function viewStateForQuestion(args: {
  index: number;
  questions: readonly ClientOnboardingQuestion[];
  answers: Record<
    string,
    { questionId: string; skipped: boolean; answer: unknown | null }
  >;
  resume: OnboardingResumeState | null;
}): OnboardingViewState {
  const maxIndex = Math.max(args.questions.length - 1, 0);
  const index = Math.max(0, Math.min(args.index, maxIndex));
  const question = args.questions[index];
  if (
    args.resume &&
    args.resume.questionIndex === index &&
    question &&
    args.resume.questionId === question.questionId
  ) {
    return {
      index,
      draft: args.resume.draft,
      tagInput: args.resume.tagInput,
    };
  }

  const existing = question ? args.answers[question.questionId] : undefined;
  if (existing && !existing.skipped) {
    return { index, draft: existing.answer, tagInput: "" };
  }
  return { index, draft: emptyDraftForQuestion(question), tagInput: "" };
}

export function initialOnboardingViewState(args: {
  questions: readonly ClientOnboardingQuestion[];
  answers: Record<
    string,
    { questionId: string; skipped: boolean; answer: unknown | null }
  >;
  progress: { firstUnansweredIndex: number };
  resume: OnboardingResumeState | null;
}): OnboardingViewState {
  const resumeIndex = args.resume?.questionIndex;
  const index =
    typeof resumeIndex === "number"
      ? resumeIndex
      : args.progress.firstUnansweredIndex;
  return viewStateForQuestion({
    index,
    questions: args.questions,
    answers: args.answers,
    resume: args.resume,
  });
}

export function deferResultAllowsNavigation(result: {
  ok: boolean;
}): boolean {
  return result.ok === true;
}
