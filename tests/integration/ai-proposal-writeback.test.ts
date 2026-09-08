import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { runAIOrchestration } from "@/lib/ai/orchestration";
import {
  AI_PROPOSALS_FENCE_END,
  AI_PROPOSALS_FENCE_START,
  confirmAIProposal,
  ingestAIProposals,
  ingestSingleAIProposal,
  parseAIProposalContent,
  rejectAIProposal,
} from "@/lib/ai/proposals";
import { setAIProvider, StubAIProvider } from "@/lib/ai/provider";
import type { AICompletionRequest, AIProvider } from "@/lib/ai/types";
import { setStudentAttribute, getActiveAttribute } from "@/lib/student/attributes";
import { listStudentGoals } from "@/lib/student/goals";
import { getConceptState } from "@/lib/student/concept-state";
import { listMisconceptions } from "@/lib/student/misconceptions";
import {
  createSubject,
  createTopic,
  createSystemConcept,
  createUserConcept,
} from "@/lib/knowledge/catalog";

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

  await prisma.conceptRelation.deleteMany({
    where: {
      OR: [
        {
          fromConcept: {
            topic: { subject: { slug: { startsWith: "test-prop-" } } },
          },
        },
        {
          toConcept: {
            topic: { subject: { slug: { startsWith: "test-prop-" } } },
          },
        },
      ],
    },
  });
  await prisma.concept.deleteMany({
    where: { topic: { subject: { slug: { startsWith: "test-prop-" } } } },
  });
  await prisma.topic.deleteMany({
    where: { subject: { slug: { startsWith: "test-prop-" } } },
  });
  await prisma.subject.deleteMany({
    where: { slug: { startsWith: "test-prop-" } },
  });
}

