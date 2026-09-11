"use server";

import type { ClassStatus, TaskStatus } from "@prisma/client";
import { requireUserId } from "@/lib/auth/session";
import { toClientError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { assertNoClientAcademicAuthority } from "./authority";
import {
  addDaysYmd,
  formatYmd,
  parseYmd,
  todayYmd,
} from "./calendar-range";
import {
  archiveClass,
  createClass,
  deleteClass,
  getClass,
  updateClass,
} from "./classes";
import {
  createTask,
  deleteTask,
  getTask,
  transitionTaskStatus,
  updateTask,
} from "./tasks";
import { toClassView, toTaskView } from "./views";
import {
  getCalendarWorkspaceBootstrap,
  getClassesWorkspaceBootstrap,
  getTasksWorkspaceBootstrap,
  type CalendarWorkspaceBootstrap,
  type ClassesWorkspaceBootstrap,
  type TasksWorkspaceBootstrap,
} from "./workspace";
import { prisma } from "@/lib/db/prisma";

export type AcademicActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; message: string };

function rate(userId: string, key: string) {
  assertRateLimit(`academic:${key}:${userId}`, {
    limit: 120,
    windowMs: 60_000,
  });
}

async function classNameFor(
  userId: string,
  classId: string | null,
): Promise<string | null> {
  if (!classId) return null;
  const row = await prisma.class.findFirst({
    where: { id: classId, userId },
    select: { name: true },
  });
  return row?.name ?? null;
}

export async function loadClassesWorkspaceAction(): Promise<
  AcademicActionResult<ClassesWorkspaceBootstrap>
> {
  try {
    const userId = await requireUserId();
    rate(userId, "classes:load");
    const data = await getClassesWorkspaceBootstrap({
      actorUserId: userId,
      userId,
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: toClientError(error).message };
  }
}

export async function loadTasksWorkspaceAction(): Promise<
  AcademicActionResult<TasksWorkspaceBootstrap>
> {
  try {
    const userId = await requireUserId();
    rate(userId, "tasks:load");
    const data = await getTasksWorkspaceBootstrap({
      actorUserId: userId,
      userId,
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: toClientError(error).message };
  }
}

export async function createClassAction(
  raw: Record<string, unknown>,
): Promise<AcademicActionResult<{ class: ReturnType<typeof toClassView> }>> {
  try {
    const userId = await requireUserId();
    rate(userId, "classes:write");
    assertNoClientAcademicAuthority(raw);
    const created = await createClass({
      actorUserId: userId,
      userId,
      input: raw,
    });
    return { ok: true, data: { class: toClassView(created) } };
  } catch (error) {
    return { ok: false, message: toClientError(error).message };
  }
}

export async function updateClassAction(args: {
  classId: string;
  input: Record<string, unknown>;
}): Promise<AcademicActionResult<{ class: ReturnType<typeof toClassView> }>> {
  try {
    const userId = await requireUserId();
    rate(userId, "classes:write");
    assertNoClientAcademicAuthority(args.input);
    const updated = await updateClass({
      actorUserId: userId,
      userId,
      classId: args.classId,
      input: args.input,
    });
    return { ok: true, data: { class: toClassView(updated) } };
  } catch (error) {
    return { ok: false, message: toClientError(error).message };
  }
}

export async function setClassStatusAction(args: {
  classId: string;
  status: ClassStatus;
}): Promise<AcademicActionResult<{ class: ReturnType<typeof toClassView> }>> {
  try {
    const userId = await requireUserId();
    rate(userId, "classes:write");
    const updated =
      args.status === "ARCHIVED"
        ? await archiveClass({
            actorUserId: userId,
            userId,
            classId: args.classId,
          })
        : await updateClass({
            actorUserId: userId,
            userId,
            classId: args.classId,
            input: { status: args.status },
          });
    return { ok: true, data: { class: toClassView(updated) } };
  } catch (error) {
    return { ok: false, message: toClientError(error).message };
  }
}

export async function deleteClassAction(args: {
  classId: string;
}): Promise<
  AcademicActionResult<{ deletedClassId: string; tasksDetached: number }>
> {
  try {
    const userId = await requireUserId();
    rate(userId, "classes:write");
    const result = await deleteClass({
      actorUserId: userId,
      userId,
      classId: args.classId,
    });
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, message: toClientError(error).message };
  }
}

export async function getClassAction(args: {
  classId: string;
}): Promise<AcademicActionResult<{ class: ReturnType<typeof toClassView> }>> {
  try {
    const userId = await requireUserId();
    rate(userId, "classes:read");
    const row = await getClass({
      actorUserId: userId,
      userId,
      classId: args.classId,
    });
    return { ok: true, data: { class: toClassView(row) } };
  } catch (error) {
    return { ok: false, message: toClientError(error).message };
  }
}

export async function createTaskAction(
  raw: Record<string, unknown>,
): Promise<AcademicActionResult<{ task: ReturnType<typeof toTaskView> }>> {
  try {
    const userId = await requireUserId();
    rate(userId, "tasks:write");
    assertNoClientAcademicAuthority(raw);
    const created = await createTask({
      actorUserId: userId,
      userId,
      input: raw,
    });
    const className = await classNameFor(userId, created.classId);
    return { ok: true, data: { task: toTaskView(created, className) } };
  } catch (error) {
    return { ok: false, message: toClientError(error).message };
  }
}

export async function updateTaskAction(args: {
  taskId: string;
  input: Record<string, unknown>;
}): Promise<AcademicActionResult<{ task: ReturnType<typeof toTaskView> }>> {
  try {
    const userId = await requireUserId();
    rate(userId, "tasks:write");
    assertNoClientAcademicAuthority(args.input);
    const updated = await updateTask({
      actorUserId: userId,
      userId,
      taskId: args.taskId,
      input: args.input,
    });
    const className = await classNameFor(userId, updated.classId);
    return { ok: true, data: { task: toTaskView(updated, className) } };
  } catch (error) {
    return { ok: false, message: toClientError(error).message };
  }
}

export async function setTaskStatusAction(args: {
  taskId: string;
  status: TaskStatus;
}): Promise<AcademicActionResult<{ task: ReturnType<typeof toTaskView> }>> {
  try {
    const userId = await requireUserId();
    rate(userId, "tasks:write");
    const updated = await transitionTaskStatus({
      actorUserId: userId,
      userId,
      taskId: args.taskId,
      status: args.status,
    });
    const className = await classNameFor(userId, updated.classId);
    return { ok: true, data: { task: toTaskView(updated, className) } };
  } catch (error) {
    return { ok: false, message: toClientError(error).message };
  }
}

export async function deleteTaskAction(args: {
  taskId: string;
}): Promise<AcademicActionResult<{ deletedTaskId: string }>> {
  try {
    const userId = await requireUserId();
    rate(userId, "tasks:write");
    const result = await deleteTask({
      actorUserId: userId,
      userId,
      taskId: args.taskId,
    });
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, message: toClientError(error).message };
  }
}

