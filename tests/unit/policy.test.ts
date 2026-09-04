import { describe, expect, it } from "vitest";
import { decideAssistancePolicy } from "@/lib/ai/policy";

describe("academic assistance policy", () => {
  it("guides homework requests instead of dumping answers", () => {
    const decision = decideAssistancePolicy(
      "homework_guidance",
      "Solve this problem for me",
    );
    expect(decision.requiresStudentParticipation).toBe(true);
    expect(["break_into_steps", "hint", "ask_question", "teach"]).toContain(
      decision.mode,
    );
  });

  it("supports check-work mode", () => {
    const decision = decideAssistancePolicy(
      "tutoring",
      "Can you check my answer?",
    );
    expect(decision.mode).toBe("check_work");
  });

  it("supports hint mode", () => {
    const decision = decideAssistancePolicy("tutoring", "I need a hint");
    expect(decision.mode).toBe("hint");
  });

  it("teaches on concept explanation", () => {
    const decision = decideAssistancePolicy(
      "concept_explanation",
      "Explain photosynthesis",
    );
    expect(decision.mode).toBe("teach");
    expect(decision.requiresStudentParticipation).toBe(true);
  });
});
