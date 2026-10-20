import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { navItems } from "@/components/layout/nav-config";
import { ValidationError } from "@/lib/errors";
import {
  deferResultAllowsNavigation,
  initialOnboardingViewState,
  isOnboardingDraftReady,
  onboardingResumeDraftPayload,
  validateOnboardingResumeDraft,
  viewStateForQuestion,
} from "@/lib/onboarding/defer-draft";
import type { ClientOnboardingQuestion } from "@/lib/onboarding/catalog";

const enumQuestion: ClientOnboardingQuestion = {
  questionId: "academic.level",
  cluster: "academic",
  prompt: "What is your academic level?",
  answerType: "enum",
  essential: true,
  skippable: true,
  options: [
    { value: "hs", label: "High school" },
    { value: "undergrad", label: "Undergraduate" },
  ],
};

const stringQuestion: ClientOnboardingQuestion = {
  questionId: "goal.primary",
  cluster: "goals",
  prompt: "Primary goal?",
  answerType: "string",
  essential: true,
  skippable: true,
  maxLength: 300,
};

const arrayQuestion: ClientOnboardingQuestion = {
  questionId: "academic.subjects",
  cluster: "academic",
  prompt: "Subjects?",
  answerType: "string_array",
  essential: true,
  skippable: true,
  maxItems: 12,
  itemMaxLength: 80,
};

const booleanQuestion: ClientOnboardingQuestion = {
  questionId: "pref.guided_participation",
  cluster: "prefs",
  prompt: "Guided?",
  answerType: "boolean",
  essential: false,
  skippable: true,
};

const questions = [enumQuestion, stringQuestion, arrayQuestion, booleanQuestion];

describe("Set up later unfinished draft payload", () => {
  it("keeps empty drafts persistable without treating them as submitted answers", () => {
    expect(onboardingResumeDraftPayload(enumQuestion, "")).toEqual({
      draft: "",
      tagInput: "",
    });
    expect(onboardingResumeDraftPayload(stringQuestion, "   ")).toEqual({
      draft: "   ",
      tagInput: "",
    });
    expect(onboardingResumeDraftPayload(arrayQuestion, [])).toEqual({
      draft: [],
      tagInput: "",
    });
    expect(onboardingResumeDraftPayload(booleanQuestion, null)).toEqual({
      draft: null,
      tagInput: "",
    });
    expect(isOnboardingDraftReady(enumQuestion, "")).toBe(false);
  });

  it("persists valid current edits and pending tag input separately", () => {
    expect(onboardingResumeDraftPayload(enumQuestion, "undergrad")).toEqual({
      draft: "undergrad",
      tagInput: "",
    });
    expect(
      onboardingResumeDraftPayload(stringQuestion, "Pass organic"),
    ).toEqual({ draft: "Pass organic", tagInput: "" });
    expect(onboardingResumeDraftPayload(booleanQuestion, true)).toEqual({
      draft: true,
      tagInput: "",
    });
    expect(
      onboardingResumeDraftPayload(arrayQuestion, ["Math"], "Chemistry"),
    ).toEqual({ draft: ["Math"], tagInput: "Chemistry" });
    expect(isOnboardingDraftReady(enumQuestion, "hs")).toBe(true);
  });

  it("rejects invalid resume drafts", () => {
    expect(() =>
      validateOnboardingResumeDraft(enumQuestion, "not-a-level"),
    ).toThrow(ValidationError);
    expect(() =>
      validateOnboardingResumeDraft(arrayQuestion, ["x".repeat(81)]),
    ).toThrow(ValidationError);
    expect(() =>
      validateOnboardingResumeDraft(arrayQuestion, ["Math"], "x".repeat(81)),
    ).toThrow(ValidationError);
  });
});

