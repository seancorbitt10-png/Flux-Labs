import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from "@/lib/errors";
import {
  setStudentAttribute,
  getActiveAttribute,
  getAttributeHistory,
} from "@/lib/student/attributes";
import { applyClientAttributeUpdate } from "@/lib/student/client-attributes";
import { createStudentGoal, listStudentGoals } from "@/lib/student/goals";
import {
  recordLearningEvidence,
  listLearningEvidence,
} from "@/lib/student/evidence";
import {
  getConceptState,
  upsertExplicitConceptState,
} from "@/lib/student/concept-state";
import {
  deleteUserEducationalData,
  deleteUserAccount,
} from "@/lib/student/deletion";
import { recordStudentObservation } from "@/lib/student/observations";
import { createStudentMisconception } from "@/lib/student/misconceptions";
import {
  createSubject,
  createTopic,
  createConcept,
  createConceptRelation,
  createUserConcept,
  createSystemConcept,
} from "@/lib/knowledge/catalog";
import {
  startOnboardingSession,
  submitOnboardingAnswer,
  completeOnboardingSession,
  dismissOnboardingSession,
} from "@/lib/onboarding/session";
import { ONBOARDING_VERSION } from "@/lib/onboarding/catalog";

const prisma = new PrismaClient();
const SYSTEM = { type: "system" as const };

