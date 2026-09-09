import type { Prisma, Task, TaskStatus } from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";
import { assertNoClientAcademicAuthority } from "./authority";
import { attachTaskConcepts } from "./task-concepts";
import {
  assertValidTaskStatusTransition,
  completedAtForStatus,
} from "./status";
import {
  createTaskInputSchema,
  updateTaskInputSchema,
} from "./validation";

export type AcademicWriteOptions = {
  db?: Prisma.TransactionClient;
};

export type TaskWithConcepts = Task & {
  taskConcepts: Array<{ conceptId: string; createdAt: Date }>;
};

function parseOrThrow<T>(
  result:
    | { success: true; data: T }
    | { success: false; error: { issues: { message: string }[] } },
): T {
  if (!result.success) {
    throw new ValidationError(
      result.error.issues[0]?.message ?? "Invalid academic input.",
    );
  }
  return result.data;
}

async function assertOwnedClassId(args: {
  db: Prisma.TransactionClient | typeof prisma;
  userId: string;
  classId: string;
}): Promise<void> {
  const row = await args.db.class.findFirst({
    where: { id: args.classId, userId: args.userId },
    select: { id: true },
  });
  if (!row) {
    throw new ValidationError("Class not found.");
  }
}

export async function getTask(args: {
  actorUserId: string;
  userId: string;
  taskId: string;
}): Promise<TaskWithConcepts> {
  assertResourceOwner(args.userId, args.actorUserId);

  const row = await prisma.task.findFirst({
    where: { id: args.taskId, userId: args.userId },
    include: {
      taskConcepts: {
        select: { conceptId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!row) {
    throw new ValidationError("Task not found.");
  }
  return row;
}

export async function listTasks(args: {
  actorUserId: string;
  userId: string;
  status?: TaskStatus;
  classId?: string | null;
}): Promise<Task[]> {
  assertResourceOwner(args.userId, args.actorUserId);

  if (args.classId) {
    await assertOwnedClassId({
      db: prisma,
      userId: args.userId,
      classId: args.classId,
    });
  }

  return prisma.task.findMany({
    where: {
      userId: args.userId,
      ...(args.status ? { status: args.status } : {}),
      ...(args.classId ? { classId: args.classId } : {}),
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
  });
}

export async function createTask(args: {
  actorUserId: string;
  userId: string;
  input: Record<string, unknown>;
}): Promise<TaskWithConcepts> {
  assertResourceOwner(args.userId, args.actorUserId);
  assertNoClientAcademicAuthority(args.input);

  const data = parseOrThrow(createTaskInputSchema.safeParse(args.input));
  const initialStatus: TaskStatus = data.status ?? "TODO";
  if (initialStatus !== "TODO" && initialStatus !== "IN_PROGRESS") {
    // New tasks start open; completion/cancel must be an explicit transition.
    throw new ValidationError(
      "New tasks must start as TODO or IN_PROGRESS.",
    );
  }

  return prisma.$transaction(async (tx) => {
    if (data.classId) {
      await assertOwnedClassId({
        db: tx,
        userId: args.userId,
        classId: data.classId,
      });
    }

    const created = await tx.task.create({
      data: {
        userId: args.userId,
        classId: data.classId,
        title: data.title,
        description: data.description,
        status: initialStatus,
        dueAt: data.dueAt,
        startsAt: data.startsAt,
        priority: data.priority,
        estimatedMinutes: data.estimatedMinutes,
        completedAt: null,
      },
    });

    if (data.conceptIds && data.conceptIds.length > 0) {
      await attachTaskConcepts({
        actorUserId: args.actorUserId,
        userId: args.userId,
        taskId: created.id,
        conceptIds: data.conceptIds,
        db: tx,
      });
    }

    return getTaskInTx(tx, args.userId, created.id);
  });
}

async function getTaskInTx(
  db: Prisma.TransactionClient,
  userId: string,
  taskId: string,
): Promise<TaskWithConcepts> {
  const row = await db.task.findFirst({
    where: { id: taskId, userId },
    include: {
      taskConcepts: {
        select: { conceptId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!row) {
    throw new ValidationError("Task not found.");
  }
  return row;
}

export async function updateTask(args: {
  actorUserId: string;
  userId: string;
  taskId: string;
  input: Record<string, unknown>;
}): Promise<TaskWithConcepts> {
  assertResourceOwner(args.userId, args.actorUserId);
  assertNoClientAcademicAuthority(args.input);

  const data = parseOrThrow(updateTaskInputSchema.safeParse(args.input));

  return prisma.$transaction(async (tx) => {
    const existing = await tx.task.findFirst({
      where: { id: args.taskId, userId: args.userId },
    });
    if (!existing) {
      throw new ValidationError("Task not found.");
    }

    if (data.classId !== undefined && data.classId !== null) {
      await assertOwnedClassId({
        db: tx,
        userId: args.userId,
        classId: data.classId,
      });
    }

    let nextStatus = existing.status;
    let nextCompletedAt = existing.completedAt;

    if (data.status !== undefined) {
      assertValidTaskStatusTransition(existing.status, data.status);
      nextStatus = data.status;
      nextCompletedAt = completedAtForStatus(data.status);
    }

    // Defense: non-COMPLETED must never retain completedAt.
    if (nextStatus !== "COMPLETED") {
      nextCompletedAt = null;
    } else if (!nextCompletedAt) {
      nextCompletedAt = new Date();
    }

    const startsAt =
      data.startsAt !== undefined ? data.startsAt : existing.startsAt;
    const dueAt = data.dueAt !== undefined ? data.dueAt : existing.dueAt;
    if (startsAt && dueAt && startsAt > dueAt) {
      throw new ValidationError("Task start must be on or before due date.");
    }

    await tx.task.updateMany({
      where: { id: existing.id, userId: args.userId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.classId !== undefined ? { classId: data.classId } : {}),
        status: nextStatus,
        completedAt: nextCompletedAt,
        ...(data.dueAt !== undefined ? { dueAt: data.dueAt } : {}),
        ...(data.startsAt !== undefined ? { startsAt: data.startsAt } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.estimatedMinutes !== undefined
          ? { estimatedMinutes: data.estimatedMinutes }
          : {}),
      },
    });

    return getTaskInTx(tx, args.userId, existing.id);
  });
}

export async function transitionTaskStatus(args: {
  actorUserId: string;
  userId: string;
  taskId: string;
  status: TaskStatus;
}): Promise<TaskWithConcepts> {
  return updateTask({
    actorUserId: args.actorUserId,
    userId: args.userId,
    taskId: args.taskId,
    input: { status: args.status },
  });
}

/**
 * Delete a Task owned by the user.
 * TaskConcept rows cascade. Does not mutate Student Model / AI proposals.
 */
export async function deleteTask(args: {
  actorUserId: string;
  userId: string;
  taskId: string;
}): Promise<{ deletedTaskId: string }> {
  assertResourceOwner(args.userId, args.actorUserId);

  const result = await prisma.task.deleteMany({
    where: { id: args.taskId, userId: args.userId },
  });
  if (result.count !== 1) {
    throw new ValidationError("Task not found.");
  }

  await prisma.auditLog.create({
    data: {
      userId: args.userId,
      action: "task.deleted",
      resource: "Task",
      resourceId: args.taskId,
    },
  });

  return { deletedTaskId: args.taskId };
}
