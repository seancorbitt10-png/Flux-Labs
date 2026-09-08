import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PrismaClient } from "@prisma/client";
import { getActiveAttribute } from "@/lib/student/attributes";
import { listStudentGoals } from "@/lib/student/goals";
import {
  startOnboardingSession,
  submitOnboardingAnswer,
} from "@/lib/onboarding/session";

type SetStudentAttributeFn =
  typeof import("@/lib/student/attributes").setStudentAttribute;
type UpsertGoalFn =
  typeof import("@/lib/student/goals").upsertStudentGoalByCategory;

const attributeMocks = vi.hoisted(() => ({
  setStudentAttribute: vi.fn(),
  actual: null as SetStudentAttributeFn | null,
}));

const goalMocks = vi.hoisted(() => ({
  upsertStudentGoalByCategory: vi.fn(),
  actual: null as UpsertGoalFn | null,
}));

vi.mock("@/lib/student/attributes", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/student/attributes")>();
  attributeMocks.actual = actual.setStudentAttribute;
  attributeMocks.setStudentAttribute.mockImplementation(
    actual.setStudentAttribute,
  );
  return {
    ...actual,
    setStudentAttribute: attributeMocks.setStudentAttribute,
  };
});

vi.mock("@/lib/student/goals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/student/goals")>();
  goalMocks.actual = actual.upsertStudentGoalByCategory;
  goalMocks.upsertStudentGoalByCategory.mockImplementation(
    actual.upsertStudentGoalByCategory,
  );
  return {
    ...actual,
    upsertStudentGoalByCategory: goalMocks.upsertStudentGoalByCategory,
  };
});

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
      email: `onb-atomic.${suffix}@fluxlabs.test`,
      name: `Onboarding Atomic ${suffix}`,
      studentProfile: { create: { displayName: `Onboarding Atomic ${suffix}` } },
    },
  });
}

