import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isOnboardingDraftReady,
  persistableDeferDraft,
} from "@/lib/onboarding/defer-draft";
import { navItems } from "@/components/layout/nav-config";

describe("Set up later draft persistence", () => {
  it("does not persist empty drafts", () => {
    expect(persistableDeferDraft({ answerType: "enum" }, "")).toBeNull();
    expect(persistableDeferDraft({ answerType: "string" }, "   ")).toBeNull();
    expect(persistableDeferDraft({ answerType: "string_array" }, [])).toBeNull();
    expect(persistableDeferDraft({ answerType: "boolean" }, null)).toBeNull();
  });

  it("persists valid current edits including a pending string_array chip", () => {
    expect(persistableDeferDraft({ answerType: "enum" }, "undergrad")).toBe(
      "undergrad",
    );
    expect(
      persistableDeferDraft({ answerType: "string" }, "Pass organic"),
    ).toBe("Pass organic");
    expect(persistableDeferDraft({ answerType: "boolean" }, true)).toBe(true);
    expect(
      persistableDeferDraft(
        { answerType: "string_array", maxItems: 12, itemMaxLength: 80 },
        ["Math"],
        "Chemistry",
      ),
    ).toEqual(["Math", "Chemistry"]);
    expect(isOnboardingDraftReady({ answerType: "enum" }, "hs")).toBe(true);
  });
});

describe("Academic setup navigation and defer wiring", () => {
  it("keeps Academic setup in the app nav", () => {
    expect(navItems.some((item) => item.href === "/onboarding")).toBe(true);
    expect(
      navItems.some(
        (item) => item.href === "/onboarding" && item.label === "Academic setup",
      ),
    ).toBe(true);
  });

  it("does not dismiss the onboarding session from Set up later", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/components/onboarding/onboarding-flow.tsx"),
      "utf8",
    );
    expect(src).toContain("Set up later");
    expect(src).toContain("deferSetup");
    expect(src).toContain("persistableDeferDraft");
    expect(src).toContain("submitOnboardingAnswerAction");
    expect(src).not.toMatch(/dismissOnboardingAction/);
    expect(src).not.toMatch(/setDoneView\("dismissed"\)/);
  });

  it("opens the quiz at the server-provided first unanswered index", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/components/onboarding/onboarding-flow.tsx"),
      "utf8",
    );
    expect(src).toContain("initial.progress.firstUnansweredIndex");
  });
});
