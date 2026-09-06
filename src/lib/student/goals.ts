import type { GoalStatus, Prisma, StudentGoal } from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";
import {
  clampConfidence,
  defaultConfidenceFor,
} from "@/lib/provenance/policy";
import { rejectClientAuthorityFields } from "./attribute-registry";

const TITLE_MAX = 300;
const DESCRIPTION_MAX = 2000;
const CATEGORY_MAX = 80;

/** Student-authoritative goal writers only. System/AI goal persistence is deferred. */
export type StudentGoalSource = "onboarding" | "settings";

export type CreateGoalInput = {
  actorUserId: string;
  userId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  priority?: number | null;
  targetDate?: Date | null;
  /** Server-controlled source — onboarding | settings only. */
  source: StudentGoalSource;
};

const STUDENT_GOAL_SOURCES = new Set<StudentGoalSource>([
  "onboarding",
  "settings",
]);

export type StudentGoalWriteOptions = {
  /** Optional shared Prisma transaction for callers that need atomic multi-writes. */
  db?: Prisma.TransactionClient;
};

export async function createStudentGoal(
  input: CreateGoalInput,
  options?: StudentGoalWriteOptions,
): Promise<StudentGoal> {
  assertResourceOwner(input.userId, input.actorUserId);

  const bag = input as Record<string, unknown>;
  if (
    "provenance" in bag ||
    "confidence" in bag ||
    Object.prototype.hasOwnProperty.call(bag, "systemProvenance")
  ) {
    rejectClientAuthorityFields({
      provenance: bag.provenance,
      confidence: bag.confidence,
      source: bag.source,
    });
  }

  if (!STUDENT_GOAL_SOURCES.has(input.source)) {
    throw new ValidationError(
      "Goals require an authorized student-originated path (onboarding/settings). System/AI cannot create EXPLICIT goals.",
    );
  }

  // Defense against residual runtime "system" strings.
  if ((input.source as string) === "system") {
    throw new ValidationError(
      "System/AI actors cannot create StudentGoal records in Phase 2.",
    );
  }

  const title = input.title?.trim();
  if (!title || title.length > TITLE_MAX) {
    throw new ValidationError("Goal title is required and must be under 300 characters.");
  }
  if (input.description && input.description.length > DESCRIPTION_MAX) {
    throw new ValidationError("Goal description is too long.");
  }
  if (input.category && input.category.length > CATEGORY_MAX) {
    throw new ValidationError("Goal category is too long.");
  }

  // Server-controlled authority — EXPLICIT only for student-originated paths.
  const provenance = "EXPLICIT" as const;
  const confidence = clampConfidence(defaultConfidenceFor(provenance));
  const db = options?.db ?? prisma;

  return db.studentGoal.create({
    data: {
      userId: input.userId,
      title,
      description: input.description?.trim() || null,
      category: input.category?.trim() || null,
      priority: input.priority ?? null,
      targetDate: input.targetDate ?? null,
      status: "ACTIVE",
      provenance,
      confidence,
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

/**
 * Upsert an ACTIVE onboarding/settings goal by category.
 * Re-answering onboarding updates the existing category goal instead of minting duplicates.
 */
export async function upsertStudentGoalByCategory(
  input: CreateGoalInput & { category: string },
  options?: StudentGoalWriteOptions,
): Promise<StudentGoal> {
  assertResourceOwner(input.userId, input.actorUserId);

  if (!STUDENT_GOAL_SOURCES.has(input.source)) {
    throw new ValidationError(
      "Goals require an authorized student-originated path (onboarding/settings). System/AI cannot create EXPLICIT goals.",
    );
  }

  const title = input.title?.trim();
  if (!title || title.length > TITLE_MAX) {
    throw new ValidationError("Goal title is required and must be under 300 characters.");
  }
  if (input.description && input.description.length > DESCRIPTION_MAX) {
    throw new ValidationError("Goal description is too long.");
  }
  if (input.category.length > CATEGORY_MAX) {
    throw new ValidationError("Goal category is too long.");
  }

  const db = options?.db ?? prisma;
  const existing = await db.studentGoal.findFirst({
    where: {
      userId: input.userId,
      category: input.category,
      status: "ACTIVE",
    },
    orderBy: { createdAt: "desc" },
  });

  const provenance = "EXPLICIT" as const;
  const confidence = clampConfidence(defaultConfidenceFor(provenance));

  if (existing) {
    return db.studentGoal.update({
      where: { id: existing.id },
      data: {
        title,
        description: input.description?.trim() || null,
        priority: input.priority ?? existing.priority,
        targetDate: input.targetDate ?? existing.targetDate,
        // Preserve EXPLICIT authority; refresh source to current student path.
        provenance,
        confidence,
        source: input.source,
      },
    });
  }

  return createStudentGoal(input, options);
}

export async function updateStudentGoalStatus(args: {
  actorUserId: string;
  userId: string;
  goalId: string;
  status: GoalStatus;
}): Promise<StudentGoal> {
  assertResourceOwner(args.userId, args.actorUserId);

  const bag = args as Record<string, unknown>;
  if ("provenance" in bag || "confidence" in bag) {
    rejectClientAuthorityFields({
      provenance: bag.provenance,
      confidence: bag.confidence,
      source: bag.source,
    });
  }

  const goal = await prisma.studentGoal.findUnique({ where: { id: args.goalId } });
  if (!goal || goal.userId !== args.userId) {
    throw new ValidationError("Goal not found.");
  }

  return prisma.studentGoal.update({
    where: { id: goal.id },
    data: { status: args.status } satisfies Prisma.StudentGoalUpdateInput,
  });
}