export async function getTaskAction(args: {
  taskId: string;
}): Promise<AcademicActionResult<{ task: ReturnType<typeof toTaskView> }>> {
  try {
    const userId = await requireUserId();
    rate(userId, "tasks:read");
    const row = await getTask({
      actorUserId: userId,
      userId,
      taskId: args.taskId,
    });
    const className = await classNameFor(userId, row.classId);
    return { ok: true, data: { task: toTaskView(row, className) } };
  } catch (error) {
    return { ok: false, message: toClientError(error).message };
  }
}

export async function loadCalendarWorkspaceAction(args?: {
  anchorDate?: string | null;
  classId?: string | null;
  status?: TaskStatus | null;
}): Promise<AcademicActionResult<CalendarWorkspaceBootstrap>> {
  try {
    const userId = await requireUserId();
    rate(userId, "calendar:load");
    const bag = {
      ...(args?.anchorDate != null ? { anchorDate: args.anchorDate } : {}),
      ...(args?.classId != null ? { classId: args.classId } : {}),
      ...(args?.status != null ? { status: args.status } : {}),
    };
    assertNoClientAcademicAuthority(bag as Record<string, unknown>);

    const data = await getCalendarWorkspaceBootstrap({
      actorUserId: userId,
      userId,
      anchorDate: args?.anchorDate ?? null,
      classId: args?.classId ?? null,
      status: args?.status ?? null,
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: toClientError(error).message };
  }
}

/** Shift the seven-day agenda window by ±7 days (or reset to today). */
export async function navigateCalendarAction(args: {
  direction: "prev" | "next" | "today";
  anchorDate?: string | null;
  classId?: string | null;
  status?: TaskStatus | null;
}): Promise<AcademicActionResult<CalendarWorkspaceBootstrap>> {
  try {
    const userId = await requireUserId();
    rate(userId, "calendar:nav");

    const profile = await prisma.studentProfile.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    const timezone = profile?.timezone?.trim() || "UTC";

    let anchor =
      args.direction === "today"
        ? todayYmd(timezone)
        : parseYmd(args.anchorDate ?? "") ?? todayYmd(timezone);

    if (args.direction === "prev") {
      anchor = addDaysYmd(anchor, -7);
    } else if (args.direction === "next") {
      anchor = addDaysYmd(anchor, 7);
    }

    const data = await getCalendarWorkspaceBootstrap({
      actorUserId: userId,
      userId,
      anchorDate: formatYmd(anchor),
      classId: args.classId ?? null,
      status: args.status ?? null,
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: toClientError(error).message };
  }
}
