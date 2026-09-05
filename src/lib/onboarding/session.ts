import type {
  OnboardingAnswer,
  OnboardingSession,
  StudentProfile,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";
import { upsertStudentGoalByCategory } from "@/lib/student/goals";
import { setStudentAttribute } from "@/lib/student/attributes";
import {
  ensureStudentProfile,
  updateStudentProfile,
} from "@/lib/student/profile";
import {
  getClientOnboardingCatalog,
  getOnboardingCatalog,
  getOnboardingQuestion,
  ONBOARDING_VERSION,
  validateOnboardingAnswer,
  type ClientOnboardingQuestion,
  type OnboardingQuestion,
} from "./catalog";

export type OnboardingSessionWithAnswers = OnboardingSession & {
  answers: OnboardingAnswer[];
};

export type OnboardingGateStatus =
  | "needed"
  | "in_progress"
  | "completed"
  | "dismissed";

export type OnboardingBootstrap = {
  gate: OnboardingGateStatus;
  version: string;
  session: {
    id: string;
    status: OnboardingSession["status"];
    version: string;
    startedAt: string;
    completedAt: string | null;
  } | null;
  questions: ClientOnboardingQuestion[];
  answers: Record<
    string,
    { questionId: string; skipped: boolean; answer: unknown | null }
  >;
  progress: {
    total: number;
    answeredOrSkipped: number;
    remaining: number;
    firstUnansweredIndex: number;
  };
};

export async function startOnboardingSession(args: {
  actorUserId: string;
  userId: string;
  /** Ignored from clients — server binds current catalog version. */
  version?: string;
}): Promise<OnboardingSessionWithAnswers> {
  assertResourceOwner(args.userId, args.actorUserId);
  // Server-controlled version only — never trust client-supplied catalog version.
  const version = ONBOARDING_VERSION;
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

export async function resolveOnboardingGate(args: {
  actorUserId: string;
  userId: string;
}): Promise<{
  gate: OnboardingGateStatus;
  profile: StudentProfile;
  inProgress: OnboardingSessionWithAnswers | null;
}> {
  assertResourceOwner(args.userId, args.actorUserId);
  const profile = await ensureStudentProfile(args);

  const inProgress = await prisma.onboardingSession.findFirst({
    where: {
      userId: args.userId,
      status: "IN_PROGRESS",
      version: ONBOARDING_VERSION,
    },
    include: { answers: true },
    orderBy: { startedAt: "desc" },
  });

  if (inProgress) {
    return { gate: "in_progress", profile, inProgress };
  }
  if (profile.onboardingCompletedAt) {
    return { gate: "completed", profile, inProgress: null };
  }
  if (profile.onboardingSkippedAt) {
    return { gate: "dismissed", profile, inProgress: null };
  }
  return { gate: "needed", profile, inProgress: null };
}

function buildAnswerMap(
  answers: OnboardingAnswer[],
): OnboardingBootstrap["answers"] {
  const map: OnboardingBootstrap["answers"] = {};
  for (const answer of answers) {
    map[answer.questionId] = {
      questionId: answer.questionId,
      skipped: answer.skipped,
      answer: answer.skipped ? null : (answer.answerJson ?? null),
    };
  }
  return map;
}

function buildProgress(
  questions: readonly { questionId: string }[],
  answerMap: OnboardingBootstrap["answers"],
): OnboardingBootstrap["progress"] {
  const total = questions.length;
  let answeredOrSkipped = 0;
  let firstUnansweredIndex = total;
  questions.forEach((q, index) => {
    if (answerMap[q.questionId]) {
      answeredOrSkipped += 1;
    } else if (firstUnansweredIndex === total) {
      firstUnansweredIndex = index;
    }
  });
  return {
    total,
    answeredOrSkipped,
    remaining: total - answeredOrSkipped,
    firstUnansweredIndex: Math.min(firstUnansweredIndex, Math.max(total - 1, 0)),
  };
}

export async function getOnboardingBootstrap(args: {
  actorUserId: string;
  userId: string;
  /** When true, start/resume an IN_PROGRESS session for needed/dismissed users. */
  ensureSession?: boolean;
}): Promise<OnboardingBootstrap> {
  assertResourceOwner(args.userId, args.actorUserId);

  const catalog = getClientOnboardingCatalog(ONBOARDING_VERSION);
  const { gate, inProgress } = await resolveOnboardingGate(args);

  let session = inProgress;
  let effectiveGate = gate;

  if (
    args.ensureSession &&
    (gate === "needed" || gate === "dismissed" || gate === "in_progress")
  ) {
    session = await startOnboardingSession(args);
    effectiveGate = "in_progress";
  }

  const answerMap = buildAnswerMap(session?.answers ?? []);
  const progress = buildProgress(catalog.questions, answerMap);

  return {
    gate: effectiveGate,
    version: catalog.version,
    session: session
      ? {
          id: session.id,
          status: session.status,
          version: session.version,
          startedAt: session.startedAt.toISOString(),
          completedAt: session.completedAt?.toISOString() ?? null,
        }
      : null,
    questions: catalog.questions,
    answers: answerMap,
    progress,
  };
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
      if (!mapping.category) {
        throw new ValidationError("Goal mapping requires a category.");
      }
      await upsertStudentGoalByCategory({
        actorUserId: args.actorUserId,
        userId: args.userId,
        title: args.value,
        category: mapping.category,
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

  if (session.version !== ONBOARDING_VERSION) {
    throw new ValidationError(
      "This onboarding session uses an unsupported catalog version.",
    );
  }

  const question = getOnboardingQuestion(args.questionId, session.version);
  const skipped = Boolean(args.skipped);

  if (skipped && !question.skippable) {
    throw new ValidationError("This question cannot be skipped.");
  }

  if (!skipped && args.answer === undefined) {
    throw new ValidationError("An answer is required unless the question is skipped.");
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

/** Post-auth soft-gate destination — never blocks AI after dismiss/complete. */
export async function resolvePostAuthPath(args: {
  actorUserId: string;
  userId: string;
}): Promise<"/onboarding" | "/home"> {
  const { gate } = await resolveOnboardingGate(args);
  if (gate === "needed" || gate === "in_progress") {
    return "/onboarding";
  }
  return "/home";
}