describe("Onboarding answer + Student Model atomicity", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanupTestUsers();
    attributeMocks.setStudentAttribute.mockReset();
    attributeMocks.setStudentAttribute.mockImplementation(
      attributeMocks.actual!,
    );
    goalMocks.upsertStudentGoalByCategory.mockReset();
    goalMocks.upsertStudentGoalByCategory.mockImplementation(
      goalMocks.actual!,
    );
  });

  it("commits OnboardingAnswer and Student Model mutation for mapped answers", async () => {
    const user = await createUser(`mapped-ok-${Date.now()}`);
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

    const answer = await prisma.onboardingAnswer.findUnique({
      where: {
        sessionId_questionId: {
          sessionId: session.id,
          questionId: "academic.level",
        },
      },
    });
    expect(answer?.answerJson).toBe("undergrad");

    const attr = await getActiveAttribute({
      actorUserId: user.id,
      userId: user.id,
      key: "academic.level",
    });
    expect(attr?.valueJson).toBe("undergrad");
    expect(attr?.source).toBe("onboarding");
    expect(attr?.provenance).toBe("EXPLICIT");
  });

  it("commits OnboardingAnswer only for answer-only questions", async () => {
    const user = await createUser(`answer-only-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });

    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "pref.avoid",
      answer: "No slang",
    });

    const answer = await prisma.onboardingAnswer.findUnique({
      where: {
        sessionId_questionId: {
          sessionId: session.id,
          questionId: "pref.avoid",
        },
      },
    });
    expect(answer?.answerJson).toBe("No slang");

    expect(attributeMocks.setStudentAttribute).not.toHaveBeenCalled();
    expect(goalMocks.upsertStudentGoalByCategory).not.toHaveBeenCalled();

    const attrs = await prisma.studentAttribute.count({
      where: { userId: user.id },
    });
    const goals = await prisma.studentGoal.count({
      where: { userId: user.id },
    });
    expect(attrs).toBe(0);
    expect(goals).toBe(0);
  });

  it("rolls back OnboardingAnswer when Student Model mapping fails", async () => {
    const user = await createUser(`sm-fail-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });

    attributeMocks.setStudentAttribute.mockRejectedValueOnce(
      new Error("injected Student Model failure"),
    );

    await expect(
      submitOnboardingAnswer({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: "academic.level",
        answer: "grad",
      }),
    ).rejects.toThrow(/injected Student Model failure/);

    const answer = await prisma.onboardingAnswer.findUnique({
      where: {
        sessionId_questionId: {
          sessionId: session.id,
          questionId: "academic.level",
        },
      },
    });
    expect(answer).toBeNull();

    const attrs = await prisma.studentAttribute.count({
      where: { userId: user.id, key: "academic.level" },
    });
    expect(attrs).toBe(0);

    const profile = await prisma.studentProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(profile.academicLevel).toBeNull();
  });

  it("does not commit Student Model mutation when answer persistence fails", async () => {
    const { prisma: appPrisma } = await import("@/lib/db/prisma");
    const user = await createUser(`answer-fail-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });

    const originalTransaction = appPrisma.$transaction.bind(appPrisma);
    const transactionSpy = vi
      .spyOn(appPrisma, "$transaction")
      .mockImplementationOnce(async (arg) => {
        if (typeof arg !== "function") {
          return originalTransaction(arg as never);
        }
        return originalTransaction(async (tx) => {
          const failingTx = new Proxy(tx, {
            get(target, prop, receiver) {
              if (prop === "onboardingAnswer") {
                return {
                  ...target.onboardingAnswer,
                  upsert: async () => {
                    throw new Error("injected answer persistence failure");
                  },
                };
              }
              return Reflect.get(target, prop, receiver);
            },
          });
          return arg(failingTx as typeof tx);
        });
      });

    try {
      await expect(
        submitOnboardingAnswer({
          actorUserId: user.id,
          userId: user.id,
          sessionId: session.id,
          questionId: "academic.level",
          answer: "hs",
        }),
      ).rejects.toThrow(/injected answer persistence failure/);
    } finally {
      transactionSpy.mockRestore();
    }

    expect(attributeMocks.setStudentAttribute).not.toHaveBeenCalled();

    const answer = await prisma.onboardingAnswer.findUnique({
      where: {
        sessionId_questionId: {
          sessionId: session.id,
          questionId: "academic.level",
        },
      },
    });
    expect(answer).toBeNull();

    const attrs = await prisma.studentAttribute.count({
      where: { userId: user.id },
    });
    expect(attrs).toBe(0);
  });

  it("retries cleanly after a failed mapped transaction without duplicates", async () => {
    const user = await createUser(`retry-${Date.now()}`);
    const session = await startOnboardingSession({
      actorUserId: user.id,
      userId: user.id,
    });

    attributeMocks.setStudentAttribute.mockRejectedValueOnce(
      new Error("injected first-attempt SM failure"),
    );

    await expect(
      submitOnboardingAnswer({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: "academic.subjects",
        answer: ["Biology"],
      }),
    ).rejects.toThrow(/injected first-attempt SM failure/);

    expect(
      await prisma.onboardingAnswer.findUnique({
        where: {
          sessionId_questionId: {
            sessionId: session.id,
            questionId: "academic.subjects",
          },
        },
      }),
    ).toBeNull();

    // Real implementation restored by mockRejectedValueOnce — retry succeeds.
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.subjects",
      answer: ["Biology"],
    });

    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "goal.primary",
      answer: "Ace the midterm",
    });

    // Force a goal-mapping failure, then retry.
    goalMocks.upsertStudentGoalByCategory.mockRejectedValueOnce(
      new Error("injected goal mapping failure"),
    );
    await expect(
      submitOnboardingAnswer({
        actorUserId: user.id,
        userId: user.id,
        sessionId: session.id,
        questionId: "goal.secondary",
        answer: "Stay organized",
      }),
    ).rejects.toThrow(/injected goal mapping failure/);

    expect(
      await prisma.onboardingAnswer.findUnique({
        where: {
          sessionId_questionId: {
            sessionId: session.id,
            questionId: "goal.secondary",
          },
        },
      }),
    ).toBeNull();

    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "goal.secondary",
      answer: "Stay organized",
    });

    const activeSubjects = await prisma.studentAttribute.findMany({
      where: {
        userId: user.id,
        key: "academic.subjects",
        supersededAt: null,
      },
    });
    expect(activeSubjects).toHaveLength(1);
    expect(activeSubjects[0]?.valueJson).toEqual(["Biology"]);

    const goals = await listStudentGoals({
      actorUserId: user.id,
      userId: user.id,
      status: "ACTIVE",
    });
    expect(goals).toHaveLength(2);
    expect(goals.map((g) => g.category).sort()).toEqual([
      "primary",
      "secondary",
    ]);

    // Resubmit mapped answers — still one active attribute / one goal per category.
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "academic.subjects",
      answer: ["Biology", "Chemistry"],
    });
    await submitOnboardingAnswer({
      actorUserId: user.id,
      userId: user.id,
      sessionId: session.id,
      questionId: "goal.primary",
      answer: "Ace the midterm (updated)",
    });

    const activeSubjectsAfter = await prisma.studentAttribute.findMany({
      where: {
        userId: user.id,
        key: "academic.subjects",
        supersededAt: null,
      },
    });
    expect(activeSubjectsAfter).toHaveLength(1);
    expect(activeSubjectsAfter[0]?.valueJson).toEqual([
      "Biology",
      "Chemistry",
    ]);

    const primaryGoals = await prisma.studentGoal.findMany({
      where: {
        userId: user.id,
        category: "primary",
        status: "ACTIVE",
      },
    });
    expect(primaryGoals).toHaveLength(1);
    expect(primaryGoals[0]?.title).toBe("Ace the midterm (updated)");
  });
});
