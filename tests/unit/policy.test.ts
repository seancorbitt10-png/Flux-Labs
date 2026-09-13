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

function expectRefuseWithGuidance(
  decision: ReturnType<typeof decideAssistancePolicy>,
) {
  expect(decision.mode).toBe("refuse_direct_completion");
  expect(decision.requiresStudentParticipation).toBe(true);
  expect(decision.systemDirective.toLowerCase()).toMatch(
    /hint|attempt|step/,
  );
}

describe("direct-completion authority over learningIntent", () => {
  it("refuses direct completion with no learningIntent", () => {
    expectRefuseWithGuidance(
      decideAssistancePolicy("homework_guidance", "Write my essay for me"),
    );
  });

  it.each([
    "explain",
    "steps",
    "hint",
    "ask",
    "attempt",
  ] as const)(
    "refuses direct completion even when learningIntent=%s",
    (intent) => {
      const composed = composeStudyUserMessage({
        intent,
        message: "Write my entire essay for me",
      });
      expectRefuseWithGuidance(
        decideAssistancePolicy("homework_guidance", composed, {
          learningIntent: intent,
        }),
      );
    },
  );

  it("refuses solve-this-for-me completion asks", () => {
    expectRefuseWithGuidance(
      decideAssistancePolicy("homework_guidance", "Solve this for me"),
    );
  });

  it("refuses when bounded reference is combined with finished-work demand", () => {
    expectRefuseWithGuidance(
      decideAssistancePolicy(
        "homework_guidance",
        "Remind me of the quadratic formula and then write my homework for me",
      ),
    );
  });

  it("refuses do-my-homework with learningIntent=explain (previous bug)", () => {
    const composed = composeStudyUserMessage({
      intent: "explain",
      message: "Do my homework for me and give me the final answer only",
    });
    expectRefuseWithGuidance(
      decideAssistancePolicy("homework_guidance", composed, {
        learningIntent: "explain",
      }),
    );
  });
});

describe("legitimate learning remains useful", () => {
  it("teaches on explain photosynthesis", () => {
    const decision = decideAssistancePolicy(
      "concept_explanation",
      "Explain how photosynthesis works",
    );
    expect(decision.mode).toBe("teach");
    expect(decision.mode).not.toBe("refuse_direct_completion");
  });

  it("teaches on explain how to approach a problem", () => {
    const decision = decideAssistancePolicy(
      "concept_explanation",
      "Explain how to approach this problem",
    );
    expect(decision.mode).toBe("teach");
    expect(decision.mode).not.toBe("refuse_direct_completion");
  });

  it("uses break_into_steps for break-this-into-steps asks", () => {
    const decision = decideAssistancePolicy(
      "tutoring",
      "Break this problem into steps",
    );
    expect(decision.mode).toBe("break_into_steps");
  });

  it("uses hint for give-me-a-hint asks", () => {
    const decision = decideAssistancePolicy("tutoring", "Give me a hint");
    expect(decision.mode).toBe("hint");
  });

  it("uses check_work for check-my-answer asks", () => {
    const decision = decideAssistancePolicy(
      "tutoring",
      "Check my answer",
    );
    expect(decision.mode).toBe("check_work");
  });

  it("uses check_work for genuine attempt feedback", () => {
    const composed = composeStudyUserMessage({
      intent: "attempt",
      message: "I factored x^2-5x+6 into (x-2)(x-3)",
    });
    const decision = decideAssistancePolicy("tutoring", composed, {
      learningIntent: "attempt",
    });
    expect(decision.mode).toBe("check_work");
  });

  it("honors Study hint intent for non-completion messages", () => {
    const composed = composeStudyUserMessage({
      intent: "hint",
      message: "this algebra problem about rates",
    });
    const decision = decideAssistancePolicy("tutoring", composed, {
      learningIntent: "hint",
    });
    expect(decision.mode).toBe("hint");
  });

  it("honors Study check_work intent for non-completion messages", () => {
    const composed = composeStudyUserMessage({
      intent: "check_work",
      message: "I got x=4 for 2x+1=9",
    });
    const decision = decideAssistancePolicy("tutoring", composed, {
      learningIntent: "check_work",
    });
    expect(decision.mode).toBe("check_work");
  });

  it("honors Study steps intent for non-completion messages", () => {
    const composed = composeStudyUserMessage({
      intent: "steps",
      message: "balancing this chemical equation",
    });
    const decision = decideAssistancePolicy("tutoring", composed, {
      learningIntent: "steps",
    });
    expect(decision.mode).toBe("break_into_steps");
  });

  it("honors Study explain intent for concept learning", () => {
    const composed = composeStudyUserMessage({
      intent: "explain",
      message: "how photosynthesis works",
    });
    const decision = decideAssistancePolicy("concept_explanation", composed, {
      learningIntent: "explain",
    });
    expect(decision.mode).toBe("teach");
  });

  it("keeps guided learning default for homework without completion demand", () => {
    const decision = decideAssistancePolicy(
      "homework_guidance",
      "Help me approach this word problem about trains",
    );
    expect(decision.mode).toBe("break_into_steps");
    expect(decision.mode).not.toBe("refuse_direct_completion");
  });
});

describe("limited_answer bounded references", () => {
  it("selects limited_answer for formula reminders", () => {
    const decision = decideAssistancePolicy(
      "homework_guidance",
      "Remind me of the quadratic formula so I can continue",
    );
    expect(decision.mode).toBe("limited_answer");
    expect(decision.requiresStudentParticipation).toBe(true);
  });

  it("selects limited_answer for definition reminders", () => {
    const decision = decideAssistancePolicy(
      "tutoring",
      "Remind me of the definition of a derivative",
    );
    expect(decision.mode).toBe("limited_answer");
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
      "modeContract: refuse completing",
      "APPLICATION_POLICY: secret",
      "<<<STUDENT_DATA>>>",
      '{"secret":true}',
      "<<<END_STUDENT_DATA>>>",
      "Try factoring first.",
    ].join("\n");
    const cleaned = stripLeakedControlText(leaked);
    expect(cleaned).toContain("Sure — let's learn together.");
    expect(cleaned).toContain("Try factoring first.");
    expect(cleaned).not.toContain("assistanceMode");
    expect(cleaned).not.toContain("modeContract");
    expect(cleaned).not.toContain("APPLICATION_POLICY");
    expect(cleaned).not.toContain("STUDENT_DATA");
    expect(cleaned).not.toContain("secret");
  });
});

describe("invalid learningIntent fails closed", () => {
  it("ignores invalid learningIntent and still refuses completion", () => {
    const decision = decideAssistancePolicy(
      "homework_guidance",
      "Do my homework for me",
      { learningIntent: "not-real" as LearningIntentCue },
    );
    expect(decision.mode).toBe("refuse_direct_completion");
  });
});