async function createEntitledUser(suffix: string) {
  const endsAt = new Date(Date.now() + 7 * 86_400_000);
  return prisma.user.create({
    data: {
      email: `prop.${suffix}@fluxlabs.test`,
      name: "Proposal Student",
      passwordHash: "x",
      studentProfile: {
        create: {
          displayName: "Proposal Student",
          academicLevel: "undergrad",
          preferredAssistanceStyle: "hints_first",
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

async function seedConcept(slugSuffix: string) {
  const subject = await createSubject({
    actor: SYSTEM,
    slug: `test-prop-sub-${slugSuffix}`,
    name: "Prop Sub",
  });
  const topic = await createTopic({
    actor: SYSTEM,
    subjectId: subject.id,
    slug: `test-prop-top-${slugSuffix}`,
    name: "Prop Top",
  });
  const concept = await createSystemConcept({
    actor: SYSTEM,
    topicId: topic.id,
    slug: `test-prop-con-${slugSuffix}`,
    name: "Prop Concept",
  });
  return { subject, topic, concept };
}

describe("AI proposal / write-back pipeline", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanup();
    setAIProvider(new StubAIProvider());
  });

  describe("proposal validation", () => {
    it("accepts a valid ATTRIBUTE_UPDATE proposal", () => {
      const parsed = parseAIProposalContent({
        type: "ATTRIBUTE_UPDATE",
        target: { key: "pref.explanation_length" },
        proposedValue: "concise",
        rationale: "Student asked for shorter explanations",
      });
      expect(parsed.type).toBe("ATTRIBUTE_UPDATE");
    });

    it("rejects malformed proposals", () => {
      expect(() => parseAIProposalContent(null)).toThrow(ValidationError);
      expect(() => parseAIProposalContent("nope")).toThrow(ValidationError);
      expect(() =>
        parseAIProposalContent({
          type: "ATTRIBUTE_UPDATE",
          target: {},
          proposedValue: "concise",
        }),
      ).toThrow(ValidationError);
    });

    it("rejects unknown proposal types", () => {
      expect(() =>
        parseAIProposalContent({
          type: "MAGIC_REWRITE",
          target: { key: "x" },
          proposedValue: 1,
        }),
      ).toThrow(/Unknown proposal type/);
    });

    it("rejects unknown authority fields from AI", () => {
      expect(() =>
        parseAIProposalContent({
          type: "ATTRIBUTE_UPDATE",
          target: { key: "pref.explanation_length" },
          proposedValue: "concise",
          provenance: "EXPLICIT",
        }),
      ).toThrow(/authority/);

      expect(() =>
        parseAIProposalContent({
          type: "ATTRIBUTE_UPDATE",
          target: { key: "pref.explanation_length" },
          proposedValue: "concise",
          confidence: 1,
        }),
      ).toThrow(/authority/);

      expect(() =>
        parseAIProposalContent({
          type: "GOAL_UPDATE",
          target: { scope: "student_goals" },
          proposedValue: { title: "Pass chemistry" },
          userId: "attacker",
          authorized: true,
        }),
      ).toThrow(/authority/);
    });

    it("rejects oversized proposals", async () => {
      expect(() =>
        parseAIProposalContent({
          type: "GOAL_UPDATE",
          target: { scope: "student_goals" },
          proposedValue: { title: "x".repeat(201) },
        }),
      ).toThrow(/Oversized|Malformed/);

      await expect(
        ingestAIProposals({
          actorUserId: "x",
          raw: Array.from({ length: 6 }, () => ({
            type: "GOAL_UPDATE",
            target: { scope: "student_goals" },
            proposedValue: { title: "Goal" },
          })),
        }),
      ).rejects.toThrow(/Oversized/);
    });

    it("rejects unknown fields", () => {
      expect(() =>
        parseAIProposalContent({
          type: "GOAL_UPDATE",
          target: { scope: "student_goals" },
          proposedValue: { title: "Ok", extra: true },
        }),
      ).toThrow(ValidationError);
    });

    it("rejects arbitrary attribute keys", () => {
      expect(() =>
        parseAIProposalContent({
          type: "ATTRIBUTE_UPDATE",
          target: { key: "invented.ai_label" },
          proposedValue: "visual_learner",
        }),
      ).toThrow(ValidationError);
    });
  });

  describe("authority boundaries", () => {
    it("AI cannot set provenance or confidence; server assigns on confirm", async () => {
      const user = await createEntitledUser(`auth-${Date.now()}`);

      const pending = await ingestSingleAIProposal({
        actorUserId: user.id,
        raw: {
          type: "ATTRIBUTE_UPDATE",
          target: { key: "pref.explanation_length" },
          proposedValue: "detailed",
        },
      });

      expect(pending.status).toBe("PENDING");
      const row = await prisma.aIProposal.findUniqueOrThrow({
        where: { id: pending.id },
      });
      expect(JSON.stringify(row)).not.toMatch(/"provenance"/);
      expect(JSON.stringify(row.targetJson)).not.toContain("confidence");

      const confirmed = await confirmAIProposal({
        actorUserId: user.id,
        decision: { proposalId: pending.id },
      });
      expect(confirmed.status).toBe("CONFIRMED");

      const attr = await getActiveAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "pref.explanation_length",
      });
      expect(attr?.provenance).toBe("EXPLICIT");
      expect(attr?.confidence).toBe(0.9);
      expect(attr?.source).toBe("settings");
      expect(attr?.valueJson).toBe("detailed");
    });

    it("client cannot set provenance, confidence, userId, or ownership on confirm", async () => {
      const user = await createEntitledUser(`client-${Date.now()}`);
      const pending = await ingestSingleAIProposal({
        actorUserId: user.id,
        raw: {
          type: "GOAL_UPDATE",
          target: { scope: "student_goals" },
          proposedValue: { title: "Finish problem set" },
        },
      });

      await expect(
        confirmAIProposal({
          actorUserId: user.id,
          decision: {
            proposalId: pending.id,
            provenance: "EXPLICIT",
          },
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        confirmAIProposal({
          actorUserId: user.id,
          decision: {
            proposalId: pending.id,
            confidence: 1,
          },
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        confirmAIProposal({
          actorUserId: user.id,
          decision: {
            proposalId: pending.id,
            userId: "other-user",
          },
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        confirmAIProposal({
          actorUserId: user.id,
          decision: {
            proposalId: pending.id,
            ownership: "hijack",
          },
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect(
        await prisma.studentGoal.count({ where: { userId: user.id } }),
      ).toBe(0);
    });
  });

  describe("ownership", () => {
    it("user A cannot confirm user B proposal; nonexistent rejected; no replay", async () => {
      const a = await createEntitledUser(`own-a-${Date.now()}`);
      const b = await createEntitledUser(`own-b-${Date.now()}`);

      const pending = await ingestSingleAIProposal({
        actorUserId: a.id,
        raw: {
          type: "GOAL_UPDATE",
          target: { scope: "student_goals" },
          proposedValue: { title: "A's goal" },
        },
      });

      await expect(
        confirmAIProposal({
          actorUserId: b.id,
          decision: { proposalId: pending.id },
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await expect(
        confirmAIProposal({
          actorUserId: a.id,
          decision: { proposalId: "missing-proposal-id" },
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      await confirmAIProposal({
        actorUserId: a.id,
        decision: { proposalId: pending.id },
      });

      await expect(
        confirmAIProposal({
          actorUserId: a.id,
          decision: { proposalId: pending.id },
        }),
      ).rejects.toThrow(/already confirmed/);

      const goals = await listStudentGoals({
        actorUserId: a.id,
        userId: a.id,
      });
      expect(goals).toHaveLength(1);
      expect(goals[0]?.title).toBe("A's goal");
      expect(goals[0]?.provenance).toBe("EXPLICIT");
      expect(goals[0]?.source).toBe("settings");
    });
  });

  describe("provenance protection", () => {
    it("AI proposal cannot become EXPLICIT without confirmation; EXPLICIT data protected from weaker path", async () => {
      const user = await createEntitledUser(`prov-${Date.now()}`);

      await setStudentAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "interest.primary",
        value: "Chemistry",
        writer: "settings",
      });

      // Ingest alone must not mutate.
      const pending = await ingestSingleAIProposal({
        actorUserId: user.id,
        raw: {
          type: "ATTRIBUTE_UPDATE",
          target: { key: "interest.primary" },
          proposedValue: "AI Guess Subject",
        },
      });
      expect(pending.status).toBe("PENDING");

      let attr = await getActiveAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "interest.primary",
      });
      expect(attr?.valueJson).toBe("Chemistry");
      expect(attr?.provenance).toBe("EXPLICIT");

      // Confirmation is student-authoritative settings write (EXPLICIT by server).
      await confirmAIProposal({
        actorUserId: user.id,
        decision: { proposalId: pending.id },
      });

      attr = await getActiveAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "interest.primary",
      });
      expect(attr?.valueJson).toBe("AI Guess Subject");
      expect(attr?.provenance).toBe("EXPLICIT");
      expect(attr?.source).toBe("settings");
    });
  });

  describe("concept safety", () => {
    it("rejects invalid, cross-user, and unresolved concept references; cannot create concepts", async () => {
      const a = await createEntitledUser(`con-a-${Date.now()}`);
      const b = await createEntitledUser(`con-b-${Date.now()}`);
      const { concept } = await seedConcept(`${Date.now()}`);

      await expect(
        ingestSingleAIProposal({
          actorUserId: a.id,
          raw: {
            type: "CONCEPT_STATE_UPDATE",
            target: { conceptId: "does-not-exist" },
            proposedValue: { mastery: "DEVELOPING" },
          },
        }),
      ).rejects.toThrow(/Concept not found/);

      const foreign = await createUserConcept({
        actor: { type: "user", userId: b.id },
        topicId: concept.topicId,
        slug: `user-con-${Date.now()}`,
        name: "Foreign Concept",
      });

      await expect(
        ingestSingleAIProposal({
          actorUserId: a.id,
          raw: {
            type: "CONCEPT_STATE_UPDATE",
            target: { conceptId: foreign.id },
            proposedValue: { mastery: "DEVELOPING" },
          },
        }),
      ).rejects.toThrow(/Concept not found/);

      // No concept resolver: missing conceptId is malformed / rejected.
      expect(() =>
        parseAIProposalContent({
          type: "CONCEPT_STATE_UPDATE",
          target: {},
          proposedValue: { mastery: "DEVELOPING" },
        }),
      ).toThrow(ValidationError);

      const beforeConcepts = await prisma.concept.count();
      await expect(
        ingestSingleAIProposal({
          actorUserId: a.id,
          raw: {
            type: "CONCEPT_STATE_UPDATE",
            target: { conceptId: "brand-new-invented-id" },
            proposedValue: { mastery: "INTRODUCED" },
          },
        }),
      ).rejects.toThrow(ValidationError);
      expect(await prisma.concept.count()).toBe(beforeConcepts);

      // Valid concept reference can become PENDING then confirm.
      const pending = await ingestSingleAIProposal({
        actorUserId: a.id,
        raw: {
          type: "CONCEPT_STATE_UPDATE",
          target: { conceptId: concept.id },
          proposedValue: { mastery: "DEVELOPING" },
        },
      });
      await confirmAIProposal({
        actorUserId: a.id,
        decision: { proposalId: pending.id },
      });
      const state = await getConceptState({
        actorUserId: a.id,
        userId: a.id,
        conceptId: concept.id,
      });
      expect(state?.mastery).toBe("DEVELOPING");
      expect(state?.provenance).toBe("EXPLICIT");
      expect(state?.source).toBe("settings");
    });
  });

  describe("mastery protection", () => {
    it("rejects AI MASTERED proposals and does not auto-master from signals", async () => {
      const user = await createEntitledUser(`mast-${Date.now()}`);
      const { concept } = await seedConcept(`m-${Date.now()}`);

      expect(() =>
        parseAIProposalContent({
          type: "CONCEPT_STATE_UPDATE",
          target: { conceptId: concept.id },
          proposedValue: { mastery: "MASTERED" },
        }),
      ).toThrow(/MASTERED/);

      const pending = await ingestSingleAIProposal({
        actorUserId: user.id,
        raw: {
          type: "MISCONCEPTION_SIGNAL",
          target: { conceptId: concept.id },
          proposedValue: { statement: "Thinks moles are animals" },
        },
      });
      expect(pending.status).toBe("PENDING");
      expect(
        await getConceptState({
          actorUserId: user.id,
          userId: user.id,
          conceptId: concept.id,
        }),
      ).toBeNull();

      await confirmAIProposal({
        actorUserId: user.id,
        decision: { proposalId: pending.id },
      });

      const misconceptions = await listMisconceptions({
        actorUserId: user.id,
        userId: user.id,
      });
      expect(misconceptions).toHaveLength(1);
      expect(misconceptions[0]?.provenance).toBe("EXPLICIT");
      expect(misconceptions[0]?.source).toBe("settings");

      // Misconception confirmation must not create MASTERED concept state.
      expect(
        await getConceptState({
          actorUserId: user.id,
          userId: user.id,
          conceptId: concept.id,
        }),
      ).toBeNull();
    });
  });

  describe("confirmation", () => {
    it("valid confirmation mutates via domain services; reject does not; failed claim stays pending", async () => {
      const user = await createEntitledUser(`conf-${Date.now()}`);

      const pending = await ingestSingleAIProposal({
        actorUserId: user.id,
        raw: {
          type: "ATTRIBUTE_UPDATE",
          target: { key: "pref.assistance_style" },
          proposedValue: "explain_first",
        },
      });

      await rejectAIProposal({
        actorUserId: user.id,
        decision: { proposalId: pending.id },
      });

      await expect(
        confirmAIProposal({
          actorUserId: user.id,
          decision: { proposalId: pending.id },
        }),
      ).rejects.toThrow(/Rejected proposal cannot mutate/);

      expect(
        await getActiveAttribute({
          actorUserId: user.id,
          userId: user.id,
          key: "pref.assistance_style",
        }),
      ).toBeNull();

      const pending2 = await ingestSingleAIProposal({
        actorUserId: user.id,
        raw: {
          type: "ATTRIBUTE_UPDATE",
          target: { key: "pref.assistance_style" },
          proposedValue: "hints_first",
        },
      });

      // Corrupt proposed value after ingest to force domain failure on confirm.
      await prisma.aIProposal.update({
        where: { id: pending2.id },
        data: { proposedValueJson: "not-a-valid-enum" },
      });

      await expect(
        confirmAIProposal({
          actorUserId: user.id,
          decision: { proposalId: pending2.id },
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      const afterFail = await prisma.aIProposal.findUniqueOrThrow({
        where: { id: pending2.id },
      });
      expect(afterFail.status).toBe("PENDING");
      expect(afterFail.validationOutcome).toBe("pending_confirmation");
      expect(
        await getActiveAttribute({
          actorUserId: user.id,
          userId: user.id,
          key: "pref.assistance_style",
        }),
      ).toBeNull();
    });
  });

  describe("orchestration integration", () => {
    it("ingests fenced proposals as PENDING without auto-writing Student Model", async () => {
      const user = await createEntitledUser(`orch-${Date.now()}`);

      const fence = [
        "Here is a coaching reply.",
        AI_PROPOSALS_FENCE_START,
        JSON.stringify([
          {
            type: "GOAL_UPDATE",
            target: { scope: "student_goals" },
            proposedValue: { title: "Practice integrals" },
            rationale: "Student asked for a study goal",
          },
        ]),
        AI_PROPOSALS_FENCE_END,
      ].join("\n");

      setAIProvider({
        id: "proposal-stub",
        async complete(req: AICompletionRequest) {
          return {
            content: fence,
            modelKey: req.modelKey,
            provider: "proposal-stub",
            estimatedCostMicros: 1,
            latencyMs: 1,
          };
        },
      } satisfies AIProvider);

      const result = await runAIOrchestration({
        actorUserId: user.id,
        userMessage: "Suggest a study goal for me",
      });

      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]?.type).toBe("GOAL_UPDATE");
      expect(result.proposals[0]?.status).toBe("PENDING");
      expect(await prisma.studentGoal.count({ where: { userId: user.id } })).toBe(
        0,
      );

      await confirmAIProposal({
        actorUserId: user.id,
        decision: { proposalId: result.proposals[0]!.id },
      });

      expect(await prisma.studentGoal.count({ where: { userId: user.id } })).toBe(
        1,
      );
    });
  });
});