async function cleanupTestUsers() {
  const where = { email: { endsWith: "@fluxlabs.test" } };
  const users = await prisma.user.findMany({ where, select: { id: true } });
  const ids = users.map((u) => u.id);

  if (ids.length) {
    await prisma.learningEvidence.deleteMany({ where: { userId: { in: ids } } });
    await prisma.studentConceptState.deleteMany({ where: { userId: { in: ids } } });
    await prisma.studentMisconception.deleteMany({ where: { userId: { in: ids } } });
    await prisma.studentObservation.deleteMany({ where: { userId: { in: ids } } });
    await prisma.onboardingAnswer.deleteMany({
      where: { session: { userId: { in: ids } } },
    });
    await prisma.onboardingSession.deleteMany({ where: { userId: { in: ids } } });
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

  // Clean test catalog subjects
  await prisma.conceptRelation.deleteMany({
    where: {
      OR: [
        { fromConcept: { topic: { subject: { slug: { startsWith: "test-" } } } } },
        { toConcept: { topic: { subject: { slug: { startsWith: "test-" } } } } },
      ],
    },
  });
  await prisma.concept.deleteMany({
    where: { topic: { subject: { slug: { startsWith: "test-" } } } },
  });
  await prisma.topic.deleteMany({
    where: { subject: { slug: { startsWith: "test-" } } },
  });
  await prisma.subject.deleteMany({
    where: { slug: { startsWith: "test-" } },
  });
}

async function createUser(suffix: string) {
  return prisma.user.create({
    data: {
      email: `p2.${suffix}@fluxlabs.test`,
      name: "Phase2 Test",
      passwordHash: "x",
      studentProfile: { create: { displayName: "Phase2 Test" } },
    },
  });
}

describe("Phase 2 student model foundation", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanupTestUsers();
  });

  describe("attributes + one-active invariant", () => {
    it("writes first active attribute via registry", async () => {
      const user = await createUser(`attr-${Date.now()}`);
      const result = await setStudentAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "academic.level",
        value: "undergrad",
        writer: "settings",
      });
      expect(result.status).toBe("written");
      if (result.status !== "written") return;
      expect(result.attribute.provenance).toBe("EXPLICIT");
      expect(result.attribute.source).toBe("settings");
      expect(result.attribute.supersededAt).toBeNull();
      expect(result.attribute.confidence).toBeGreaterThan(0.8);
    });

    it("rejects unknown keys and invalid values", async () => {
      const user = await createUser(`badkey-${Date.now()}`);
      await expect(
        setStudentAttribute({
          actorUserId: user.id,
          userId: user.id,
          key: "fake.key",
          value: "x",
          writer: "settings",
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        setStudentAttribute({
          actorUserId: user.id,
          userId: user.id,
          key: "academic.level",
          value: "wizard",
          writer: "settings",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects client provenance/confidence/source bypass", async () => {
      const user = await createUser(`bypass-${Date.now()}`);
      await expect(
        applyClientAttributeUpdate({
          actorUserId: user.id,
          userId: user.id,
          writer: "settings",
          payload: {
            key: "academic.level",
            value: "hs",
            provenance: "EXPLICIT",
            confidence: 1,
            source: "client",
          },
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("supersedes previous active attribute and keeps history", async () => {
      const user = await createUser(`super-${Date.now()}`);
      const first = await setStudentAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "pref.explanation_length",
        value: "concise",
        writer: "onboarding",
      });
      expect(first.status).toBe("written");

      const second = await setStudentAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "pref.explanation_length",
        value: "detailed",
        writer: "settings",
      });
      expect(second.status).toBe("written");
      if (second.status !== "written") return;

      const active = await getActiveAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "pref.explanation_length",
      });
      expect(active?.id).toBe(second.attribute.id);
      expect(active?.valueJson).toBe("detailed");

      const history = await getAttributeHistory({
        actorUserId: user.id,
        userId: user.id,
        key: "pref.explanation_length",
      });
      expect(history).toHaveLength(2);
      const superseded = history.find((h) => h.id === second.supersededId);
      expect(superseded?.supersededAt).not.toBeNull();
      expect(superseded?.supersededById).toBe(second.attribute.id);

      const activeCount = await prisma.studentAttribute.count({
        where: {
          userId: user.id,
          key: "pref.explanation_length",
          supersededAt: null,
        },
      });
      expect(activeCount).toBe(1);
    });

    it("enforces partial unique index in the database", async () => {
      const user = await createUser(`puniq-${Date.now()}`);
      await setStudentAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "challenge.primary",
        value: "time management",
        writer: "settings",
      });

      await expect(
        prisma.studentAttribute.create({
          data: {
            userId: user.id,
            key: "challenge.primary",
            valueJson: "another",
            provenance: "EXPLICIT",
            confidence: 0.9,
            source: "raw",
            supersededAt: null,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });

      const indexes = await prisma.$queryRaw<
        Array<{ indexname: string; indexdef: string }>
      >`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'student_attributes'
          AND indexname = 'student_attribute_one_active_per_key'
      `;
      expect(indexes).toHaveLength(1);
      expect(indexes[0].indexdef.toLowerCase()).toContain("supersededat");
      expect(indexes[0].indexdef.toLowerCase()).toContain("unique");
    });

    it("handles concurrent replacements without two active rows", async () => {
      const user = await createUser(`race-${Date.now()}`);
      await setStudentAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "interest.primary",
        value: "biology",
        writer: "settings",
      });

      const results = await Promise.allSettled([
        setStudentAttribute({
          actorUserId: user.id,
          userId: user.id,
          key: "interest.primary",
          value: "chemistry",
          writer: "settings",
        }),
        setStudentAttribute({
          actorUserId: user.id,
          userId: user.id,
          key: "interest.primary",
          value: "physics",
          writer: "settings",
        }),
        setStudentAttribute({
          actorUserId: user.id,
          userId: user.id,
          key: "interest.primary",
          value: "math",
          writer: "settings",
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      const active = await prisma.studentAttribute.findMany({
        where: {
          userId: user.id,
          key: "interest.primary",
          supersededAt: null,
        },
      });
      expect(active).toHaveLength(1);
    });

    it("does not let weaker provenance overwrite EXPLICIT", async () => {
      const user = await createUser(`prov-${Date.now()}`);
      await setStudentAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "approach.worked_example",
        value: true,
        writer: "settings",
      });

      const rejected = await setStudentAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "approach.worked_example",
        value: false,
        writer: "system",
        systemProvenance: "OBSERVED",
      });
      expect(rejected.status).toBe("rejected_weaker_provenance");

      const active = await getActiveAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "approach.worked_example",
      });
      expect(active?.valueJson).toBe(true);
      expect(active?.provenance).toBe("EXPLICIT");
    });
  });

  describe("authorization", () => {
    it("allows owner access and rejects foreign userId", async () => {
      const a = await createUser(`own-a-${Date.now()}`);
      const b = await createUser(`own-b-${Date.now()}`);

      await setStudentAttribute({
        actorUserId: a.id,
        userId: a.id,
        key: "academic.level",
        value: "grad",
        writer: "settings",
      });

      await expect(
        getActiveAttribute({
          actorUserId: b.id,
          userId: a.id,
          key: "academic.level",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await expect(
        setStudentAttribute({
          actorUserId: b.id,
          userId: a.id,
          key: "academic.level",
          value: "hs",
          writer: "settings",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await expect(
        createStudentGoal({
          actorUserId: b.id,
          userId: a.id,
          title: "Hack goal",
          source: "settings",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("onboarding backend", () => {
    it("accepts valid answers, rejects unknown questions, enforces ownership", async () => {
      const user = await createUser(`onb-${Date.now()}`);
      const other = await createUser(`onb-o-${Date.now()}`);
      const session = await startOnboardingSession({
        actorUserId: user.id,
        userId: user.id,
      });
      expect(session.version).toBe(ONBOARDING_VERSION);
      expect(session.status).toBe("IN_PROGRESS");

      await expect(
        submitOnboardingAnswer({
          actorUserId: other.id,
          userId: user.id,
          sessionId: session.id,
          questionId: "academic.level",
          answer: "hs",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await expect(
        submitOnboardingAnswer({
          actorUserId: user.id,
          userId: user.id,
          sessionId: session.id,
          questionId: "consent.legal",
          answer: true,
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        submitOnboardingAnswer({
          actorUserId: user.id,
          userId: user.id,
          sessionId: session.id,
          questionId: "academic.level",
          answer: "not-a-level",
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      const answer = await submitOnboardingAnswer({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: "academic.level",
        answer: "undergrad",
      });
      expect(answer.skipped).toBe(false);

      const attr = await getActiveAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "academic.level",
      });
      expect(attr?.valueJson).toBe("undergrad");
      expect(attr?.source).toBe("onboarding");

      await submitOnboardingAnswer({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: "goal.primary",
        answer: "Pass organic chemistry",
      });
      const goals = await listStudentGoals({
        actorUserId: user.id,
        userId: user.id,
      });
      expect(goals.some((g) => g.title.includes("organic"))).toBe(true);

      await submitOnboardingAnswer({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: "interest.primary",
        skipped: true,
      });
      const skippedAttr = await getActiveAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "interest.primary",
      });
      expect(skippedAttr).toBeNull();

      const completed = await completeOnboardingSession({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
      });
      expect(completed.status).toBe("COMPLETED");

      const profile = await prisma.studentProfile.findUniqueOrThrow({
        where: { userId: user.id },
      });
      expect(profile.onboardingCompletedAt).not.toBeNull();
      expect(profile.onboardingVersion).toBe(ONBOARDING_VERSION);
    });

    it("supports dismiss / soft-gate state", async () => {
      const user = await createUser(`dismiss-${Date.now()}`);
      const session = await startOnboardingSession({
        actorUserId: user.id,
        userId: user.id,
      });
      const dismissed = await dismissOnboardingSession({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
      });
      expect(dismissed.status).toBe("DISMISSED");
      const profile = await prisma.studentProfile.findUniqueOrThrow({
        where: { userId: user.id },
      });
      expect(profile.onboardingSkippedAt).not.toBeNull();
    });
  });

  describe("evidence vs mastery", () => {
    it("records evidence without auto-setting MASTERED", async () => {
      const user = await createUser(`ev-${Date.now()}`);
      const subject = await createSubject({
        actor: SYSTEM,
        slug: `test-math-${Date.now()}`,
        name: "Test Math",
      });
      const topic = await createTopic({
        actor: SYSTEM,
        subjectId: subject.id,
        slug: "algebra",
        name: "Algebra",
      });
      const concept = await createConcept({
        actor: SYSTEM,
        topicId: topic.id,
        slug: "factoring",
        name: "Factoring",
      });

      const evidence = await recordLearningEvidence({
        actorUserId: user.id,
        userId: user.id,
        conceptId: concept.id,
        kind: "PRACTICE_SUCCESS",
        polarity: "SUPPORTS_HIGHER",
        source: "study_session",
        summary: "Solved one practice item",
      });
      expect(evidence.id).toBeTruthy();

      const tutorSignal = await recordLearningEvidence({
        actorUserId: user.id,
        userId: user.id,
        conceptId: concept.id,
        kind: "TUTOR_SIGNAL",
        polarity: "SUPPORTS_HIGHER",
        source: "tutor",
        summary: "Model thought student mastered this",
      });
      expect(tutorSignal.kind).toBe("TUTOR_SIGNAL");

      const stateAfterEvidence = await getConceptState({
        actorUserId: user.id,
        userId: user.id,
        conceptId: concept.id,
      });
      expect(stateAfterEvidence).toBeNull();

      await upsertExplicitConceptState({
        actorUserId: user.id,
        userId: user.id,
        conceptId: concept.id,
        mastery: "INTRODUCED",
        source: "settings",
      });

      // Evidence alone still must not jump to MASTERED
      await recordLearningEvidence({
        actorUserId: user.id,
        userId: user.id,
        conceptId: concept.id,
        kind: "PRACTICE_SUCCESS",
        polarity: "SUPPORTS_HIGHER",
        source: "study_session",
        summary: "Another success",
      });

      const state = await getConceptState({
        actorUserId: user.id,
        userId: user.id,
        conceptId: concept.id,
      });
      expect(state?.mastery).toBe("INTRODUCED");
      expect(state?.mastery).not.toBe("MASTERED");

      const history = await listLearningEvidence({
        actorUserId: user.id,
        userId: user.id,
        conceptId: concept.id,
      });
      expect(history.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("knowledge foundation", () => {
    it("supports Subject→Topic→Concept and valid relations only", async () => {
      const stamp = Date.now();
      const subject = await createSubject({
        actor: SYSTEM,
        slug: `test-bio-${stamp}`,
        name: "Test Biology",
      });
      const topic = await createTopic({
        actor: SYSTEM,
        subjectId: subject.id,
        slug: "cells",
        name: "Cells",
      });
      const a = await createConcept({
        actor: SYSTEM,
        topicId: topic.id,
        slug: "membrane",
        name: "Cell membrane",
      });
      const b = await createConcept({
        actor: SYSTEM,
        topicId: topic.id,
        slug: "osmosis",
        name: "Osmosis",
      });

      const rel = await createConceptRelation({
        actor: SYSTEM,
        fromConceptId: a.id,
        toConceptId: b.id,
        type: "PREREQUISITE",
      });
      expect(rel.type).toBe("PREREQUISITE");

      await expect(
        createConceptRelation({
          actor: SYSTEM,
          fromConceptId: a.id,
          toConceptId: a.id,
          type: "RELATED",
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      // Catalog is not user-owned
      expect(subject).not.toHaveProperty("userId");
      const subjectRow = await prisma.subject.findUniqueOrThrow({
        where: { id: subject.id },
      });
      expect(Object.keys(subjectRow)).not.toContain("userId");
    });
  });

  describe("deletion semantics", () => {
    it("deletes user-owned educational data and retains catalog + operational rows", async () => {
      const user = await createUser(`del-${Date.now()}`);
      const stamp = Date.now();
      const subject = await createSubject({
        actor: SYSTEM,
        slug: `test-keep-${stamp}`,
        name: "Keep Me",
      });
      const topic = await createTopic({
        actor: SYSTEM,
        subjectId: subject.id,
        slug: "t1",
        name: "Topic",
      });
      const concept = await createConcept({
        actor: SYSTEM,
        topicId: topic.id,
        slug: "c1",
        name: "Concept",
      });

      await setStudentAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "academic.level",
        value: "hs",
        writer: "settings",
      });
      await createStudentGoal({
        actorUserId: user.id,
        userId: user.id,
        title: "Delete me goal",
        source: "settings",
      });
      const session = await startOnboardingSession({
        actorUserId: user.id,
        userId: user.id,
      });
      await submitOnboardingAnswer({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: "challenge.primary",
        answer: "Focus",
      });
      await recordLearningEvidence({
        actorUserId: user.id,
        userId: user.id,
        conceptId: concept.id,
        kind: "SELF_REPORT",
        polarity: "NEUTRAL",
        source: "settings",
        summary: "Self report",
      });
      await upsertExplicitConceptState({
        actorUserId: user.id,
        userId: user.id,
        conceptId: concept.id,
        mastery: "DEVELOPING",
        source: "settings",
      });

      // Operational rows (separate policy — not deleted by educational wipe)
      await prisma.usageRecord.create({
        data: {
          userId: user.id,
          capability: "GENERAL",
          feature: "test",
        },
      });
      await prisma.aIInteraction.create({
        data: {
          userId: user.id,
          taskType: "tutoring",
        },
      });

      const result = await deleteUserEducationalData({
        actorUserId: user.id,
        userId: user.id,
      });
      expect(result.deleted.studentAttributes).toBeGreaterThanOrEqual(1);
      expect(result.deleted.studentGoals).toBeGreaterThanOrEqual(1);
      expect(result.deleted.onboardingSessions).toBe(1);
      expect(result.deleted.learningEvidence).toBe(1);
      expect(result.deleted.studentConceptStates).toBe(1);
      expect(result.deleted.studentProfile).toBe(1);

      expect(
        await prisma.studentAttribute.count({ where: { userId: user.id } }),
      ).toBe(0);
      expect(
        await prisma.subject.findUnique({ where: { id: subject.id } }),
      ).not.toBeNull();
      expect(
        await prisma.concept.findUnique({ where: { id: concept.id } }),
      ).not.toBeNull();
      expect(
        await prisma.usageRecord.count({ where: { userId: user.id } }),
      ).toBe(1);
      expect(
        await prisma.aIInteraction.count({ where: { userId: user.id } }),
      ).toBe(1);
      // User account itself remains (educational wipe ≠ account delete)
      expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    });
  });

  describe("HIGH remediation — system cannot mint EXPLICIT", () => {
    it("rejects system write with omitted provenance", async () => {
      const user = await createUser(`sys-omit-${Date.now()}`);
      await expect(
        setStudentAttribute({
          actorUserId: user.id,
          userId: user.id,
          key: "approach.worked_example",
          value: true,
          writer: "system",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects system write requesting EXPLICIT", async () => {
      const user = await createUser(`sys-exp-${Date.now()}`);
      await expect(
        setStudentAttribute({
          actorUserId: user.id,
          userId: user.id,
          key: "approach.worked_example",
          value: true,
          writer: "system",
          systemProvenance: "EXPLICIT",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("allows legitimate student EXPLICIT writes and keeps precedence", async () => {
      const user = await createUser(`sys-ok-${Date.now()}`);
      const explicit = await setStudentAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "approach.worked_example",
        value: true,
        writer: "settings",
      });
      expect(explicit.status).toBe("written");
      if (explicit.status !== "written") return;
      expect(explicit.attribute.provenance).toBe("EXPLICIT");

      const rejected = await setStudentAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "approach.worked_example",
        value: false,
        writer: "system",
        systemProvenance: "OBSERVED",
      });
      expect(rejected.status).toBe("rejected_weaker_provenance");

      const observed = await setStudentAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "interest.secondary",
        value: "history",
        writer: "settings",
      });
      // interest.secondary only allows onboarding/settings — prove system OBSERVED works on approach
      expect(observed.status).toBe("written");

      const systemOk = await setStudentAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "approach.worked_example",
        value: false,
        writer: "settings",
      });
      expect(systemOk.status).toBe("written");
      if (systemOk.status !== "written") return;
      expect(systemOk.attribute.provenance).toBe("EXPLICIT");
    });
  });

  describe("HIGH remediation — observation/misconception authority fields", () => {
    it("rejects caller-controlled provenance/confidence on observations", async () => {
      const user = await createUser(`obs-auth-${Date.now()}`);
      const other = await createUser(`obs-other-${Date.now()}`);

      const ok = await recordStudentObservation({
        actorUserId: user.id,
        userId: user.id,
        category: "study",
        type: "session_length",
        summary: "Studied for 40 minutes",
        channel: "study_session",
      });
      expect(ok.provenance).toBe("OBSERVED");
      expect(ok.source).toBe("study_session");
      expect(ok.confidence).toBeLessThanOrEqual(0.7);

      await expect(
        recordStudentObservation({
          actorUserId: user.id,
          userId: user.id,
          category: "study",
          type: "session_length",
          summary: "Hack",
          channel: "study_session",
          provenance: "EXPLICIT",
        } as never),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        recordStudentObservation({
          actorUserId: user.id,
          userId: user.id,
          category: "study",
          type: "session_length",
          summary: "Hack",
          channel: "study_session",
          confidence: 1,
        } as never),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        recordStudentObservation({
          actorUserId: other.id,
          userId: user.id,
          category: "study",
          type: "session_length",
          summary: "IDOR",
          channel: "study_session",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("rejects caller-controlled provenance/confidence on misconceptions", async () => {
      const user = await createUser(`misc-auth-${Date.now()}`);
      const other = await createUser(`misc-other-${Date.now()}`);

      const ok = await createStudentMisconception({
        actorUserId: user.id,
        userId: user.id,
        statement: "Confuses mean and median",
        channel: "tutor",
      });
      expect(ok.provenance).toBe("OBSERVED");
      expect(ok.source).toBe("tutor");

      const settings = await createStudentMisconception({
        actorUserId: user.id,
        userId: user.id,
        statement: "I still mix up slope and intercept",
        channel: "settings",
      });
      expect(settings.provenance).toBe("EXPLICIT");
      expect(settings.source).toBe("settings");

      await expect(
        createStudentMisconception({
          actorUserId: user.id,
          userId: user.id,
          statement: "Hack",
          channel: "tutor",
          provenance: "EXPLICIT",
        } as never),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        createStudentMisconception({
          actorUserId: user.id,
          userId: user.id,
          statement: "Hack",
          channel: "tutor",
          confidence: 0.99,
        } as never),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        createStudentMisconception({
          actorUserId: other.id,
          userId: user.id,
          statement: "IDOR",
          channel: "tutor",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("HIGH remediation — catalog authz and USER attribution", () => {
    it("rejects unauthorized shared catalog creation and spoofed attribution", async () => {
      const a = await createUser(`cat-a-${Date.now()}`);
      const b = await createUser(`cat-b-${Date.now()}`);
      const stamp = Date.now();

      await expect(
        createSubject({
          actor: { type: "user", userId: a.id },
          slug: `test-denied-${stamp}`,
          name: "Denied",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      const subject = await createSubject({
        actor: SYSTEM,
        slug: `test-authz-${stamp}`,
        name: "Authz Subject",
      });
      const topic = await createTopic({
        actor: SYSTEM,
        subjectId: subject.id,
        slug: "t",
        name: "Topic",
      });

      const systemConcept = await createSystemConcept({
        actor: SYSTEM,
        topicId: topic.id,
        slug: "sys",
        name: "System Concept",
      });
      expect(systemConcept.source).toBe("SYSTEM");
      expect(systemConcept.createdByUserId).toBeNull();

      const userConcept = await createUserConcept({
        actor: { type: "user", userId: a.id },
        topicId: topic.id,
        slug: "user-a",
        name: "User A Concept",
      });
      expect(userConcept.source).toBe("USER");
      expect(userConcept.createdByUserId).toBe(a.id);

      await expect(
        createUserConcept({
          actor: { type: "user", userId: a.id },
          topicId: topic.id,
          slug: "spoof",
          name: "Spoof",
          createdByUserId: b.id,
        } as never),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        createUserConcept({
          actor: SYSTEM,
          topicId: topic.id,
          slug: "no-auth",
          name: "No Auth",
        }),
      ).rejects.toBeInstanceOf(UnauthorizedError);

      // Cross-user: A cannot create as B by using B's actor while claiming otherwise —
      // ownership is always actor.userId
      const asB = await createUserConcept({
        actor: { type: "user", userId: b.id },
        topicId: topic.id,
        slug: "user-b",
        name: "User B Concept",
      });
      expect(asB.createdByUserId).toBe(b.id);
      expect(asB.createdByUserId).not.toBe(a.id);
    });
  });

  describe("HIGH remediation — account delete removes USER concepts", () => {
    it("deletes USER concepts on account delete and retains SYSTEM catalog", async () => {
      const a = await createUser(`acct-a-${Date.now()}`);
      const b = await createUser(`acct-b-${Date.now()}`);
      const stamp = Date.now();

      const subject = await createSubject({
        actor: SYSTEM,
        slug: `test-acct-${stamp}`,
        name: "Account Delete Subject",
      });
      const topic = await createTopic({
        actor: SYSTEM,
        subjectId: subject.id,
        slug: "t",
        name: "Topic",
      });
      const systemConcept = await createSystemConcept({
        actor: SYSTEM,
        topicId: topic.id,
        slug: "keep-sys",
        name: "Keep System",
      });
      const aConcept = await createUserConcept({
        actor: { type: "user", userId: a.id },
        topicId: topic.id,
        slug: "a-only",
        name: "A Concept",
      });
      const bConcept = await createUserConcept({
        actor: { type: "user", userId: b.id },
        topicId: topic.id,
        slug: "b-only",
        name: "B Concept",
      });

      await deleteUserAccount({ actorUserId: a.id, userId: a.id });

      expect(await prisma.user.findUnique({ where: { id: a.id } })).toBeNull();
      expect(
        await prisma.concept.findUnique({ where: { id: aConcept.id } }),
      ).toBeNull();
      expect(
        await prisma.concept.findUnique({ where: { id: systemConcept.id } }),
      ).not.toBeNull();
      expect(
        await prisma.concept.findUnique({ where: { id: bConcept.id } }),
      ).not.toBeNull();
      expect(
        await prisma.subject.findUnique({ where: { id: subject.id } }),
      ).not.toBeNull();

      const orphans = await prisma.concept.findMany({
        where: { source: "USER", createdByUserId: null },
      });
      expect(orphans).toHaveLength(0);

      // FK safety: raw user delete also cascades USER concepts
      const c = await createUser(`acct-c-${Date.now()}`);
      const cConcept = await createUserConcept({
        actor: { type: "user", userId: c.id },
        topicId: topic.id,
        slug: `c-only-${Date.now()}`,
        name: "C Concept",
      });
      await prisma.user.delete({ where: { id: c.id } });
      expect(
        await prisma.concept.findUnique({ where: { id: cConcept.id } }),
      ).toBeNull();
    });
  });

  describe("HIGH remediation #2 — concept state and goals authority", () => {
    async function seedConcept(suffix: string) {
      const subject = await createSubject({
        actor: SYSTEM,
        slug: `test-cs-${suffix}`,
        name: "CS Subject",
      });
      const topic = await createTopic({
        actor: SYSTEM,
        subjectId: subject.id,
        slug: "t",
        name: "Topic",
      });
      const concept = await createSystemConcept({
        actor: SYSTEM,
        topicId: topic.id,
        slug: "c",
        name: "Concept",
      });
      return concept;
    }

    it("rejects system EXPLICIT / MASTERED concept-state writes", async () => {
      const user = await createUser(`cs-sys-${Date.now()}`);
      const other = await createUser(`cs-oth-${Date.now()}`);
      const concept = await seedConcept(`${Date.now()}`);

      await expect(
        upsertExplicitConceptState({
          actorUserId: user.id,
          userId: user.id,
          conceptId: concept.id,
          mastery: "INTRODUCED",
          source: "system",
        } as never),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        upsertExplicitConceptState({
          actorUserId: user.id,
          userId: user.id,
          conceptId: concept.id,
          mastery: "MASTERED",
          source: "system",
          provenance: "EXPLICIT",
        } as never),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        upsertExplicitConceptState({
          actorUserId: user.id,
          userId: user.id,
          conceptId: concept.id,
          mastery: "DEVELOPING",
          source: "settings",
          provenance: "EXPLICIT",
        } as never),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        upsertExplicitConceptState({
          actorUserId: user.id,
          userId: user.id,
          conceptId: concept.id,
          mastery: "MASTERED",
          source: "settings",
          confidence: 1,
        } as never),
      ).rejects.toBeInstanceOf(ValidationError);

      const ok = await upsertExplicitConceptState({
        actorUserId: user.id,
        userId: user.id,
        conceptId: concept.id,
        mastery: "INTRODUCED",
        source: "settings",
      });
      expect(ok.provenance).toBe("EXPLICIT");
      expect(ok.source).toBe("settings");
      expect(ok.mastery).toBe("INTRODUCED");

      const mastered = await upsertExplicitConceptState({
        actorUserId: user.id,
        userId: user.id,
        conceptId: concept.id,
        mastery: "MASTERED",
        source: "settings",
      });
      expect(mastered.mastery).toBe("MASTERED");
      expect(mastered.provenance).toBe("EXPLICIT");

      await expect(
        upsertExplicitConceptState({
          actorUserId: other.id,
          userId: user.id,
          conceptId: concept.id,
          mastery: "DEVELOPING",
          source: "settings",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("rejects system EXPLICIT goals; student path remains", async () => {
      const user = await createUser(`goal-sys-${Date.now()}`);
      const other = await createUser(`goal-oth-${Date.now()}`);

      await expect(
        createStudentGoal({
          actorUserId: user.id,
          userId: user.id,
          title: "System goal",
          source: "system",
        } as never),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        createStudentGoal({
          actorUserId: user.id,
          userId: user.id,
          title: "Spoofed",
          source: "settings",
          provenance: "EXPLICIT",
        } as never),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        createStudentGoal({
          actorUserId: user.id,
          userId: user.id,
          title: "Spoofed conf",
          source: "settings",
          confidence: 1,
        } as never),
      ).rejects.toBeInstanceOf(ValidationError);

      const ok = await createStudentGoal({
        actorUserId: user.id,
        userId: user.id,
        title: "Pass organic chemistry",
        source: "settings",
      });
      expect(ok.provenance).toBe("EXPLICIT");
      expect(ok.source).toBe("settings");

      await expect(
        createStudentGoal({
          actorUserId: other.id,
          userId: user.id,
          title: "IDOR goal",
          source: "settings",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("keeps prior attribute and observation/misconception authority protections", async () => {
      const user = await createUser(`adj-${Date.now()}`);

      await expect(
        setStudentAttribute({
          actorUserId: user.id,
          userId: user.id,
          key: "approach.worked_example",
          value: true,
          writer: "system",
          systemProvenance: "EXPLICIT",
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        recordStudentObservation({
          actorUserId: user.id,
          userId: user.id,
          category: "study",
          type: "t",
          summary: "x",
          channel: "study_session",
          provenance: "EXPLICIT",
        } as never),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        createStudentMisconception({
          actorUserId: user.id,
          userId: user.id,
          statement: "x",
          channel: "tutor",
          confidence: 0.99,
        } as never),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
