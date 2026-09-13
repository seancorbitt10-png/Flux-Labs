import { describe, expect, it } from "vitest";
import { decideAssistancePolicy } from "@/lib/ai/policy";
import type { LearningIntentCue } from "@/lib/ai/types";
import { composeStudyUserMessage } from "@/lib/study/intents";
import { stripLeakedControlText } from "@/lib/ai/response-validation";
import { buildOrchestrationMessages } from "@/lib/ai/prompt";
import type { AssembledLearningContext } from "@/lib/ai/context-types";

function emptyAssembled(): AssembledLearningContext {
  return {
    version: "test",
    focus: { conceptIds: [], classId: null, taskId: null },
    currentState: {
      profile: null,
      attributes: [],
      goals: [],
      conceptStates: [],
      misconceptions: [],
    },
    historicalEvidence: { observations: [], learningEvidence: [] },
    knowledge: { concepts: [] },
    academicWorkspace: {
      classes: [],
      tasks: [],
      calendarBlocks: [],
    },
    provenanceNotes: ["test note"],
    budgets: {
      maxAttributes: 0,
      maxGoals: 0,
      maxConceptStates: 0,
      maxMisconceptions: 0,
      maxObservations: 0,
      maxLearningEvidence: 0,
      maxCatalogConcepts: 0,
      maxClasses: 0,
      maxTasks: 0,
      maxCalendarBlocks: 0,
    },
  } as unknown as AssembledLearningContext;
}

describe("academic assistance policy — learning-first hardening", () => {
  it("keeps normal explanation requests useful (teach), not refused", () => {
    const decision = decideAssistancePolicy(
      "concept_explanation",
      "Explain photosynthesis",
    );
    expect(decision.mode).toBe("teach");
    expect(decision.requiresStudentParticipation).toBe(true);
    expect(decision.mode).not.toBe("refuse_direct_completion");
  });

  it("keeps hint requests hint-oriented", () => {
    const decision = decideAssistancePolicy("tutoring", "I need a hint");
    expect(decision.mode).toBe("hint");
  });

  it("keeps check-work requests check-work oriented", () => {
    const decision = decideAssistancePolicy(
      "tutoring",
      "Can you check my answer?",
    );
    expect(decision.mode).toBe("check_work");
  });

  it("does not refuse legitimate solve/explain concept learning requests", () => {
    const decision = decideAssistancePolicy(
      "concept_explanation",
      "Can you explain how to approach solving quadratic equations as a concept?",
    );
    expect(decision.mode).toBe("teach");
    expect(decision.mode).not.toBe("refuse_direct_completion");
  });

  it("selects refuse_direct_completion for clear direct-completion asks", () => {
    const decision = decideAssistancePolicy(
      "homework_guidance",
      "Do my homework for me and give me the final answer only",
    );
    expect(decision.mode).toBe("refuse_direct_completion");
    expect(decision.requiresStudentParticipation).toBe(true);
    expect(decision.systemDirective.toLowerCase()).toMatch(/hint|attempt|step/);
  });

  it("selects refuse_direct_completion for solve-this-for-me completion asks", () => {
    const decision = decideAssistancePolicy(
      "homework_guidance",
      "Solve this for me",
    );
    expect(decision.mode).toBe("refuse_direct_completion");
  });

  it("does not let a learning intent bypass into unrestricted completion", () => {
    const composed = composeStudyUserMessage({
      intent: "explain",
      message: "Write my entire essay for me",
    });
    const decision = decideAssistancePolicy("homework_guidance", composed, {
      learningIntent: "explain",
    });
    // Explain posture stays learning-oriented (teach), not a completion dump.
    expect(decision.mode).toBe("teach");
    expect(decision.systemDirective.toLowerCase()).toMatch(
      /do not complete|graded assignment/,
    );
  });

  it("selects limited_answer for bounded reference asks", () => {
    const decision = decideAssistancePolicy(
      "homework_guidance",
      "What's the formula for the quadratic equation so I can keep working?",
    );
    expect(decision.mode).toBe("limited_answer");
    expect(decision.requiresStudentParticipation).toBe(true);
  });

  it("honors Study hint intent framing", () => {
    const composed = composeStudyUserMessage({
      intent: "hint",
      message: "this algebra problem about rates",
    });
    const decision = decideAssistancePolicy("tutoring", composed, {
      learningIntent: "hint",
    });
    expect(decision.mode).toBe("hint");
  });

  it("honors Study check_work intent framing", () => {
    const composed = composeStudyUserMessage({
      intent: "check_work",
      message: "I got x=4 for 2x+1=9",
    });
    const decision = decideAssistancePolicy("tutoring", composed, {
      learningIntent: "check_work",
    });
    expect(decision.mode).toBe("check_work");
  });

  it("honors Study steps intent framing", () => {
    const composed = composeStudyUserMessage({
      intent: "steps",
      message: "balancing this chemical equation",
    });
    const decision = decideAssistancePolicy("tutoring", composed, {
      learningIntent: "steps",
    });
    expect(decision.mode).toBe("break_into_steps");
  });

  it("honors Study attempt intent framing", () => {
    const composed = composeStudyUserMessage({
      intent: "attempt",
      message: "I factored x^2-5x+6 into (x-2)(x-3)",
    });
    const decision = decideAssistancePolicy("tutoring", composed, {
      learningIntent: "attempt",
    });
    expect(decision.mode).toBe("check_work");
  });

  it("keeps guided learning default for homework without completion demand", () => {
    const decision = decideAssistancePolicy(
      "homework_guidance",
      "Help me approach this word problem about trains",
    );
    expect(decision.mode).toBe("break_into_steps");
    expect(decision.mode).not.toBe("refuse_direct_completion");
  });

  it("ignores invalid learningIntent values (fail closed to message signals)", () => {
    const decision = decideAssistancePolicy(
      "homework_guidance",
      "Do my homework for me",
      { learningIntent: "not-real" as LearningIntentCue },
    );
    expect(decision.mode).toBe("refuse_direct_completion");
  });
});

