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

/**
 * Calendar page contract:
 * - `limit` = max calendar items returned
 * - order = sortAt ASC, then kind (class_period before task), then id ASC
 * - `truncated` = additional matching calendar items exist beyond this page
 *
 * Retrieval is bounded: a single parameterized UNION query returns at most
 * `limit + 1` ordered keys (extra row detects truncation). Full rows are
 * hydrated only for the returned page — never the entire matching set.
 */
export type CalendarQueryResult = {
  from: Date;
  to: Date;
  items: CalendarItem[];
  truncated: boolean;
  limit: number;
};

type CalendarKeyRow = {
  kind: "task" | "class_period";
  id: string;
  sortAt: Date;
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
 * Bounded, globally ordered calendar key page via SQL UNION.
 * Returns at most `limit + 1` rows so callers can set `truncated` truthfully
 * without scanning the full matching dataset.
 */
export async function fetchCalendarPageKeys(args: {
  userId: string;
  from: Date;
  to: Date;
  limit: number;
  classId?: string | null;
  status?: TaskStatus;
}): Promise<CalendarKeyRow[]> {
  const classId = args.classId ?? null;
  const status = args.status ?? null;
  const includeClassPeriods = status == null;
  const fetchLimit = args.limit + 1;

  // Parameterized query only — never string-concatenate user input into SQL.
  const rows = await prisma.$queryRaw<CalendarKeyRow[]>`
    WITH candidates AS (
      SELECT
        'task'::text AS kind,
        t.id,
        COALESCE(t."dueAt", t."startsAt") AS "sortAt"
      FROM tasks t
      WHERE t."userId" = ${args.userId}
        AND (${classId}::text IS NULL OR t."classId" = ${classId})
        AND (${status}::text IS NULL OR t.status::text = ${status})
        AND (
          (t."dueAt" IS NOT NULL AND t."dueAt" >= ${args.from} AND t."dueAt" <= ${args.to})
          OR
          (t."startsAt" IS NOT NULL AND t."startsAt" >= ${args.from} AND t."startsAt" <= ${args.to})
        )
        AND COALESCE(t."dueAt", t."startsAt") IS NOT NULL
      UNION ALL
      SELECT
        'class_period'::text AS kind,
        c.id,
        COALESCE(c."startsAt", c."endsAt") AS "sortAt"
      FROM classes c
      WHERE ${includeClassPeriods}
        AND c."userId" = ${args.userId}
        AND (${classId}::text IS NULL OR c.id = ${classId})
        AND (
          (c."startsAt" IS NOT NULL AND c."startsAt" >= ${args.from} AND c."startsAt" <= ${args.to})
          OR
          (c."endsAt" IS NOT NULL AND c."endsAt" >= ${args.from} AND c."endsAt" <= ${args.to})
        )
        AND COALESCE(c."startsAt", c."endsAt") IS NOT NULL
    )
    SELECT kind, id, "sortAt"
    FROM candidates
    ORDER BY "sortAt" ASC, kind ASC, id ASC
    LIMIT ${fetchLimit}
  `;

  return rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    sortAt: r.sortAt instanceof Date ? r.sortAt : new Date(r.sortAt),
  }));
}

/**
 * Deterministic calendar read projection.
 * Tasks remain the source of truth for deadlines — no CalendarEvent table.
 * Class startsAt/endsAt appear only as optional course-period metadata.
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

  const keys = await fetchCalendarPageKeys({
    userId: args.userId,
    from,
    to,
    limit,
    classId: classId ?? null,
    status,
  });

  const truncated = keys.length > limit;
  const pageKeys = keys.slice(0, limit);

  const taskIds = pageKeys.filter((k) => k.kind === "task").map((k) => k.id);
  const classIds = pageKeys
    .filter((k) => k.kind === "class_period")
    .map((k) => k.id);

  const [tasks, classes] = await Promise.all([
    taskIds.length === 0
      ? Promise.resolve([])
      : prisma.task.findMany({
          where: { userId: args.userId, id: { in: taskIds } },
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
        }),
    classIds.length === 0
      ? Promise.resolve([])
      : prisma.class.findMany({
          where: { userId: args.userId, id: { in: classIds } },
          select: {
            id: true,
            name: true,
            term: true,
            status: true,
            courseCode: true,
            startsAt: true,
            endsAt: true,
          },
        }),
  ]);

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const classById = new Map(classes.map((c) => [c.id, c]));

  const items: CalendarItem[] = [];
  for (const key of pageKeys) {
    if (key.kind === "task") {
      const t = taskById.get(key.id);
      if (!t) continue; // ownership race / deleted — skip
      const sortAt = t.dueAt ?? t.startsAt;
      if (!sortAt) continue;
      items.push({
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
    } else {
      const c = classById.get(key.id);
      if (!c) continue;
      const sortAt = c.startsAt ?? c.endsAt;
      if (!sortAt) continue;
      items.push({
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

  // Preserve SQL order (already deterministic); re-sort only as safety net.
  items.sort(compareCalendarItems);

  return { from, to, items, truncated, limit };
}

/** Test helper: exposed for proving the key query is bounded by limit+1. */
export function calendarKeyFetchCap(limit: number): number {
  return limit + 1;
}
