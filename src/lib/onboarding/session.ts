import type {
  OnboardingAnswer,
  OnboardingSession,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";
import { createStudentGoal } from "@/lib/student/goals";
import { setStudentAttribute } from "@/lib/student/attributes";
import { ensureStudentProfile, updateStudentProfile } from "@/lib/student/profile";
import {
  getOnboardingCatalog,
  getOnboardingQuestion,
  ONBOARDING_VERSION,
  validateOnboardingAnswer,
  type OnboardingQuestion,
} from "./catalog";

export type OnboardingSessionWithAnswers = OnboardingSession & {
  answers: OnboardingAnswer[];
};

export async function startOnboardingSession(args: {
  actorUserId: string;
  userId: string;
  version?: string;
}): Promise<OnboardingSessionWithAnswers> {
  assertResourceOwner(args.userId, args.actorUserId);
  const version = args.version ?? ONBOARDING_VERSION;
  getOnboardingCatalog(version);

  await ensureStudentProfile(args);

  const existing = await prisma.onboardingSession.findFirst({
    where: {
      userId: args.userId,
      status: "IN_PROGRESS",
      version,
    },
    include: { answers: true },
    orderBy: { startedAt: "desc" },
  });
  if (existing) return existing;

  return prisma.onboardingSession.create({
    data: {
      userId: args.userId,
      version,
      status: "IN_PROGRESS",
    },
    include: { answers: true },
  });
}

export async function getOnboardingSessionForUser(args: {
  actorUserId: string;
  userId: string;
  sessionId: string;
}): Promise<OnboardingSessionWithAnswers> {
  assertResourceOwner(args.userId, args.actorUserId);
  const session = await prisma.onboardingSession.findUnique({
    where: { id: args.sessionId },
    include: { answers: true },
  });
  if (!session || session.userId !== args.userId) {
    throw new ValidationError("Onboarding session not found.");
  }
  return session;
}

async function applyAnswerMapping(args: {
  actorUserId: string;
  userId: string;
  question: OnboardingQuestion;
  value: unknown;
}): Promise<void> {
  const { mapping } = args.question;
  switch (mapping.kind) {
    case "none":
      return;
    case "attribute":
      await setStudentAttribute({
        actorUserId: args.actorUserId,
        userId: args.userId,
        key: mapping.key,
        value: args.value,
        writer: "onboarding",
      });
      if (mapping.key === "academic.level" && typeof args.value === "string") {
        await updateStudentProfile({
          actorUserId: args.actorUserId,
          userId: args.userId,
          data: { academicLevel: args.value },
        });
      }
      if (
        mapping.key === "pref.assistance_style" &&
        typeof args.value === "string"
      ) {
        await updateStudentProfile({
          actorUserId: args.actorUserId,
          userId: args.userId,
          data: { preferredAssistanceStyle: args.value },
        });
      }
      return;
    case "goal":
      if (typeof args.value !== "string") {
        throw new ValidationError("Goal answer must be a string.");
      }
      await createStudentGoal({
        actorUserId: args.actorUserId,
        userId: args.userId,
        title: args.value,
        category: mapping.category ?? null,
        source: "onboarding",
      });
      return;
    case "profile":
      if (typeof args.value !== "string") {
        throw new ValidationError("Profile answer must be a string.");
      }
      await updateStudentProfile({
        actorUserId: args.actorUserId,
        userId: args.userId,
        data: { [mapping.field]: args.value },
      });
      return;
  }
}

export async function submitOnboardingAnswer(args: {
  actorUserId: string;
  userId: string;
  sessionId: string;
  questionId: string;
  answer?: unknown;
  skipped?: boolean;
}): Promise<OnboardingAnswer> {
  assertResourceOwner(args.userId, args.actorUserId);

  const session = await getOnboardingSessionForUser({
    actorUserId: args.actorUserId,
    userId: args.userId,
    sessionId: args.sessionId,
  });

  if (session.status !== "IN_PROGRESS") {
    throw new ValidationError("Onboarding session is not in progress.");
  }

  const question = getOnboardingQuestion(args.questionId, session.version);
  const skipped = Boolean(args.skipped);

  if (skipped && !question.skippable) {
    throw new ValidationError("This question cannot be skipped.");
  }

  const validated = validateOnboardingAnswer(
    question,
    args.answer,
    skipped,
  );

  const answer = await prisma.onboardingAnswer.upsert({
    where: {
      sessionId_questionId: {
        sessionId: session.id,
        questionId: question.questionId,
      },
    },
    create: {
      sessionId: session.id,
      questionId: question.questionId,
      skipped,
      answerJson:
        validated === null
          ? undefined
          : (validated as Prisma.InputJsonValue),
    },
    update: {
      skipped,
      answerJson:
        validated === null
          ? Prisma.DbNull
          : (validated as Prisma.InputJsonValue),
    },
  });

  if (!skipped && validated !== null) {
    await applyAnswerMapping({
      actorUserId: args.actorUserId,
      userId: args.userId,
      question,
      value: validated,
    });
  }

  return answer;
}

export async function completeOnboardingSession(args: {
  actorUserId: string;
  userId: string;
  sessionId: string;
}): Promise<OnboardingSessionWithAnswers> {
  assertResourceOwner(args.userId, args.actorUserId);
  const session = await getOnboardingSessionForUser(args);

  if (session.status !== "IN_PROGRESS") {
    throw new ValidationError("Onboarding session is not in progress.");
  }

  const completed = await prisma.onboardingSession.update({
    where: { id: session.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
    include: { answers: true },
  });

  await updateStudentProfile({
    actorUserId: args.actorUserId,
    userId: args.userId,
    data: {
      onboardingCompletedAt: new Date(),
      onboardingVersion: session.version,
      onboardingSkippedAt: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: args.userId,
      action: "onboarding.completed",
      resource: "OnboardingSession",
      resourceId: session.id,
      metadata: { version: session.version },
    },
  });

  return completed;
}

export async function dismissOnboardingSession(args: {
  actorUserId: string;
  userId: string;
  sessionId: string;
}): Promise<OnboardingSessionWithAnswers> {
  assertResourceOwner(args.userId, args.actorUserId);
  const session = await getOnboardingSessionForUser(args);

  if (session.status !== "IN_PROGRESS") {
    throw new ValidationError("Onboarding session is not in progress.");
  }

  const dismissed = await prisma.onboardingSession.update({
    where: { id: session.id },
    data: {
      status: "DISMISSED",
      completedAt: new Date(),
    },
    include: { answers: true },
  });

  await updateStudentProfile({
    actorUserId: args.actorUserId,
    userId: args.userId,
    data: {
      onboardingSkippedAt: new Date(),
      onboardingVersion: session.version,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: args.userId,
      action: "onboarding.dismissed",
      resource: "OnboardingSession",
      resourceId: session.id,
      metadata: { version: session.version },
    },
  });

  return dismissed;
}
