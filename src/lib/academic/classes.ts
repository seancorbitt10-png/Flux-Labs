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

  try {
    return await prisma.$transaction(async (tx) => {
      // Row lock prevents concurrent partial updates from racing past
      // application-level date validation. DB CHECK is the final backstop.
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          userId: string;
          name: string;
          term: string;
          status: ClassStatus;
          courseCode: string | null;
          instructorName: string | null;
          description: string | null;
          startsAt: Date | null;
          endsAt: Date | null;
          createdAt: Date;
          updatedAt: Date;
        }>
      >`
        SELECT *
        FROM classes
        WHERE id = ${args.classId} AND "userId" = ${args.userId}
        FOR UPDATE
      `;

      const existing = locked[0];
      if (!existing) {
        throw new ValidationError("Class not found.");
      }

      const nextStartsAt =
        data.startsAt !== undefined ? data.startsAt : existing.startsAt;
      const nextEndsAt =
        data.endsAt !== undefined ? data.endsAt : existing.endsAt;
      if (nextStartsAt && nextEndsAt && nextStartsAt > nextEndsAt) {
        throw new ValidationError("Class start must be on or before end.");
      }

      const updated = await tx.class.updateMany({
        where: { id: args.classId, userId: args.userId },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.term !== undefined ? { term: data.term } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.courseCode !== undefined
            ? { courseCode: data.courseCode }
            : {}),
          ...(data.instructorName !== undefined
            ? { instructorName: data.instructorName }
            : {}),
          ...(data.description !== undefined
            ? { description: data.description }
            : {}),
          ...(data.startsAt !== undefined ? { startsAt: data.startsAt } : {}),
          ...(data.endsAt !== undefined ? { endsAt: data.endsAt } : {}),
        },
      });

      if (updated.count !== 1) {
        throw new ValidationError("Class not found.");
      }

      const row = await tx.class.findFirst({
        where: { id: args.classId, userId: args.userId },
      });
      if (!row) {
        throw new ValidationError("Class not found.");
      }
      return row;
    });
  } catch (error) {
    if (isClassDateCheckViolation(error)) {
      throw new ValidationError("Class start must be on or before end.");
    }
    throw error;
  }
}

function isClassDateCheckViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  const meta =
    "meta" in error && error.meta && typeof error.meta === "object"
      ? (error.meta as Record<string, unknown>)
      : null;
  const metaMessage =
    meta && typeof meta.message === "string" ? meta.message : "";
  const combined = `${message} ${metaMessage}`;
  return (
    combined.includes("classes_starts_before_ends_check") ||
    (combined.includes("check constraint") &&
      combined.includes("startsAt") &&
      combined.includes("endsAt"))
  );
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
