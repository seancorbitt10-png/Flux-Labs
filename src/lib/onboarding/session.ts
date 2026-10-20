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
  validateOnboardingResumeDraft,
  type OnboardingResumeState,
} from "./defer-draft";
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
  /** Durable defer cursor + unfinished draft. Null for never-deferred sessions. */
  resume: OnboardingResumeState | null;
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

function parseStoredResume(
  session: OnboardingSession | null | undefined,
  questions: readonly ClientOnboardingQuestion[],
): OnboardingResumeState | null {
  if (!session) return null;
  if (session.version !== ONBOARDING_VERSION) return null;
  if (
    session.resumeQuestionIndex == null ||
    session.resumeQuestionId == null ||
    session.resumeDraftJson == null
  ) {
    return null;
  }

  const index = session.resumeQuestionIndex;
  const question = questions[index];
  if (!question || question.questionId !== session.resumeQuestionId) {
    return null;
  }

  const raw = session.resumeDraftJson;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const bag = raw as Record<string, unknown>;
  try {
    const validated = validateOnboardingResumeDraft(
      question,
      bag.draft,
      bag.tagInput ?? "",
    );
    return {
      questionIndex: index,
      questionId: question.questionId,
      draft: validated.draft,
      tagInput: validated.tagInput,
    };
  } catch {
    return null;
  }
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
  const resume = parseStoredResume(session, catalog.questions);

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
    resume,
  };
}

const RESUME_CLEAR = {
  resumeQuestionIndex: null,
  resumeQuestionId: null,
  resumeDraftJson: Prisma.DbNull,
} as const;

async function clearResumeIfQuestionMatches(
  db: Prisma.TransactionClient | typeof prisma,
  session: OnboardingSession,
  questionId: string,
): Promise<void> {
  if (session.resumeQuestionId !== questionId) return;
  await db.onboardingSession.updateMany({
    where: {
      id: session.id,
      userId: session.userId,
      status: "IN_PROGRESS",
    },
    data: { ...RESUME_CLEAR },
  });
}

export async function saveOnboardingResumeState(args: {
  actorUserId: string;
  userId: string;
  sessionId: string;
  questionId: string;
  questionIndex: number;
  draft: unknown;
  tagInput?: string;
}): Promise<OnboardingResumeState> {
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

  const catalog = getClientOnboardingCatalog(session.version);
  if (
    !Number.isInteger(args.questionIndex) ||
    args.questionIndex < 0 ||
    args.questionIndex >= catalog.questions.length
  ) {
    throw new ValidationError("Invalid setup question position.");
  }

  const question = catalog.questions[args.questionIndex];
  if (!question || question.questionId !== args.questionId) {
    throw new ValidationError("Setup question does not match the catalog.");
  }

  // Confirm the ID is in the authoritative catalog (rejects unknown IDs).
  getOnboardingQuestion(args.questionId, session.version);

  const validated = validateOnboardingResumeDraft(
    question,
    args.draft,
    args.tagInput ?? "",
  );

  const updated = await prisma.onboardingSession.updateMany({
    where: {
      id: session.id,
      userId: args.userId,
      status: "IN_PROGRESS",
      version: ONBOARDING_VERSION,
    },
    data: {
      resumeQuestionIndex: args.questionIndex,
      resumeQuestionId: question.questionId,
      resumeDraftJson: {
        draft: validated.draft as Prisma.InputJsonValue,
        tagInput: validated.tagInput,
      },
    },
  });

  if (updated.count !== 1) {
    throw new ValidationError(
      "Could not save setup progress. The session is no longer active.",
    );
  }

  return {
    questionIndex: args.questionIndex,
    questionId: question.questionId,
    draft: validated.draft,
    tagInput: validated.tagInput,
  };
}