describe("resume view restoration", () => {
  const answers = {
    "academic.level": {
      questionId: "academic.level",
      skipped: false,
      answer: "hs",
    },
  };

  it("restores the exact deferred question, not the first unanswered gap", () => {
    const view = initialOnboardingViewState({
      questions,
      answers,
      progress: { firstUnansweredIndex: 1 },
      resume: {
        questionIndex: 0,
        questionId: "academic.level",
        draft: "undergrad",
        tagInput: "",
      },
    });
    expect(view.index).toBe(0);
    expect(view.draft).toBe("undergrad");
    expect(questions[1]?.questionId).toBe("goal.primary");
  });

  it("restores unfinished draft and pending tag input after a remount", () => {
    const bootstrap = {
      questions,
      answers,
      progress: { firstUnansweredIndex: 2 },
      resume: {
        questionIndex: 2,
        questionId: "academic.subjects",
        draft: ["Math"],
        tagInput: "Chem",
      },
    };
    const firstMount = initialOnboardingViewState(bootstrap);
    const remount = initialOnboardingViewState(bootstrap);
    expect(firstMount).toEqual(remount);
    expect(remount).toEqual({
      index: 2,
      draft: ["Math"],
      tagInput: "Chem",
    });
  });

  it("does not let earlier unanswered questions move the resume cursor", () => {
    const view = initialOnboardingViewState({
      questions,
      answers: {},
      progress: { firstUnansweredIndex: 0 },
      resume: {
        questionIndex: 3,
        questionId: "pref.guided_participation",
        draft: true,
        tagInput: "",
      },
    });
    expect(view.index).toBe(3);
    expect(view.draft).toBe(true);
  });

  it("restores submitted answers when navigating away from the deferred question", () => {
    const resume = {
      questionIndex: 2,
      questionId: "academic.subjects",
      draft: ["Physics"],
      tagInput: "Bio",
    };
    const submitted = viewStateForQuestion({
      index: 0,
      questions,
      answers,
      resume,
    });
    expect(submitted.draft).toBe("hs");
    expect(submitted.tagInput).toBe("");

    const deferred = viewStateForQuestion({
      index: 2,
      questions,
      answers,
      resume,
    });
    expect(deferred.draft).toEqual(["Physics"]);
    expect(deferred.tagInput).toBe("Bio");
  });

  it("uses first unanswered index for users who have never deferred", () => {
    const view = initialOnboardingViewState({
      questions,
      answers,
      progress: { firstUnansweredIndex: 1 },
      resume: null,
    });
    expect(view.index).toBe(1);
    expect(view.draft).toBe("");
    expect(view.tagInput).toBe("");
  });

  it("blocks navigation when defer persistence fails", () => {
    expect(deferResultAllowsNavigation({ ok: true })).toBe(true);
    expect(deferResultAllowsNavigation({ ok: false })).toBe(false);
  });
});

describe("Academic setup navigation and defer wiring", () => {
  it("keeps Academic setup in the existing sidebar location", () => {
    expect(navItems[0]).toMatchObject({ href: "/home", label: "Home" });
    expect(navItems[1]).toMatchObject({
      href: "/onboarding",
      label: "Academic setup",
    });
    expect(navItems.some((item) => item.href === "/onboarding")).toBe(true);
  });

  it("does not dismiss or complete from Set up later, and saves resume instead of answers", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/components/onboarding/onboarding-flow.tsx"),
      "utf8",
    );
    expect(src).toContain("Set up later");
    expect(src).toContain("deferSetup");
    expect(src).toContain("saveOnboardingResumeAction");
    expect(src).toContain("deferResultAllowsNavigation");
    expect(src).toContain("onboardingResumeDraftPayload");
    expect(src).toContain("initialOnboardingViewState");
    expect(src).not.toMatch(/dismissOnboardingAction/);
    expect(src).not.toMatch(/setDoneView\("dismissed"\)/);
    expect(src).toContain("completeOnboardingAction");
    expect(src).toMatch(/function finish\(\)/);
    const deferBlock = src.slice(src.indexOf("function deferSetup()"));
    expect(deferBlock).not.toContain("completeOnboardingAction");
    expect(deferBlock).not.toContain("submitOnboardingAnswerAction");
    expect(deferBlock).toContain("router.push(\"/home\")");
    expect(deferBlock.indexOf("deferResultAllowsNavigation")).toBeLessThan(
      deferBlock.indexOf("router.push"),
    );
  });
});
