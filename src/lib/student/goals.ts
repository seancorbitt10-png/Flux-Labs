import type { GoalStatus, Prisma, StudentGoal } from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";
import {
  clampConfidence,
  defaultConfidenceFor,
} from "@/lib/provenance/policy";

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const CATEGORY_MAX = 80;

export type CreateGoalInput = {
  actorUserId: string;
  userId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  priority?: number | null;
  targetDate?: Date | null;
  /** Server-controlled source label, e.g. onboarding | settings */
  source: "onboarding" | "settings" | "system";
};

export async function createStudentGoal(
  input: CreateGoalInput,
): Promise<StudentGoal> {
  assertResourceOwner(input.userId, input.actorUserId);

  const title = input.title?.trim();
  if (!title || title.length > TITLE_MAX) {
    throw new ValidationError("Goal title is required and must be under 200 characters.");
  }
  if (input.description && input.description.length > DESCRIPTION_MAX) {
    throw new ValidationError("Goal description is too long.");
  }
  if (input.category && input.category.length > CATEGORY_MAX) {
    throw new ValidationError("Goal category is too long.");
  }

  return prisma.studentGoal.create({
    data: {
      userId: input.userId,
      title,
      description: input.description?.trim() || null,
      category: input.category?.trim() || null,
      priority: input.priority ?? null,
      targetDate: input.targetDate ?? null,
      status: "ACTIVE",
      provenance: "EXPLICIT",
      confidence: clampConfidence(defaultConfidenceFor("EXPLICIT")),
      source: input.source,
    },
  });
}

export async function listStudentGoals(args: {
  actorUserId: string;
  userId: string;
  status?: GoalStatus;
}): Promise<StudentGoal[]> {
  assertResourceOwner(args.userId, args.actorUserId);

  return prisma.studentGoal.findMany({
    where: {
      userId: args.userId,
      ...(args.status ? { status: args.status } : {}),
    },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  });
}

export async function updateStudentGoalStatus(args: {
  actorUserId: string;
  userId: string;
  goalId: string;
  status: GoalStatus;
}): Promise<StudentGoal> {
  assertResourceOwner(args.userId, args.actorUserId);

  const goal = await prisma.studentGoal.findUnique({ where: { id: args.goalId } });
  if (!goal || goal.userId !== args.userId) {
    throw new ValidationError("Goal not found.");
  }

  return prisma.studentGoal.update({
    where: { id: goal.id },
    data: { status: args.status } satisfies Prisma.StudentGoalUpdateInput,
  });
}
