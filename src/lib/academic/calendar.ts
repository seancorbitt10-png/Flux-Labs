import type { ClassStatus, TaskStatus } from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";
import {
  calendarQuerySchema,
  MAX_CALENDAR_RESULTS,
} from "./validation";

export type CalendarClassMeta = {
  id: string;
  name: string;
  term: string;
  status: ClassStatus;
  courseCode: string | null;
};

export type CalendarTaskItem = {
  kind: "task";
  id: string;
  title: string;
  status: TaskStatus;
  dueAt: Date | null;
  startsAt: Date | null;
  priority: number | null;
  estimatedMinutes: number | null;
  class: CalendarClassMeta | null;
  /** Instant used for range matching / sorting (dueAt preferred, else startsAt). */
  sortAt: Date;
};

export type CalendarClassPeriodItem = {
  kind: "class_period";
  id: string;
  name: string;
  term: string;
  status: ClassStatus;
  courseCode: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  sortAt: Date;
};

export type CalendarItem = CalendarTaskItem | CalendarClassPeriodItem;

export type CalendarQueryResult = {
  from: Date;
  to: Date;
  items: CalendarItem[];
  truncated: boolean;
  limit: number;
};

/**
 * Deterministic total order for calendar items.
 * 1) sortAt ascending
 * 2) kind: class_period before task (stable mixed timelines)
 * 3) id ascending (tie-breaker)
 */
export function compareCalendarItems(a: CalendarItem, b: CalendarItem): number {
  const byTime = a.sortAt.getTime() - b.sortAt.getTime();
  if (byTime !== 0) return byTime;
  if (a.kind !== b.kind) {
    return a.kind === "class_period" ? -1 : 1;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Deterministic calendar read projection.
 * Tasks remain the source of truth for deadlines — no CalendarEvent table.
 * Class startsAt/endsAt appear only as optional course-period metadata.
 *
 * Global limit applies AFTER merging all matching sources so earlier records
 * cannot be dropped by per-source take().
 */
export async function queryAcademicCalendar(args: {
  actorUserId: string;
  userId: string;
  query: Record<string, unknown>;
}): Promise<CalendarQueryResult> {
  assertResourceOwner(args.userId, args.actorUserId);

  const parsed = calendarQuerySchema.safeParse(args.query);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "Invalid calendar query.",
    );
  }

  const { from, to, classId, status } = parsed.data;
  const limit = parsed.data.limit ?? MAX_CALENDAR_RESULTS;

  if (classId) {
    const ownedClass = await prisma.class.findFirst({
      where: { id: classId, userId: args.userId },
      select: { id: true },
    });
    if (!ownedClass) {
      throw new ValidationError("Class not found.");
    }
  }

  // Load all matching tasks in range (ownership-scoped). Limit is applied
  // only after merge so ordering is globally correct.
  const tasks = await prisma.task.findMany({
    where: {
      userId: args.userId,
      ...(status ? { status } : {}),
      ...(classId ? { classId } : {}),
      OR: [
        { dueAt: { gte: from, lte: to } },
        { startsAt: { gte: from, lte: to } },
      ],
    },
    include: {
      class: {
        select: {
          id: true,
          name: true,
          term: true,
          status: true,
          courseCode: true,
        },
      },
    },
    orderBy: [{ dueAt: "asc" }, { startsAt: "asc" }, { id: "asc" }],
  });

  const taskItems: CalendarTaskItem[] = [];
  for (const t of tasks) {
    const sortAt = t.dueAt ?? t.startsAt;
    if (!sortAt) continue;
    taskItems.push({
      kind: "task",
      id: t.id,
      title: t.title,
      status: t.status,
      dueAt: t.dueAt,
      startsAt: t.startsAt,
      priority: t.priority,
      estimatedMinutes: t.estimatedMinutes,
      class: t.class
        ? {
            id: t.class.id,
            name: t.class.name,
            term: t.class.term,
            status: t.class.status,
            courseCode: t.class.courseCode,
          }
        : null,
      sortAt,
    });
  }

  // Optional course-period metadata (not recurring events).
  // Only include when no task-status filter (status filters apply to tasks).
  const classPeriodItems: CalendarClassPeriodItem[] = [];
  if (!status) {
    const classes = await prisma.class.findMany({
      where: {
        userId: args.userId,
        ...(classId ? { id: classId } : {}),
        OR: [
          { startsAt: { gte: from, lte: to } },
          { endsAt: { gte: from, lte: to } },
        ],
      },
      select: {
        id: true,
        name: true,
        term: true,
        status: true,
        courseCode: true,
        startsAt: true,
        endsAt: true,
      },
      orderBy: [{ startsAt: "asc" }, { endsAt: "asc" }, { id: "asc" }],
    });

    for (const c of classes) {
      const sortAt = c.startsAt ?? c.endsAt;
      if (!sortAt) continue;
      classPeriodItems.push({
        kind: "class_period",
        id: c.id,
        name: c.name,
        term: c.term,
        status: c.status,
        courseCode: c.courseCode,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        sortAt,
      });
    }
  }

  const merged = [...taskItems, ...classPeriodItems].sort(compareCalendarItems);
  const truncated = merged.length > limit;
  const items = merged.slice(0, limit);

  return { from, to, items, truncated, limit };
}
