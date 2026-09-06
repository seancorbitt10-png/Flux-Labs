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
  | {
      kind: "profile";
      field: "academicLevel" | "preferredAssistanceStyle" | "goalsSummary";
    }
  | { kind: "none" };

export type OnboardingOption = {
  value: string;
  label: string;
};

export type OnboardingQuestion = {
  questionId: string;
  cluster: string;
  prompt: string;
  answerType: OnboardingAnswerType;
  schema: z.ZodType;
  essential: boolean;
  skippable: boolean;
  mapping: OnboardingMapping;
  /** Enum choices for UI rendering — server remains authoritative. */
  options?: readonly OnboardingOption[];
  maxLength?: number;
  maxItems?: number;
  itemMaxLength?: number;
  placeholder?: string;
};

/** Client-safe question shape — no Zod schemas or mapping targets. */
export type ClientOnboardingQuestion = {
  questionId: string;
  cluster: string;
  prompt: string;
  answerType: OnboardingAnswerType;
  essential: boolean;
  skippable: boolean;
  options?: readonly OnboardingOption[];
  maxLength?: number;
  maxItems?: number;
  itemMaxLength?: number;
  placeholder?: string;
};

const MAX_TEXT = 300;
const MAX_SUBJECTS = 12;
const MAX_COURSES = 8;
const MAX_TOPICS = 8;
const MAX_ITEM = 80;
const MAX_CHALLENGE = 200;
const MAX_INTEREST = 200;

/**
 * Server-controlled onboarding question catalog (ONBOARDING_SPEC §8).
 * Clients cannot invent question IDs or mapping targets.
 * No legal-consent questions. No learning-style questions.
 */
