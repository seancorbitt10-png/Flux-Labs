import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import {
  ACADEMIC_LEVEL_VALUES,
  ASSISTANCE_STYLE_VALUES,
  EXPLANATION_LENGTH_VALUES,
  WEEKLY_TIME_BAND_VALUES,
} from "@/lib/student/attribute-registry";

export const ONBOARDING_VERSION = "2026-09-phase2" as const;

export type OnboardingAnswerType =
  | "enum"
  | "string"
  | "string_array"
  | "boolean";

export type OnboardingMapping =
  | { kind: "attribute"; key: string }
  | { kind: "goal"; category?: string }
  | { kind: "profile"; field: "academicLevel" | "preferredAssistanceStyle" | "goalsSummary" }
  | { kind: "none" };

export type OnboardingQuestion = {
  questionId: string;
  cluster: string;
  prompt: string;
  answerType: OnboardingAnswerType;
  schema: z.ZodType;
  essential: boolean;
  skippable: boolean;
  mapping: OnboardingMapping;
};

const MAX_TEXT = 300;
const MAX_SUBJECTS = 12;

/**
 * Server-controlled onboarding question catalog.
 * Clients cannot invent question IDs or mapping targets.
 * No legal-consent questions.
 */
export const ONBOARDING_QUESTIONS: readonly OnboardingQuestion[] = [
  {
    questionId: "academic.level",
    cluster: "you",
    prompt: "What is your academic level?",
    answerType: "enum",
    schema: z.enum(ACADEMIC_LEVEL_VALUES),
    essential: true,
    skippable: true,
    mapping: { kind: "attribute", key: "academic.level" },
  },
  {
    questionId: "academic.setting",
    cluster: "you",
    prompt: "Where are you primarily learning right now?",
    answerType: "enum",
    schema: z.enum(["high_school", "college", "self_directed", "other"]),
    essential: false,
    skippable: true,
    mapping: { kind: "none" },
  },
  {
    questionId: "academic.subjects",
    cluster: "courses",
    prompt: "Which subjects are you focusing on this term?",
    answerType: "string_array",
    schema: z
      .array(z.string().trim().min(1).max(80))
      .min(1)
      .max(MAX_SUBJECTS),
    essential: true,
    skippable: true,
    mapping: { kind: "attribute", key: "academic.subjects" },
  },
  {
    questionId: "academic.hardest_class",
    cluster: "courses",
    prompt: "What feels hardest right now?",
    answerType: "string",
    schema: z.string().trim().min(1).max(MAX_TEXT),
    essential: false,
    skippable: true,
    mapping: { kind: "none" },
  },
  {
    questionId: "goal.primary",
    cluster: "goals",
    prompt: "What is your top goal for using Flux?",
    answerType: "string",
    schema: z.string().trim().min(1).max(MAX_TEXT),
    essential: true,
    skippable: true,
    mapping: { kind: "goal", category: "primary" },
  },
  {
    questionId: "goal.success_month",
    cluster: "goals",
    prompt: "What would success look like this month?",
    answerType: "string",
    schema: z.string().trim().min(1).max(MAX_TEXT),
    essential: true,
    skippable: true,
    mapping: { kind: "profile", field: "goalsSummary" },
  },
  {
    questionId: "interest.primary",
    cluster: "goals",
    prompt: "What subject or topic interests you most?",
    answerType: "string",
    schema: z.string().trim().min(1).max(200),
    essential: false,
    skippable: true,
    mapping: { kind: "attribute", key: "interest.primary" },
  },
  {
    questionId: "challenge.primary",
    cluster: "challenges",
    prompt: "What is your biggest current academic challenge?",
    answerType: "string",
    schema: z.string().trim().min(1).max(200),
    essential: true,
    skippable: true,
    mapping: { kind: "attribute", key: "challenge.primary" },
  },
  {
    questionId: "pref.assistance_style",
    cluster: "preferences",
    prompt: "How should Flux help by default?",
    answerType: "enum",
    schema: z.enum(ASSISTANCE_STYLE_VALUES),
    essential: true,
    skippable: true,
    mapping: { kind: "attribute", key: "pref.assistance_style" },
  },
  {
    questionId: "pref.explanation_length",
    cluster: "preferences",
    prompt: "Do you prefer concise or detailed explanations?",
    answerType: "enum",
    schema: z.enum(EXPLANATION_LENGTH_VALUES),
    essential: true,
    skippable: true,
    mapping: { kind: "attribute", key: "pref.explanation_length" },
  },
  {
    questionId: "pref.guided_participation",
    cluster: "preferences",
    prompt: "Should Flux push guided participation by default?",
    answerType: "boolean",
    schema: z.boolean(),
    essential: true,
    skippable: true,
    mapping: { kind: "attribute", key: "pref.guided_participation" },
  },
  {
    questionId: "habit.typical_weekly_time",
    cluster: "habits",
    prompt: "About how many hours do you study in a typical week?",
    answerType: "enum",
    schema: z.enum(WEEKLY_TIME_BAND_VALUES),
    essential: true,
    skippable: true,
    mapping: { kind: "attribute", key: "habit.typical_weekly_time" },
  },
  {
    questionId: "intent.priority",
    cluster: "intent",
    prompt: "What should Flux prioritize helping you with first?",
    answerType: "string",
    schema: z.string().trim().min(1).max(MAX_TEXT),
    essential: false,
    skippable: true,
    mapping: { kind: "none" },
  },
] as const;

export function getOnboardingCatalog(version: string = ONBOARDING_VERSION) {
  if (version !== ONBOARDING_VERSION) {
    throw new ValidationError("Unsupported onboarding catalog version.");
  }
  return {
    version: ONBOARDING_VERSION,
    questions: ONBOARDING_QUESTIONS,
  };
}

export function getOnboardingQuestion(
  questionId: string,
  version: string = ONBOARDING_VERSION,
): OnboardingQuestion {
  getOnboardingCatalog(version);
  const q = ONBOARDING_QUESTIONS.find((item) => item.questionId === questionId);
  if (!q) {
    throw new ValidationError("Unknown onboarding question.");
  }
  return q;
}

export function validateOnboardingAnswer(
  question: OnboardingQuestion,
  answer: unknown,
  skipped: boolean,
): unknown | null {
  if (skipped) {
    return null;
  }
  const parsed = question.schema.safeParse(answer);
  if (!parsed.success) {
    throw new ValidationError("Invalid onboarding answer for question.");
  }
  return parsed.data;
}

export function listEssentialQuestionIds(
  version: string = ONBOARDING_VERSION,
): string[] {
  return getOnboardingCatalog(version)
    .questions.filter((q) => q.essential)
    .map((q) => q.questionId);
}
