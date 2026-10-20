import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import {
  getActiveAttribute,
  setStudentAttribute,
} from "@/lib/student/attributes";
import { listStudentGoals } from "@/lib/student/goals";
import {
  completeOnboardingSession,
  dismissOnboardingSession,
  getOnboardingBootstrap,
  getOnboardingSessionForUser,
  resolveOnboardingGate,
  resolvePostAuthPath,
  saveOnboardingResumeState,
  startOnboardingSession,
  submitOnboardingAnswer,
} from "@/lib/onboarding/session";
import {
  getOnboardingCatalog,
  ONBOARDING_VERSION,
} from "@/lib/onboarding/catalog";
import { assertNoClientOnboardingAuthority } from "@/lib/onboarding/client-guards";
import { assembleAIContext } from "@/lib/ai/context-assembly";

const prisma = new PrismaClient();

async function cleanupTestUsers() {
  const where = { email: { endsWith: "@fluxlabs.test" } };
  const users = await prisma.user.findMany({ where, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await prisma.onboardingAnswer.deleteMany({
      where: { session: { userId: { in: ids } } },
    });
    await prisma.onboardingSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.studentAttribute.deleteMany({ where: { userId: { in: ids } } });
    await prisma.studentGoal.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.aIInteraction.deleteMany({ where: { userId: { in: ids } } });
    await prisma.usageRecord.deleteMany({ where: { userId: { in: ids } } });
    await prisma.trial.deleteMany({ where: { userId: { in: ids } } });
    await prisma.entitlement.deleteMany({ where: { userId: { in: ids } } });
    await prisma.studentProfile.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where });
  }
}

async function createUser(suffix: string) {
  return prisma.user.create({
    data: {
      email: `onb4.${suffix}@fluxlabs.test`,
      name: `Onboarding ${suffix}`,
      studentProfile: { create: { displayName: `Onboarding ${suffix}` } },
    },
  });
}

