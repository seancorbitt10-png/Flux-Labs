import { describe, expect, it } from "vitest";
import { routeAITask } from "@/lib/ai/router";

describe("AI task router", () => {
  it("routes homework language to homework_guidance", () => {
    const route = routeAITask("Can you solve this calculus homework?");
    expect(route.taskType).toBe("homework_guidance");
    expect(route.modelKey).toBe("flux-standard");
  });

  it("routes explanation language to concept_explanation with cheap model", () => {
    const route = routeAITask("What is a derivative?");
    expect(route.taskType).toBe("concept_explanation");
    expect(route.modelKey).toBe("flux-fast");
  });

  it("honors explicit task hints", () => {
    const route = routeAITask("hello", "study_planning");
    expect(route.taskType).toBe("study_planning");
    expect(route.reason).toBe("client_hint");
  });

  it("defaults to general conversation on flux-fast", () => {
    const route = routeAITask("Hi there");
    expect(route.taskType).toBe("general_conversation");
    expect(route.modelKey).toBe("flux-fast");
  });
});
