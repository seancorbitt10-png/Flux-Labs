import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ValidationError } from "@/lib/errors";
import { runAIOrchestration } from "@/lib/ai/orchestration";
import { setAIProvider, StubAIProvider } from "@/lib/ai/provider";
import type { AICompletionRequest, AIProvider } from "@/lib/ai/types";
import {
  assertNoClientStudyAuthority,
  composeStudyUserMessage,
  getStudyBootstrap,
  MAX_STUDY_MESSAGE,
  parseStudyIntent,
} from "@/lib/study";
import { confirmAIProposal, rejectAIProposal } from "@/lib/ai/proposals";
import {
  createSubject,
  createTopic,
  createSystemConcept,
} from "@/lib/knowledge/catalog";
import { upsertExplicitConceptState } from "@/lib/student/concept-state";
import { listStudentGoals } from "@/lib/student/goals";

const prisma = new PrismaClient();
const SYSTEM = { type: "system" as const };

async function cleanup() {
  const where = { email: { endsWith: "@fluxlabs.test" } };
  const users = await prisma.user.findMany({ where, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await prisma.aIProposal.deleteMany({ where: { userId: { in: ids } } });
    await prisma.learningEvidence.deleteMany({ where: { userId: { in: ids } } });
    await prisma.studentConceptState.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.studentMisconception.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.studentObservation.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.studentAttribute.deleteMany({ where: { userId: { in: ids } } });
    await prisma.studentGoal.deleteMany({ where: { userId: { in: ids } } });
    await prisma.concept.deleteMany({
      where: { createdByUserId: { in: ids }, source: "USER" },
    });
  }
  await prisma.usageRecord.deleteMany({ where: { user: where } });
  await prisma.aIInteraction.deleteMany({ where: { user: where } });
  await prisma.auditLog.deleteMany({ where: { user: where } });
  await prisma.trial.deleteMany({ where: { user: where } });
  await prisma.entitlement.deleteMany({ where: { user: where } });
  await prisma.studentProfile.deleteMany({ where: { user: where } });
  await prisma.user.deleteMany({ where });

  await prisma.concept.deleteMany({
    where: { topic: { subject: { slug: { startsWith: "test-study-" } } } },
  });
  await prisma.topic.deleteMany({
    where: { subject: { slug: { startsWith: "test-study-" } } },
  });
  await prisma.subject.deleteMany({
    where: { slug: { startsWith: "test-study-" } },
  });
}

async function createEntitledUser(suffix: string) {
  const endsAt = new Date(Date.now() + 7 * 86_400_000);
  return prisma.user.create({
    data: {
      email: `study.${suffix}@fluxlabs.test`,
      name: "Study Student",
      passwordHash: "x",
      studentProfile: {
        create: {
          displayName: "Study Student",
          academicLevel: "undergrad",
        },
      },
      entitlements: {
        create: {
          plan: "FREE_TRIAL",
          status: "ACTIVE",
          endsAt,
        },
      },
      trials: {
        create: {
          endsAt,
          aiSessionsUsed: 0,
          documentAnalysesUsed: 0,
          advancedTutoringUsed: 0,
          estimatedCostMicros: 0,
        },
      },
    },
  });
}

describe("Study Experience", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanup();
    setAIProvider(new StubAIProvider());
  });

  describe("intents and authority", () => {
    it("maps learning intents into policy-recognizable messages", () => {
      expect(parseStudyIntent("hint")).toBe("hint");
      expect(() => parseStudyIntent("mastery")).toThrow(ValidationError);
      expect(
        composeStudyUserMessage({
          intent: "hint",
          message: "on integrals",
          focusLabel: "Calculus",
        }),
      ).toContain("I need a hint:");
      expect(
        composeStudyUserMessage({
          intent: "attempt",
          message: "my solution",
        }),
      ).toContain("Here is my attempt");

      // Max raw body + heaviest framing must stay within orchestration 4k cap.
      const focusLabel = "F".repeat(120);
      const body = "b".repeat(MAX_STUDY_MESSAGE);
      const composed = composeStudyUserMessage({
        intent: "attempt",
        message: body,
        focusLabel,
      });
      expect(composed.length).toBeLessThanOrEqual(4000);
      expect(
        composeStudyUserMessage({
          intent: "check_work",
          message: "I got 42",
        }),
      ).toMatch(/check my work/i);
    });

    it("rejects client authority fields", () => {
      expect(() =>
        assertNoClientStudyAuthority({
          message: "hi",
          provenance: "EXPLICIT",
        }),
      ).toThrow(/provenance/);
      expect(() =>
        assertNoClientStudyAuthority({
          message: "hi",
          userId: "attacker",
        }),
      ).toThrow(/userId/);
      expect(() =>
        assertNoClientStudyAuthority({
          message: "hi",
          assistanceMode: "explain",
        }),
      ).toThrow(/assistanceMode/);
    });
  });

  describe("orchestration integration", () => {
    it("sends a valid study turn through orchestration without mutating Student Model", async () => {
      const user = await createEntitledUser(`ok-${Date.now()}`);
      const beforeGoals = await prisma.studentGoal.count({
        where: { userId: user.id },
      });
      const beforeAttrs = await prisma.studentAttribute.count({
        where: { userId: user.id },
      });

      const composed = composeStudyUserMessage({
        intent: "ask",
        message: "Can you explain stoichiometry?",
      });

      const result = await runAIOrchestration({
        actorUserId: user.id,
        userMessage: composed,
      });

      expect(result.reply.length).toBeGreaterThan(0);
      expect(result.assistanceMode).toBeTruthy();
      expect(result.proposals).toEqual([]);
      expect(await prisma.studentGoal.count({ where: { userId: user.id } })).toBe(
        beforeGoals,
      );
      expect(
        await prisma.studentAttribute.count({ where: { userId: user.id } }),
      ).toBe(beforeAttrs);
    });

    it("rejects empty and oversized messages at orchestration", async () => {
      const user = await createEntitledUser(`val-${Date.now()}`);
      await expect(
        runAIOrchestration({
          actorUserId: user.id,
          userMessage: "   ",
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        runAIOrchestration({
          actorUserId: user.id,
          userMessage: "x".repeat(4001),
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects caller-supplied userId and accepts bounded prior turns", async () => {
      const user = await createEntitledUser(`auth-${Date.now()}`);

      await expect(
        runAIOrchestration({
          actorUserId: user.id,
          userId: user.id,
          userMessage: "Explain derivatives",
        } as never),
      ).rejects.toBeInstanceOf(ValidationError);

      let sawHistory = false;
      setAIProvider({
        id: "hist",
        async complete(req: AICompletionRequest) {
          sawHistory = req.messages.some(
            (m) => m.role === "user" && m.content.includes("previous question"),
          );
          return {
            content: "Next step: try differentiating term by term.",
            modelKey: req.modelKey,
            provider: "hist",
            estimatedCostMicros: 1,
            latencyMs: 1,
          };
        },
      } satisfies AIProvider);

      const result = await runAIOrchestration({
        actorUserId: user.id,
        userMessage: "What should I try next?",
        priorTurns: [
          { role: "user", content: "previous question about x^2" },
          { role: "assistant", content: "Start from the power rule." },
        ],
      });
      expect(result.reply).toContain("differentiating");
      expect(sawHistory).toBe(true);

      await expect(
        runAIOrchestration({
          actorUserId: user.id,
          userMessage: "Hello",
          priorTurns: Array.from({ length: 9 }, () => ({
            role: "user" as const,
            content: "turn",
          })),
        }),
      ).rejects.toThrow(/prior conversation turns/);
    });

    it("rejects invalid focus concept IDs and does not invent concepts", async () => {
      const user = await createEntitledUser(`focus-${Date.now()}`);
      const before = await prisma.concept.count();
      await expect(
        runAIOrchestration({
          actorUserId: user.id,
          userMessage: "Help with this topic",
          conceptIds: ["missing-concept-id"],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(await prisma.concept.count()).toBe(before);
    });

    it("surfaces provider failures without Student Model writes", async () => {
      const user = await createEntitledUser(`fail-${Date.now()}`);
      setAIProvider({
        id: "boom",
        async complete() {
          throw new Error("provider down");
        },
      } satisfies AIProvider);

      await expect(
        runAIOrchestration({
          actorUserId: user.id,
          userMessage: "Explain photosynthesis",
        }),
      ).rejects.toThrow(/provider down/);

      expect(
        await prisma.studentAttribute.count({ where: { userId: user.id } }),
      ).toBe(0);
    });
  });

  describe("bootstrap and proposals", () => {
    it("returns server-validated focus options from concept states only", async () => {
      const user = await createEntitledUser(`boot-${Date.now()}`);
      const subject = await createSubject({
        actor: SYSTEM,
        slug: `test-study-sub-${Date.now()}`,
        name: "Study Sub",
      });
      const topic = await createTopic({
        actor: SYSTEM,
        subjectId: subject.id,
        slug: `test-study-top-${Date.now()}`,
        name: "Study Top",
      });
      const concept = await createSystemConcept({
        actor: SYSTEM,
        topicId: topic.id,
        slug: `test-study-con-${Date.now()}`,
        name: "Linked Concept",
      });

      await upsertExplicitConceptState({
        actorUserId: user.id,
        userId: user.id,
        conceptId: concept.id,
        mastery: "DEVELOPING",
        source: "settings",
      });

      const boot = await getStudyBootstrap({
        actorUserId: user.id,
        userId: user.id,
      });
      expect(boot.focusOptions.some((o) => o.conceptId === concept.id)).toBe(
        true,
      );
      expect(boot.guidance.learningFirst).toBe(true);
    });

    it("proposal confirm uses existing boundary; Study turn does not auto-write goals", async () => {
      const user = await createEntitledUser(`prop-${Date.now()}`);
      const fence = [
        "Here is a coaching reply.",
        "<<<AI_PROPOSALS_V1>>>",
        JSON.stringify([
          {
            type: "GOAL_UPDATE",
            target: { scope: "student_goals" },
            proposedValue: { title: "Practice limits" },
          },
        ]),
        "<<<END_AI_PROPOSALS_V1>>>",
      ].join("\n");

      setAIProvider({
        id: "prop",
        async complete(req: AICompletionRequest) {
          return {
            content: fence,
            modelKey: req.modelKey,
            provider: "prop",
            estimatedCostMicros: 1,
            latencyMs: 1,
          };
        },
      } satisfies AIProvider);

      const result = await runAIOrchestration({
        actorUserId: user.id,
        userMessage: composeStudyUserMessage({
          intent: "ask",
          message: "Suggest a study goal for me",
        }),
      });

      expect(result.proposals).toHaveLength(1);
      expect(await listStudentGoals({ actorUserId: user.id, userId: user.id })).toHaveLength(
        0,
      );

      await rejectAIProposal({
        actorUserId: user.id,
        decision: { proposalId: result.proposals[0]!.id },
      });
      expect(await listStudentGoals({ actorUserId: user.id, userId: user.id })).toHaveLength(
        0,
      );

      // New turn with another proposal then confirm
      const result2 = await runAIOrchestration({
        actorUserId: user.id,
        userMessage: "Suggest another goal",
      });
      expect(result2.proposals.length).toBeGreaterThanOrEqual(1);
      await confirmAIProposal({
        actorUserId: user.id,
        decision: { proposalId: result2.proposals[0]!.id },
      });
      expect(
        (await listStudentGoals({ actorUserId: user.id, userId: user.id })).length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  describe("entitlements", () => {
    it("rejects study orchestration without active entitlement", async () => {
      const user = await prisma.user.create({
        data: {
          email: `study.noent.${Date.now()}@fluxlabs.test`,
          name: "No Ent",
          passwordHash: "x",
          studentProfile: { create: { displayName: "No Ent" } },
        },
      });

      await expect(
        runAIOrchestration({
          actorUserId: user.id,
          userMessage: "Help me study",
        }),
      ).rejects.toThrow();
    });
  });
});
