import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { listClasses } from "./classes";
import { listTasks } from "./tasks";
import {
  toClassOption,
  toClassView,
  toTaskView,
  type ClassOption,
  type ClassView,
  type TaskView,
} from "./views";

export type ClassesWorkspaceBootstrap = {
  classes: ClassView[];
  timezone: string;
};

export type TasksWorkspaceBootstrap = {
  tasks: TaskView[];
  classOptions: ClassOption[];
  timezone: string;
};

async function studentTimezone(userId: string): Promise<string> {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  return profile?.timezone?.trim() || "UTC";
}

export async function getClassesWorkspaceBootstrap(args: {
  actorUserId: string;
  userId: string;
}): Promise<ClassesWorkspaceBootstrap> {
  assertResourceOwner(args.userId, args.actorUserId);
  const [classes, timezone] = await Promise.all([
    listClasses({
      actorUserId: args.actorUserId,
      userId: args.userId,
    }),
    studentTimezone(args.userId),
  ]);
  return {
    classes: classes.map(toClassView),
    timezone,
  };
}

export async function getTasksWorkspaceBootstrap(args: {
  actorUserId: string;
  userId: string;
}): Promise<TasksWorkspaceBootstrap> {
  assertResourceOwner(args.userId, args.actorUserId);
  const [tasks, classes, timezone] = await Promise.all([
    listTasks({
      actorUserId: args.actorUserId,
      userId: args.userId,
    }),
    listClasses({
      actorUserId: args.actorUserId,
      userId: args.userId,
    }),
    studentTimezone(args.userId),
  ]);

  const nameById = new Map(classes.map((c) => [c.id, c.name]));
  return {
    tasks: tasks.map((t) => toTaskView(t, t.classId ? nameById.get(t.classId) ?? null : null)),
    classOptions: classes.map(toClassOption),
    timezone,
  };
}