async function applyAnswerMapping(args: {
  actorUserId: string;
  userId: string;
  question: OnboardingQuestion;
  value: unknown;
  db: Prisma.TransactionClient;
}): Promise<void> {
  const { mapping } = args.question;
  const writeOpts = { db: args.db };
  switch (mapping.kind) {
    case "none":
      return;
    case "attribute":
      await setStudentAttribute(
        {
          actorUserId: args.actorUserId,
          userId: args.userId,
          key: mapping.key,
          value: args.value,
          writer: "onboarding",
        },
        writeOpts,
      );
      if (mapping.key === "academic.level" && typeof args.value === "string") {
        await updateStudentProfile(
          {
            actorUserId: args.actorUserId,
            userId: args.userId,
            data: { academicLevel: args.value },
          },
          writeOpts,
        );
      }
      if (
        mapping.key === "pref.assistance_style" &&
        typeof args.value === "string"
      ) {
        await updateStudentProfile(
          {
            actorUserId: args.actorUserId,
            userId: args.userId,
            data: { preferredAssistanceStyle: args.value },
          },
          writeOpts,
        );
      }
      return;
    case "goal":
      if (typeof args.value !== "string") {
        throw new ValidationError("Goal answer must be a string.");
      }
      if (!mapping.category) {
        throw new ValidationError("Goal mapping requires a category.");
      }
      await upsertStudentGoalByCategory(
        {
          actorUserId: args.actorUserId,
          userId: args.userId,
          title: args.value,
          category: mapping.category,
          source: "onboarding",
        },
        writeOpts,
      );
      return;
    case "profile":
      if (typeof args.value !== "string") {
        throw new ValidationError("Profile answer must be a string.");
      }
      await updateStudentProfile(
        {
          actorUserId: args.actorUserId,
          userId: args.userId,
          data: { [mapping.field]: args.value },
        },
        writeOpts,
      );
      return;
  }
}

function answerPayload(
  skipped: boolean,
  validated: unknown | null,
): {
  skipped: boolean;
  answerJson: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined;
} {
  return {
    skipped,
    answerJson:
      validated === null
        ? undefined
        : (validated as Prisma.InputJsonValue),
  };
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

  const requiresStudentModelMapping =
    !skipped && validated !== null && question.mapping.kind !== "none";

  // Answer-only / skipped: OnboardingAnswer only — no Student Model mutation.
  if (!requiresStudentModelMapping) {
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
        ...answerPayload(skipped, validated),
      },
      update: {
        skipped,
        answerJson:
          validated === null
            ? Prisma.DbNull
            : (validated as Prisma.InputJsonValue),
      },
    });
    await clearResumeIfQuestionMatches(prisma, session, question.questionId);
    return answer;
  }

  // Mapped answers: OnboardingAnswer + authorized Student Model write are atomic.
  // Either both commit or neither does (shared Prisma interactive transaction).
  return prisma.$transaction(async (tx) => {
    const answer = await tx.onboardingAnswer.upsert({
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
        answerJson: validated as Prisma.InputJsonValue,
      },
      update: {
        skipped,
        answerJson: validated as Prisma.InputJsonValue,
      },
    });

    await applyAnswerMapping({
      actorUserId: args.actorUserId,
      userId: args.userId,
      question,
      value: validated,
      db: tx,
    });

    await clearResumeIfQuestionMatches(tx, session, question.questionId);

    return answer;
  });
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
      ...RESUME_CLEAR,
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
      ...RESUME_CLEAR,
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

/**
 * Post-auth soft-gate destination.
 * First-time users (never started) go to Academic setup.
 * In-progress / deferred sessions do not trap the student — they use the app
 * and resume from nav. Dismissed and completed also go home.
 */
export async function resolvePostAuthPath(args: {
  actorUserId: string;
  userId: string;
}): Promise<"/onboarding" | "/home"> {
  const { gate } = await resolveOnboardingGate(args);
  if (gate === "needed") {
    return "/onboarding";
  }
  return "/home";
}