describe("policy → prompt contract", () => {
  it("embeds refuse_direct_completion mode contract for the provider", () => {
    const decision = decideAssistancePolicy(
      "homework_guidance",
      "Write my essay for me",
    );
    expect(decision.mode).toBe("refuse_direct_completion");
    const messages = buildOrchestrationMessages({
      taskType: "homework_guidance",
      assistanceMode: decision.mode,
      systemDirective: decision.systemDirective,
      assembled: emptyAssembled(),
      userMessage: "Write my essay for me",
    });
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toContain("assistanceMode: refuse_direct_completion");
    expect(system).toContain("modeContract:");
    expect(system.toLowerCase()).toMatch(/refuse/);
  });

  it("embeds limited_answer mode contract for the provider", () => {
    const decision = decideAssistancePolicy(
      "tutoring",
      "Remind me of the definition of a derivative",
    );
    expect(decision.mode).toBe("limited_answer");
    const messages = buildOrchestrationMessages({
      taskType: "tutoring",
      assistanceMode: decision.mode,
      systemDirective: decision.systemDirective,
      assembled: emptyAssembled(),
      userMessage: "Remind me of the definition of a derivative",
    });
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toContain("assistanceMode: limited_answer");
    expect(system.toLowerCase()).toMatch(/minimal/);
  });
});

describe("control text must not leak to students", () => {
  it("strips STUDENT_DATA fences and assistanceMode lines from replies", () => {
    const leaked = [
      "Sure — let's learn together.",
      "assistanceMode: refuse_direct_completion",
      "<<<STUDENT_DATA>>>",
      '{"secret":true}',
      "<<<END_STUDENT_DATA>>>",
      "Try factoring first.",
    ].join("\n");
    const cleaned = stripLeakedControlText(leaked);
    expect(cleaned).toContain("Sure — let's learn together.");
    expect(cleaned).toContain("Try factoring first.");
    expect(cleaned).not.toContain("assistanceMode");
    expect(cleaned).not.toContain("STUDENT_DATA");
    expect(cleaned).not.toContain("secret");
  });
});
