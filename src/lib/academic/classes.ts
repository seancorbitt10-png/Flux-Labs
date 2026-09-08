import type { Class, ClassStatus, Prisma } from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";
import { assertNoClientAcademicAuthority } from "./authority";
import {
  createClassInputSchema,
  updateClassInputSchema,
} from "./validation";

export type AcademicWriteOptions = {
  db?: Prisma.TransactionClient;
};

function parseOrThrow<T>(
  result: { success: true; data: T } | { success: false; error: { issues: { message: string }[] } },
): T {
  if (!result.success) {
    throw new ValidationError(
      result.error.issues[0]?.message ?? "Invalid academic input.",
    );
  }
  return result.data;
}

/** Load a Class owned by the authenticated user, or not-found. */
export async function getClass(args: {
  actorUserId: string;
  userId: string;
  classId: string;
}): Promise<Class> {
  assertResourceOwner(args.userId, args.actorUserId);

  const row = await prisma.class.findFirst({
    where: { id: args.classId, userId: args.userId },
  });
  if (!row) {
    throw new ValidationError("Class not found.");
  }
  return row;
}

export async function listClasses(args: {
  actorUserId: string;
  userId: string;
  status?: ClassStatus;
}): Promise<Class[]> {
  assertResourceOwner(args.userId, args.actorUserId);

  return prisma.class.findMany({
    where: {
      userId: args.userId,
      ...(args.status ? { status: args.status } : {}),
    },
    orderBy: [{ term: "desc" }, { name: "asc" }],
  });
}

export async function createClass(
  args: {
    actorUserId: string;
    userId: string;
    input: Record<string, unknown>;
  },
  options?: AcademicWriteOptions,
): Promise<Class> {
  assertResourceOwner(args.userId, args.actorUserId);
  assertNoClientAcademicAuthority(args.input);

  const data = parseOrThrow(createClassInputSchema.safeParse(args.input));
  const db = options?.db ?? prisma;

  return db.class.create({
    data: {
      userId: args.userId,
      name: data.name,
      term: data.term,
      status: "ACTIVE",
      courseCode: data.courseCode,
      instructorName: data.instructorName,
      description: data.description,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
    },
  });
}

export async function updateClass(args: {
  actorUserId: string;
  userId: string;
  classId: string;
  input: Record<string, unknown>;
}): Promise<Class> {
  assertResourceOwner(args.userId, args.actorUserId);
  assertNoClientAcademicAuthority(args.input);

  const data = parseOrThrow(updateClassInputSchema.safeParse(args.input));

  // Load owned row first so date invariants use the effective next state,
  // not only the fields present in this request.
  const existing = await prisma.class.findFirst({
    where: { id: args.classId, userId: args.userId },
  });
  if (!existing) {
    throw new ValidationError("Class not found.");
  }

  const nextStartsAt =
    data.startsAt !== undefined ? data.startsAt : existing.startsAt;
  const nextEndsAt = data.endsAt !== undefined ? data.endsAt : existing.endsAt;
  if (nextStartsAt && nextEndsAt && nextStartsAt > nextEndsAt) {
    throw new ValidationError("Class start must be on or before end.");
  }

  // Ownership-scoped update — never mutate by id alone.
  const updated = await prisma.class.updateMany({
    where: { id: args.classId, userId: args.userId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.term !== undefined ? { term: data.term } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.courseCode !== undefined ? { courseCode: data.courseCode } : {}),
      ...(data.instructorName !== undefined
        ? { instructorName: data.instructorName }
        : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.startsAt !== undefined ? { startsAt: data.startsAt } : {}),
      ...(data.endsAt !== undefined ? { endsAt: data.endsAt } : {}),
    },
  });

  if (updated.count !== 1) {
    throw new ValidationError("Class not found.");
  }

  return getClass({
    actorUserId: args.actorUserId,
    userId: args.userId,
    classId: args.classId,
  });
}

export async function archiveClass(args: {
  actorUserId: string;
  userId: string;
  classId: string;
}): Promise<Class> {
  return updateClass({
    actorUserId: args.actorUserId,
    userId: args.userId,
    classId: args.classId,
    input: { status: "ARCHIVED" },
  });
}

/**
 * Delete a Class owned by the user.
 * Tasks are preserved; Task.classId is set to null (ON DELETE SET NULL).
 */
export async function deleteClass(args: {
  actorUserId: string;
  userId: string;
  classId: string;
}): Promise<{ deletedClassId: string; tasksDetached: number }> {
  assertResourceOwner(args.userId, args.actorUserId);

  return prisma.$transaction(async (tx) => {
    const owned = await tx.class.findFirst({
      where: { id: args.classId, userId: args.userId },
      select: { id: true },
    });
    if (!owned) {
      throw new ValidationError("Class not found.");
    }

    const attached = await tx.task.count({
      where: { classId: owned.id, userId: args.userId },
    });

    await tx.class.delete({ where: { id: owned.id } });

    await tx.auditLog.create({
      data: {
        userId: args.userId,
        action: "class.deleted",
        resource: "Class",
        resourceId: owned.id,
        metadata: { tasksDetached: attached },
      },
    });

    return { deletedClassId: owned.id, tasksDetached: attached };
  });
}
