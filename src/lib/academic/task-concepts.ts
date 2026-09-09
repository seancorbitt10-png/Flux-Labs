import type { Prisma, TaskConcept } from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";
import { assertNoClientAcademicAuthority } from "./authority";
import { taskConceptIdsSchema } from "./validation";

/**
 * Validate concept IDs are readable by the actor:
 * SYSTEM catalog or USER concepts owned by the same student.
 * Unauthorized / missing → not-found (no existence leak for foreign USER concepts).
 */
async function assertLinkableConcepts(args: {
  db: Prisma.TransactionClient | typeof prisma;
  actorUserId: string;
  conceptIds: string[];
}): Promise<void> {
  const unique = [...new Set(args.conceptIds)];
  const concepts = await args.db.concept.findMany({
    where: { id: { in: unique } },
    select: { id: true, source: true, createdByUserId: true },
  });
  const byId = new Map(concepts.map((c) => [c.id, c]));

  for (const id of unique) {
    const concept = byId.get(id);
    if (!concept) {
      throw new ValidationError("Concept not found.");
    }
    if (
      concept.source === "USER" &&
      concept.createdByUserId !== args.actorUserId
    ) {
      throw new ValidationError("Concept not found.");
    }
  }
}

async function assertOwnedTask(args: {
  db: Prisma.TransactionClient | typeof prisma;
  userId: string;
  taskId: string;
}): Promise<void> {
  const task = await args.db.task.findFirst({
    where: { id: args.taskId, userId: args.userId },
    select: { id: true },
  });
  if (!task) {
    throw new ValidationError("Task not found.");
  }
}

export async function listTaskConcepts(args: {
  actorUserId: string;
  userId: string;
  taskId: string;
}): Promise<TaskConcept[]> {
  assertResourceOwner(args.userId, args.actorUserId);
  await assertOwnedTask({
    db: prisma,
    userId: args.userId,
    taskId: args.taskId,
  });

  return prisma.taskConcept.findMany({
    where: { taskId: args.taskId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Attach concepts to an owned Task. Idempotent for existing pairs.
 */
export async function attachTaskConcepts(args: {
  actorUserId: string;
  userId: string;
  taskId: string;
  conceptIds: string[];
  db?: Prisma.TransactionClient;
}): Promise<TaskConcept[]> {
  assertResourceOwner(args.userId, args.actorUserId);

  const bag = { conceptIds: args.conceptIds };
  assertNoClientAcademicAuthority(bag as Record<string, unknown>);

  const parsed = taskConceptIdsSchema.safeParse(bag);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "Invalid concept IDs.",
    );
  }

  const db = args.db ?? prisma;
  await assertOwnedTask({
    db,
    userId: args.userId,
    taskId: args.taskId,
  });
  await assertLinkableConcepts({
    db,
    actorUserId: args.actorUserId,
    conceptIds: parsed.data.conceptIds,
  });

  await db.taskConcept.createMany({
    data: parsed.data.conceptIds.map((conceptId) => ({
      taskId: args.taskId,
      conceptId,
    })),
    skipDuplicates: true,
  });

  return db.taskConcept.findMany({
    where: {
      taskId: args.taskId,
      conceptId: { in: parsed.data.conceptIds },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function detachTaskConcepts(args: {
  actorUserId: string;
  userId: string;
  taskId: string;
  conceptIds: string[];
}): Promise<{ detached: number }> {
  assertResourceOwner(args.userId, args.actorUserId);

  const parsed = taskConceptIdsSchema.safeParse({
    conceptIds: args.conceptIds,
  });
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "Invalid concept IDs.",
    );
  }

  await assertOwnedTask({
    db: prisma,
    userId: args.userId,
    taskId: args.taskId,
  });

  const result = await prisma.taskConcept.deleteMany({
    where: {
      taskId: args.taskId,
      conceptId: { in: parsed.data.conceptIds },
    },
  });

  return { detached: result.count };
}
