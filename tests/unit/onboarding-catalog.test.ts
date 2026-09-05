import { describe, expect, it } from "vitest";
import {
  getClientOnboardingCatalog,
  getOnboardingCatalog,
  getOnboardingQuestion,
  listEssentialQuestionIds,
  ONBOARDING_QUESTIONS,
  ONBOARDING_VERSION,
  validateOnboardingAnswer,
} from "@/lib/onboarding/catalog";
import { ValidationError } from "@/lib/errors";

describe("onboarding catalog", () => {
  it("exposes a versioned catalog within the approved size band", () => {
    const catalog = getOnboardingCatalog(ONBOARDING_VERSION);
    expect(catalog.version).toBe(ONBOARDING_VERSION);
    expect(catalog.questions.length).toBeGreaterThanOrEqual(22);
    expect(catalog.questions.length).toBeLessThanOrEqual(30);
    expect(ONBOARDING_QUESTIONS.length).toBe(catalog.questions.length);
  });

  it("rejects unsupported catalog versions", () => {
    expect(() => getOnboardingCatalog("legacy-v0")).toThrow(ValidationError);
    expect(() => getOnboardingQuestion("academic.level", "legacy-v0")).toThrow(
      ValidationError,
    );
  });

  it("rejects unknown question IDs", () => {
    expect(() => getOnboardingQuestion("learning.style.vak")).toThrow(
      ValidationError,
    );
    expect(() => getOnboardingQuestion("consent.legal")).toThrow(
      ValidationError,
    );
  });

  it("does not include learning-style or legal-consent questions", () => {
    const ids = ONBOARDING_QUESTIONS.map((q) => q.questionId);
    expect(ids.some((id) => id.includes("learning.style"))).toBe(false);
    expect(ids.some((id) => id.includes("consent"))).toBe(false);
    expect(ids.some((id) => id.includes("privacy"))).toBe(false);
    for (const q of ONBOARDING_QUESTIONS) {
      expect(q.prompt.toLowerCase()).not.toMatch(/visual learner|auditory|kinesthetic|privacy policy|i agree|i consent/);
    }
  });

  it("validates enum/string/array/boolean answers and skips", () => {
    const level = getOnboardingQuestion("academic.level");
    expect(validateOnboardingAnswer(level, "hs", false)).toBe("hs");
    expect(() => validateOnboardingAnswer(level, "wizard", false)).toThrow(
      ValidationError,
    );
    expect(validateOnboardingAnswer(level, "hs", true)).toBeNull();

    const subjects = getOnboardingQuestion("academic.subjects");
    expect(validateOnboardingAnswer(subjects, ["Math", "Physics"], false)).toEqual([
      "Math",
      "Physics",
    ]);
    expect(() =>
      validateOnboardingAnswer(subjects, ["x".repeat(100)], false),
    ).toThrow(ValidationError);
    expect(() =>
      validateOnboardingAnswer(
        subjects,
        Array.from({ length: 20 }, (_, i) => `s${i}`),
        false,
      ),
    ).toThrow(ValidationError);

    const guided = getOnboardingQuestion("pref.guided_participation");
    expect(validateOnboardingAnswer(guided, true, false)).toBe(true);
    expect(() => validateOnboardingAnswer(guided, "yes", false)).toThrow(
      ValidationError,
    );

    const goal = getOnboardingQuestion("goal.primary");
    expect(() =>
      validateOnboardingAnswer(goal, "x".repeat(400), false),
    ).toThrow(ValidationError);
  });

  it("lists essential question ids and strips mappings from client catalog", () => {
    const essential = listEssentialQuestionIds();
    expect(essential).toContain("academic.level");
    expect(essential).toContain("pref.assistance_style");
    expect(essential.length).toBeGreaterThanOrEqual(8);

    const client = getClientOnboardingCatalog();
    expect(client.questions[0]).not.toHaveProperty("mapping");
    expect(client.questions[0]).not.toHaveProperty("schema");
    expect(client.questions[0]).toHaveProperty("questionId");
    expect(client.questions[0]).toHaveProperty("prompt");
  });

  it("keeps answer-only mappings for non-promoted questions", () => {
    const answerOnly = [
      "academic.setting",
      "academic.hardest_class",
      "course.list_optional",
      "exam.soon",
      "habit.session_length",
      "constraint.notes",
      "intent.priority",
    ];
    for (const id of answerOnly) {
      expect(getOnboardingQuestion(id).mapping.kind).toBe("none");
    }
    expect(getOnboardingQuestion("academic.subjects").mapping).toEqual({
      kind: "attribute",
      key: "academic.subjects",
    });
    expect(getOnboardingQuestion("goal.primary").mapping).toEqual({
      kind: "goal",
      category: "primary",
    });
  });
});