export const ONBOARDING_QUESTIONS: readonly OnboardingQuestion[] = [
  // —— Cluster A: Academic environment ——
  {
    questionId: "academic.level",
    cluster: "academic",
    prompt: "What is your academic level?",
    answerType: "enum",
    schema: z.enum(ACADEMIC_LEVEL_VALUES),
    options: [
      { value: "hs", label: "High school" },
      { value: "undergrad", label: "Undergraduate" },
      { value: "grad", label: "Graduate" },
      { value: "other", label: "Other" },
    ],
    essential: true,
    skippable: true,
    mapping: { kind: "attribute", key: "academic.level" },
  },
  {
    questionId: "academic.setting",
    cluster: "academic",
    prompt: "Where are you primarily learning?",
    answerType: "enum",
    schema: z.enum(["high_school", "college", "self_directed", "other"]),
    options: [
      { value: "high_school", label: "High school" },
      { value: "college", label: "College / university" },
      { value: "self_directed", label: "Self-directed" },
      { value: "other", label: "Other" },
    ],
    essential: false,
    skippable: true,
    mapping: { kind: "none" },
  },
  {
    questionId: "academic.target_band",
    cluster: "academic",
    prompt: "Roughly when is your next major academic milestone?",
    answerType: "enum",
    schema: z.enum(["this_month", "this_term", "this_year", "unsure"]),
    options: [
      { value: "this_month", label: "This month" },
      { value: "this_term", label: "This term" },
      { value: "this_year", label: "This year" },
      { value: "unsure", label: "Not sure yet" },
    ],
    essential: false,
    skippable: true,
    mapping: { kind: "none" },
  },
  {
    questionId: "academic.year_band",
    cluster: "academic",
    prompt: "What year or level band are you in?",
    answerType: "string",
    schema: z.string().trim().min(1).max(80),
    maxLength: 80,
    placeholder: "e.g. Sophomore, Year 11, Gap year",
    essential: false,
    skippable: true,
    mapping: { kind: "none" },
  },

  // —— Cluster B: Courses / subjects ——
  {
    questionId: "academic.subjects",
    cluster: "courses",
    prompt: "Which subjects are you focusing on this term?",
    answerType: "string_array",
    schema: z
      .array(z.string().trim().min(1).max(MAX_ITEM))
      .min(1)
      .max(MAX_SUBJECTS),
    maxItems: MAX_SUBJECTS,
    itemMaxLength: MAX_ITEM,
    placeholder: "Add a subject",
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
    maxLength: MAX_TEXT,
    placeholder: "A class, topic, or skill that feels toughest",
    essential: false,
    skippable: true,
    mapping: { kind: "none" },
  },
  {
    questionId: "course.list_optional",
    cluster: "courses",
    prompt: "Optional: list your current course names",
    answerType: "string_array",
    schema: z
      .array(z.string().trim().min(1).max(MAX_ITEM))
      .min(1)
      .max(MAX_COURSES),
    maxItems: MAX_COURSES,
    itemMaxLength: MAX_ITEM,
    placeholder: "Add a course name",
    essential: false,
    skippable: true,
    mapping: { kind: "none" },
  },
  {
    questionId: "exam.soon",
    cluster: "courses",
    prompt: "Do you have a major exam within 2 weeks?",
    answerType: "boolean",
    schema: z.boolean(),
    essential: false,
    skippable: true,
    mapping: { kind: "none" },
  },

  // —— Cluster C: Goals ——
  {
    questionId: "goal.primary",
    cluster: "goals",
    prompt: "What is your top goal for using Flux?",
    answerType: "string",
    schema: z.string().trim().min(1).max(MAX_TEXT),
    maxLength: MAX_TEXT,
    placeholder: "e.g. Stay on top of weekly problem sets",
    essential: true,
    skippable: true,
    mapping: { kind: "goal", category: "primary" },
  },
  {
    questionId: "goal.secondary",
    cluster: "goals",
    prompt: "Any second goal?",
    answerType: "string",
    schema: z.string().trim().min(1).max(MAX_TEXT),
    maxLength: MAX_TEXT,
    placeholder: "Optional second priority",
    essential: false,
    skippable: true,
    mapping: { kind: "goal", category: "secondary" },
  },
  {
    questionId: "goal.success_month",
    cluster: "goals",
    prompt: "What would success look like this month?",
    answerType: "string",
    schema: z.string().trim().min(1).max(MAX_TEXT),
    maxLength: MAX_TEXT,
    placeholder: "A concrete outcome you want this month",
    essential: true,
    skippable: true,
    mapping: { kind: "profile", field: "goalsSummary" },
  },
  {
    questionId: "goal.org_vs_understanding",
    cluster: "goals",
    prompt: "Prioritize organization or deeper understanding right now?",
    answerType: "enum",
    schema: z.enum(["organization", "understanding", "both"]),
    options: [
      { value: "organization", label: "Organization / planning" },
      { value: "understanding", label: "Deeper understanding" },
      { value: "both", label: "Both equally" },
    ],
    essential: false,
    skippable: true,
    mapping: { kind: "none" },
  },

  // —— Cluster D: Workload / constraints ——
  {
    questionId: "habit.typical_weekly_time",
    cluster: "workload",
    prompt: "About how many hours do you study in a typical week?",
    answerType: "enum",
    schema: z.enum(WEEKLY_TIME_BAND_VALUES),
    options: [
      { value: "under_3h", label: "Under 3 hours" },
      { value: "3_to_6h", label: "3–6 hours" },
      { value: "6_to_10h", label: "6–10 hours" },
      { value: "10_to_15h", label: "10–15 hours" },
      { value: "over_15h", label: "Over 15 hours" },
    ],
    essential: true,
    skippable: true,
    mapping: { kind: "attribute", key: "habit.typical_weekly_time" },
  },
  {
    questionId: "constraint.time_pressure",
    cluster: "workload",
    prompt: "Are you under significant time pressure this term?",
    answerType: "boolean",
    schema: z.boolean(),
    essential: false,
    skippable: true,
    mapping: { kind: "none" },
  },
  {
    questionId: "constraint.notes",
    cluster: "workload",
    prompt: "Anything Flux should know about your schedule limits?",
    answerType: "string",
    schema: z.string().trim().min(1).max(MAX_TEXT),
    maxLength: MAX_TEXT,
    placeholder: "e.g. Work evenings, limited weekends",
    essential: false,
    skippable: true,
    mapping: { kind: "none" },
  },

  // —— Cluster E: Habits & workflow preferences ——
  {
    questionId: "pref.assistance_style",
    cluster: "preferences",
    prompt: "How should Flux help by default?",
    answerType: "enum",
    schema: z.enum(ASSISTANCE_STYLE_VALUES),
    options: [
      { value: "hints_first", label: "Hints first" },
      { value: "explain_first", label: "Explain concepts first" },
      { value: "check_work_first", label: "Check my work first" },
    ],
    essential: true,
    skippable: true,
    mapping: { kind: "attribute", key: "pref.assistance_style" },
  },
  {
    questionId: "pref.explanation_length",
    cluster: "preferences",
    prompt: "Concise or detailed explanations?",
    answerType: "enum",
    schema: z.enum(EXPLANATION_LENGTH_VALUES),
    options: [
      { value: "concise", label: "Concise" },
      { value: "detailed", label: "Detailed" },
    ],
    essential: true,
    skippable: true,
    mapping: { kind: "attribute", key: "pref.explanation_length" },
  },
  {
    questionId: "pref.guided_participation",
    cluster: "preferences",
    prompt: "Push guided participation by default?",
    answerType: "boolean",
    schema: z.boolean(),
    essential: true,
    skippable: true,
    mapping: { kind: "attribute", key: "pref.guided_participation" },
  },
  {
    questionId: "habit.session_length",
    cluster: "preferences",
    prompt: "Typical study session length?",
    answerType: "enum",
    schema: z.enum(["under_25m", "25_to_50m", "50_to_90m", "over_90m"]),
    options: [
      { value: "under_25m", label: "Under 25 minutes" },
      { value: "25_to_50m", label: "25–50 minutes" },
      { value: "50_to_90m", label: "50–90 minutes" },
      { value: "over_90m", label: "Over 90 minutes" },
    ],
    essential: false,
    skippable: true,
    mapping: { kind: "none" },
  },
  {
    questionId: "approach.worked_example",
    cluster: "preferences",
    prompt: "Do worked examples usually help you?",
    answerType: "boolean",
    schema: z.boolean(),
    essential: false,
    skippable: true,
    mapping: { kind: "attribute", key: "approach.worked_example" },
  },

  // —— Cluster F: Help areas / challenges ——
  {
    questionId: "challenge.primary",
    cluster: "challenges",
    prompt: "Biggest current academic challenge?",
    answerType: "string",
    schema: z.string().trim().min(1).max(MAX_CHALLENGE),
    maxLength: MAX_CHALLENGE,
    placeholder: "e.g. Staying consistent with problem sets",
    essential: true,
    skippable: true,
    mapping: { kind: "attribute", key: "challenge.primary" },
  },
  {
    questionId: "challenge.shaky_topics",
    cluster: "challenges",
    prompt: "Topics that feel shaky (optional)?",
    answerType: "string_array",
    schema: z
      .array(z.string().trim().min(1).max(MAX_ITEM))
      .min(1)
      .max(MAX_TOPICS),
    maxItems: MAX_TOPICS,
    itemMaxLength: MAX_ITEM,
    placeholder: "Add a topic",
    essential: false,
    skippable: true,
    mapping: { kind: "none" },
  },
  {
    questionId: "intent.priority",
    cluster: "challenges",
    prompt: "What should Flux prioritize first?",
    answerType: "string",
    schema: z.string().trim().min(1).max(MAX_TEXT),
    maxLength: MAX_TEXT,
    placeholder: "What would help most this week?",
    essential: false,
    skippable: true,
    mapping: { kind: "none" },
  },
  {
    questionId: "interest.primary",
    cluster: "challenges",
    prompt: "Subject or topic that interests you most?",
    answerType: "string",
    schema: z.string().trim().min(1).max(MAX_INTEREST),
    maxLength: MAX_INTEREST,
    placeholder: "Something you enjoy studying",
    essential: false,
    skippable: true,
    mapping: { kind: "attribute", key: "interest.primary" },
  },

  // —— Cluster G: Optional interaction prefs ——
  {
    questionId: "interest.secondary",
    cluster: "optional",
    prompt: "Another interest?",
    answerType: "string",
    schema: z.string().trim().min(1).max(MAX_INTEREST),
    maxLength: MAX_INTEREST,
    placeholder: "Optional second interest",
    essential: false,
    skippable: true,
    mapping: { kind: "attribute", key: "interest.secondary" },
  },
  {
    questionId: "pref.avoid",
    cluster: "optional",
    prompt: "Anything Flux should avoid in tone or approach?",
    answerType: "string",
    schema: z.string().trim().min(1).max(MAX_TEXT),
    maxLength: MAX_TEXT,
    placeholder: "Optional — practical preferences only",
    essential: false,
    skippable: true,
    mapping: { kind: "none" },
  },
  // Removed from 2026-09-phase2 active catalog (was 27 → 26):
  // `context.motivation` — answer-only optional free text with no Student Model
  // mapping and the weakest link to downstream academic assistance behavior.
  // Existing OnboardingAnswer rows for that id (if any) are left untouched and
  // are not reinterpreted under a new schema.
] as const;