describe("Phase 2 Implementation #4 — onboarding + student setup", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanupTestUsers();
  });

  it("retrieves the server question registry", async () => {
    const catalog = getOnboardingCatalog(ONBOARDING_VERSION);
    expect(catalog.questions.length).toBeGreaterThanOrEqual(22);
    expect(catalog.questions.length).toBeLessThanOrEqual(26);
    expect(catalog.questions.every((q) => q.questionId && q.prompt)).toBe(true);
  });

  it("accepts valid answers and maps only supported Student Model targets", async () => {
    const user = await createUser(`valid-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });

    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.level",
      answer: "undergrad",
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.subjects",
      answer: ["Chemistry", "Calculus"],
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "goal.primary",
      answer: "Pass organic chemistry",
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "goal.success_month",
      answer: "Finish the midterm strong",
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "pref.assistance_style",
      answer: "hints_first",
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "pref.explanation_length",
      answer: "concise",
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "pref.guided_participation",
      answer: true,
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "habit.typical_weekly_time",
      answer: "6_to_10h",
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "challenge.primary",
      answer: "Time management",
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "approach.worked_example",
      answer: true,
    });

    // answer_only — stored, not promoted
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.hardest_class",
      answer: "Orgo lab writeups",
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "intent.priority",
      answer: "Help me plan weekly study blocks",
    });

    const level = await getActiveAttribute({
      actorUserId: user.id,
      userId: user.id,
      key: "academic.level",
    });
    expect(level?.valueJson).toBe("undergrad");
    expect(level?.provenance).toBe("EXPLICIT");
    expect(level?.source).toBe("onboarding");

    const subjects = await getActiveAttribute({
      actorUserId: user.id,
      userId: user.id,
      key: "academic.subjects",
    });
    expect(subjects?.valueJson).toEqual(["Chemistry", "Calculus"]);

    const worked = await getActiveAttribute({
      actorUserId: user.id,
      userId: user.id,
      key: "approach.worked_example",
    });
    expect(worked?.valueJson).toBe(true);

    const goals = await listStudentGoals({
      actorUserId: user.id,
      userId: user.id,
    });
    expect(goals).toHaveLength(1);
    expect(goals[0]?.category).toBe("primary");
    expect(goals[0]?.provenance).toBe("EXPLICIT");
    expect(goals[0]?.source).toBe("onboarding");

    const profile = await prisma.studentProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(profile.academicLevel).toBe("undergrad");
    expect(profile.preferredAssistanceStyle).toBe("hints_first");
    expect(profile.goalsSummary).toContain("midterm");

    const stored = await prisma.onboardingAnswer.findMany({
      where: { sessionId: session.id },
    });
    expect(
      stored.some(
        (a) =>
          a.questionId === "academic.hardest_class" &&
          a.skipped === false &&
          a.answerJson === "Orgo lab writeups",
      ),
    ).toBe(true);

    // No invented attribute for answer-only intent
    await expect(
      getActiveAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "intent.priority",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects invalid answers, oversized text, malformed payloads, and unknown IDs", async () => {
    const user = await createUser(`invalid-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });

    await expect(
      submitOnboardingAnswer({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: "academic.level",
        answer: "not-a-level",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      submitOnboardingAnswer({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: "pref.guided_participation",
        answer: "sometimes",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      submitOnboardingAnswer({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: "academic.subjects",
        answer: ["ok", "x".repeat(200)],
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      submitOnboardingAnswer({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: "goal.primary",
        answer: "y".repeat(500),
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      submitOnboardingAnswer({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: "learning.style.visual",
        answer: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      submitOnboardingAnswer({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: "academic.level",
        // missing answer and not skipped
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("supports optional skip, partial completion, resume, and duplicate resubmit", async () => {
    const user = await createUser(`resume-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });

    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "interest.primary",
      skipped: true,
    });
    expect(
      await getActiveAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "interest.primary",
      }),
    ).toBeNull();

    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.level",
      answer: "hs",
    });

    // Resume returns same IN_PROGRESS session
    const resumed = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });
    expect(resumed.id).toBe(session.id);
    expect(resumed.answers.length).toBe(2);

    // Duplicate submission updates in place
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.level",
      answer: "grad",
    });
    const attrs = await prisma.studentAttribute.findMany({
      where: { userId: user.id, key: "academic.level" },
      orderBy: { createdAt: "asc" },
    });
    expect(attrs.filter((a) => a.supersededAt === null)).toHaveLength(1);
    expect(attrs.find((a) => a.supersededAt === null)?.valueJson).toBe("grad");

    const bootstrap = await getOnboardingBootstrap({
      actorUserId: user.id,
      userId: user.id,
      ensureSession: false,
    });
    expect(bootstrap.gate).toBe("in_progress");
    expect(bootstrap.progress.answeredOrSkipped).toBe(2);
    expect(bootstrap.answers["interest.primary"]?.skipped).toBe(true);
  });

  it("completes and dismisses with correct profile gate state", async () => {
    const completer = await createUser(`done-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: completer.id,
      userId: completer.id,
    });
    await completeOnboardingSession({
      actorUserId: completer.id,
      userId: completer.id,
      sessionId: session.id,
    });
    const completedProfile = await prisma.studentProfile.findUniqueOrThrow({
      where: { userId: completer.id },
    });
    expect(completedProfile.onboardingCompletedAt).not.toBeNull();
    expect(completedProfile.onboardingVersion).toBe(ONBOARDING_VERSION);
    expect(completedProfile.onboardingSkippedAt).toBeNull();
    expect(
      await resolvePostAuthPath({
        actorUserId: completer.id,
        userId: completer.id,
      }),
    ).toBe("/home");

    // Already-completed: further answers rejected
    await expect(
      submitOnboardingAnswer({
        actorUserId: completer.id,
        userId: completer.id,
        sessionId: session.id,
        questionId: "academic.level",
        answer: "hs",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const skipper = await createUser(`skip-${Date.now()}`);
    const skipSession = await startOnboardingSession({
      actorUserId: skipper.id,
      userId: skipper.id,
    });
    await submitOnboardingAnswer({
      actorUserId: skipper.id,
      userId: skipper.id,
      sessionId: skipSession.id,
      questionId: "academic.level",
      answer: "other",
    });
    await dismissOnboardingSession({
      actorUserId: skipper.id,
      userId: skipper.id,
      sessionId: skipSession.id,
    });
    const skippedProfile = await prisma.studentProfile.findUniqueOrThrow({
      where: { userId: skipper.id },
    });
    expect(skippedProfile.onboardingSkippedAt).not.toBeNull();
    // Preserve prior valid EXPLICIT data after dismiss
    const kept = await getActiveAttribute({
      actorUserId: skipper.id,
      userId: skipper.id,
      key: "academic.level",
    });
    expect(kept?.valueJson).toBe("other");

    const gate = await resolveOnboardingGate({
      actorUserId: skipper.id,
      userId: skipper.id,
    });
    expect(gate.gate).toBe("dismissed");
    expect(
      await resolvePostAuthPath({
        actorUserId: skipper.id,
        userId: skipper.id,
      }),
    ).toBe("/home");

    // Empty/degraded onboarding still allows context assembly
    const empty = await createUser(`empty-${Date.now()}`);
    const ctx = await assembleAIContext({
      userId: empty.id,
      actorUserId: empty.id,
      taskType: "general_conversation",
    });
    expect(ctx.currentState.attributes).toEqual([]);
    expect(ctx.currentState.goals).toEqual([]);
    expect(ctx.version).toBeTruthy();
  });

  it("enforces ownership / IDOR boundaries", async () => {
    const owner = await createUser(`owner-${Date.now()}`);
    const attacker = await createUser(`attacker-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: owner.id,
      userId: owner.id,
    });

    await expect(
      startOnboardingSession({
        actorUserId: attacker.id,
        userId: owner.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      getOnboardingSessionForUser({
        actorUserId: attacker.id,
        userId: owner.id,
        sessionId: session.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      submitOnboardingAnswer({
        actorUserId: attacker.id,
        userId: owner.id,
        sessionId: session.id,
        questionId: "academic.level",
        answer: "hs",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      completeOnboardingSession({
        actorUserId: attacker.id,
        userId: owner.id,
        sessionId: session.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      dismissOnboardingSession({
        actorUserId: attacker.id,
        userId: owner.id,
        sessionId: session.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      saveOnboardingResumeState({
        actorUserId: attacker.id,
        userId: owner.id,
        sessionId: session.id,
        questionId: "academic.level",
        questionIndex: 0,
        draft: "hs",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      saveOnboardingResumeState({
        actorUserId: attacker.id,
        userId: attacker.id,
        sessionId: session.id,
        questionId: "academic.level",
        questionIndex: 0,
        draft: "hs",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    // Cross-session IDOR: attacker cannot use owner's sessionId under own userId
    await expect(
      submitOnboardingAnswer({
        actorUserId: attacker.id,
        userId: attacker.id,
        sessionId: session.id,
        questionId: "academic.level",
        answer: "hs",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects client-supplied authority/identity fields", () => {
    expect(() =>
      assertNoClientOnboardingAuthority({
        sessionId: "s1",
        questionId: "academic.level",
        answer: "hs",
        userId: "attacker",
      }),
    ).toThrow(ValidationError);

    expect(() =>
      assertNoClientOnboardingAuthority({
        sessionId: "s1",
        questionId: "academic.level",
        answer: "hs",
        provenance: "EXPLICIT",
      }),
    ).toThrow(ValidationError);

    expect(() =>
      assertNoClientOnboardingAuthority({
        sessionId: "s1",
        questionId: "academic.level",
        answer: "hs",
        confidence: 0.99,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      assertNoClientOnboardingAuthority({
        sessionId: "s1",
        questionId: "academic.level",
        answer: "hs",
        source: "hacked",
      }),
    ).toThrow(ValidationError);

    expect(() =>
      assertNoClientOnboardingAuthority({
        sessionId: "s1",
        questionId: "academic.level",
        answer: "hs",
        channel: "browser",
      }),
    ).toThrow(ValidationError);

    expect(() =>
      assertNoClientOnboardingAuthority({
        sessionId: "s1",
        onboardingVersion: "attacker-v1",
      }),
    ).toThrow(ValidationError);

    expect(() =>
      assertNoClientOnboardingAuthority({
        sessionId: "s1",
        createdByUserId: "attacker",
      }),
    ).toThrow(ValidationError);

    // Allowed submission shape
    expect(() =>
      assertNoClientOnboardingAuthority({
        sessionId: "s1",
        questionId: "academic.level",
        answer: "hs",
        skipped: false,
      }),
    ).not.toThrow();
  });

  it("preserves EXPLICIT over weaker provenance and rejects unsupported keys", async () => {
    const user = await createUser(`prov-${Date.now()}`);
    await setStudentAttribute({
      actorUserId: user.id,
      userId: user.id,
      key: "approach.worked_example",
      value: true,
      writer: "settings",
    });

    // Weaker system write cannot overwrite EXPLICIT
    const rejected = await setStudentAttribute({
      actorUserId: user.id,
      userId: user.id,
      key: "approach.worked_example",
      value: false,
      writer: "system",
      systemProvenance: "INFERRED",
    });
    expect(rejected.status).toBe("rejected_weaker_provenance");

    const session = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });
    // Onboarding EXPLICIT may supersede prior EXPLICIT
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.level",
      answer: "grad",
    });
    const active = await getActiveAttribute({
      actorUserId: user.id,
      userId: user.id,
      key: "academic.level",
    });
    expect(active?.valueJson).toBe("grad");
    expect(active?.provenance).toBe("EXPLICIT");

    // Prior EXPLICIT approach preference preserved against weaker write
    const kept = await getActiveAttribute({
      actorUserId: user.id,
      userId: user.id,
      key: "approach.worked_example",
    });
    expect(kept?.valueJson).toBe(true);
    expect(kept?.provenance).toBe("EXPLICIT");

    await expect(
      setStudentAttribute({
        actorUserId: user.id,
        userId: user.id,
        key: "learning.style.vak",
        value: "visual",
        writer: "onboarding",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("upserts onboarding goals by category without AI/system minting", async () => {
    const user = await createUser(`goal-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });

    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "goal.primary",
      answer: "First goal",
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "goal.primary",
      answer: "Updated goal",
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "goal.secondary",
      answer: "Secondary goal",
    });

    const goals = await listStudentGoals({
      actorUserId: user.id,
      userId: user.id,
    });
    expect(goals.filter((g) => g.category === "primary")).toHaveLength(1);
    expect(goals.find((g) => g.category === "primary")?.title).toBe(
      "Updated goal",
    );
    expect(goals.filter((g) => g.category === "secondary")).toHaveLength(1);
    expect(goals.every((g) => g.provenance === "EXPLICIT")).toBe(true);
    expect(goals.every((g) => g.source === "onboarding")).toBe(true);
  });

  it("ignores client-supplied version overrides on session start", async () => {
    const user = await createUser(`ver-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
      version: "attacker-controlled-version",
    });
    expect(session.version).toBe(ONBOARDING_VERSION);
  });

  it("keeps a deferred IN_PROGRESS session resumable with answers intact", async () => {
    const user = await createUser(`defer-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.level",
      answer: "undergrad",
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.setting",
      skipped: true,
    });

    const afterLeave = await prisma.onboardingSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { answers: true },
    });
    expect(afterLeave.status).toBe("IN_PROGRESS");
    expect(afterLeave.completedAt).toBeNull();
    expect(afterLeave.answers).toHaveLength(2);

    const profile = await prisma.studentProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(profile.onboardingSkippedAt).toBeNull();
    expect(profile.onboardingCompletedAt).toBeNull();

    expect(
      await resolvePostAuthPath({
        actorUserId: user.id,
        userId: user.id,
      }),
    ).toBe("/home");

    const resumed = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });
    expect(resumed.id).toBe(session.id);
    expect(resumed.status).toBe("IN_PROGRESS");

    const bootstrap = await getOnboardingBootstrap({
      actorUserId: user.id,
      userId: user.id,
      ensureSession: true,
    });
    const catalog = getOnboardingCatalog(ONBOARDING_VERSION);
    expect(bootstrap.gate).toBe("in_progress");
    expect(bootstrap.session?.id).toBe(session.id);
    expect(bootstrap.answers["academic.level"]?.answer).toBe("undergrad");
    expect(bootstrap.answers["academic.setting"]?.skipped).toBe(true);
    expect(bootstrap.progress.answeredOrSkipped).toBe(2);
    expect(bootstrap.progress.firstUnansweredIndex).toBe(
      catalog.questions.findIndex((q) => q.questionId === "academic.target_band"),
    );
    expect(
      catalog.questions[bootstrap.progress.firstUnansweredIndex]?.questionId,
    ).toBe("academic.target_band");
  });

  it("does not restart when every question is answered or skipped but setup is unfinished", async () => {
    const user = await createUser(`allq-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });
    const catalog = getOnboardingCatalog(ONBOARDING_VERSION);
    for (const question of catalog.questions) {
      await submitOnboardingAnswer({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: question.questionId,
        skipped: true,
      });
    }

    const bootstrap = await getOnboardingBootstrap({
      actorUserId: user.id,
      userId: user.id,
      ensureSession: true,
    });
    expect(bootstrap.session?.id).toBe(session.id);
    expect(bootstrap.session?.status).toBe("IN_PROGRESS");
    expect(bootstrap.progress.remaining).toBe(0);
    expect(bootstrap.progress.answeredOrSkipped).toBe(catalog.questions.length);
    expect(bootstrap.progress.firstUnansweredIndex).toBe(
      catalog.questions.length - 1,
    );
    expect(
      await resolvePostAuthPath({
        actorUserId: user.id,
        userId: user.id,
      }),
    ).toBe("/home");
  });

  it("does not trap first-run users away from Academic setup", async () => {
    const user = await createUser(`needed-${Date.now()}`);
    expect(
      await resolvePostAuthPath({
        actorUserId: user.id,
        userId: user.id,
      }),
    ).toBe("/onboarding");
  });

  it("persists exact resume position and unfinished draft without submitting answers", async () => {
    const user = await createUser(`resume-draft-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });
    const catalog = getOnboardingCatalog(ONBOARDING_VERSION);
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.level",
      answer: "undergrad",
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.setting",
      skipped: true,
    });

    const subjectsIndex = catalog.questions.findIndex(
      (q) => q.questionId === "academic.subjects",
    );
    expect(subjectsIndex).toBeGreaterThan(1);

    const beforeAnswers = await prisma.onboardingAnswer.findMany({
      where: { sessionId: session.id },
      orderBy: { questionId: "asc" },
    });

    const saved = await saveOnboardingResumeState({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.subjects",
      questionIndex: subjectsIndex,
      draft: ["Math"],
      tagInput: "Chemistry",
    });
    expect(saved.questionIndex).toBe(subjectsIndex);
    expect(saved.tagInput).toBe("Chemistry");

    const afterAnswers = await prisma.onboardingAnswer.findMany({
      where: { sessionId: session.id },
      orderBy: { questionId: "asc" },
    });
    expect(afterAnswers).toHaveLength(beforeAnswers.length);
    expect(afterAnswers.map((a) => a.questionId).sort()).toEqual(
      beforeAnswers.map((a) => a.questionId).sort(),
    );
    expect(
      afterAnswers.find((a) => a.questionId === "academic.subjects"),
    ).toBeUndefined();

    const persisted = await prisma.onboardingSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(persisted.status).toBe("IN_PROGRESS");
    expect(persisted.completedAt).toBeNull();

    const profile = await prisma.studentProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(profile.onboardingCompletedAt).toBeNull();
    expect(profile.onboardingSkippedAt).toBeNull();

    const bootstrap = await getOnboardingBootstrap({
      actorUserId: user.id,
      userId: user.id,
      ensureSession: true,
    });
    expect(bootstrap.resume).toEqual({
      questionIndex: subjectsIndex,
      questionId: "academic.subjects",
      draft: ["Math"],
      tagInput: "Chemistry",
    });
    expect(bootstrap.progress.firstUnansweredIndex).not.toBe(subjectsIndex);
    expect(bootstrap.answers["academic.level"]?.answer).toBe("undergrad");
  });

  it("resumes a backward cursor even when later questions are already answered", async () => {
    const user = await createUser(`back-cursor-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.level",
      answer: "hs",
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.setting",
      answer: "high_school",
    });

    await saveOnboardingResumeState({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.level",
      questionIndex: 0,
      draft: "undergrad",
    });

    const bootstrap = await getOnboardingBootstrap({
      actorUserId: user.id,
      userId: user.id,
      ensureSession: true,
    });
    expect(bootstrap.resume?.questionIndex).toBe(0);
    expect(bootstrap.resume?.draft).toBe("undergrad");
    expect(bootstrap.progress.firstUnansweredIndex).toBeGreaterThan(0);
    expect(bootstrap.answers["academic.level"]?.answer).toBe("hs");
    expect(bootstrap.answers["academic.setting"]?.answer).toBe("high_school");
  });

  it("rejects invalid, stale, and completed sessions for resume saves", async () => {
    const user = await createUser(`stale-resume-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });

    await expect(
      saveOnboardingResumeState({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: "academic.level",
        questionIndex: 3,
        draft: "hs",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      saveOnboardingResumeState({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: "unknown.question",
        questionIndex: 0,
        draft: "hs",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await completeOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
    });

    await expect(
      saveOnboardingResumeState({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: "academic.level",
        questionIndex: 0,
        draft: "hs",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const completed = await prisma.onboardingSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(completed.resumeQuestionIndex).toBeNull();
    expect(completed.resumeQuestionId).toBeNull();
    expect(completed.resumeDraftJson).toBeNull();
  });

  it("completes setup only through Finish setup, not defer", async () => {
    const user = await createUser(`finish-only-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });
    await saveOnboardingResumeState({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.level",
      questionIndex: 0,
      draft: "hs",
    });

    const deferred = await prisma.onboardingSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(deferred.status).toBe("IN_PROGRESS");

    const profileAfterDefer = await prisma.studentProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(profileAfterDefer.onboardingCompletedAt).toBeNull();
    expect(profileAfterDefer.onboardingSkippedAt).toBeNull();

    await completeOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
    });
    const completed = await prisma.onboardingSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(completed.status).toBe("COMPLETED");
    const profile = await prisma.studentProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(profile.onboardingCompletedAt).not.toBeNull();
  });

  it("leaves never-started setup without a resume cursor", async () => {
    const user = await createUser(`fresh-${Date.now()}`);
    const bootstrap = await getOnboardingBootstrap({
      actorUserId: user.id,
      userId: user.id,
      ensureSession: true,
    });
    expect(bootstrap.resume).toBeNull();
    expect(bootstrap.progress.firstUnansweredIndex).toBe(0);
    expect(bootstrap.gate).toBe("in_progress");
  });
});