const QUESTION_COUNT = ONBOARDING_QUESTIONS.length;
if (QUESTION_COUNT < 22 || QUESTION_COUNT > 26) {
  throw new Error(
    `Onboarding catalog out of range: ${QUESTION_COUNT} (expected 22–26).`,
  );
}

export function getOnboardingCatalog(version: string = ONBOARDING_VERSION) {
  if (version !== ONBOARDING_VERSION) {
    throw new ValidationError("Unsupported onboarding catalog version.");
  }
  return {
    version: ONBOARDING_VERSION,
    questions: ONBOARDING_QUESTIONS,
  };
}

export function toClientOnboardingQuestion(
  question: OnboardingQuestion,
): ClientOnboardingQuestion {
  return {
    questionId: question.questionId,
    cluster: question.cluster,
    prompt: question.prompt,
    answerType: question.answerType,
    essential: question.essential,
    skippable: question.skippable,
    options: question.options,
    maxLength: question.maxLength,
    maxItems: question.maxItems,
    itemMaxLength: question.itemMaxLength,
    placeholder: question.placeholder,
  };
}

export function getClientOnboardingCatalog(
  version: string = ONBOARDING_VERSION,
) {
  const catalog = getOnboardingCatalog(version);
  return {
    version: catalog.version,
    questions: catalog.questions.map(toClientOnboardingQuestion),
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

/** Suggested subject chips for UI — free-text values still validated by schema. */
export const SUBJECT_SUGGESTIONS = [
  "Math",
  "Physics",
  "Chemistry",
  "Biology",
  "Computer Science",
  "History",
  "English",
  "Economics",
  "Psychology",
  "Foreign Language",
] as const;
