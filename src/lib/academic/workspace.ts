import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import type { TaskStatus } from "@prisma/client";
import { queryAcademicCalendar } from "./calendar";
import {
  formatDayHeading,
  formatYmd,
  parseYmd,
  sevenDayRange,
  todayYmd,
  type Ymd,
} from "./calendar-range";
import {
  groupCalendarItemsByDay,
  toCalendarItemView,
  type CalendarDayGroup,
  type CalendarItemView,
} from "./calendar-views";
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

export type CalendarWorkspaceBootstrap = {
  timezone: string;
  anchorDate: string;
  from: string;
  to: string;
  rangeLabel: string;
  todayKey: string;
  items: CalendarItemView[];
  days: CalendarDayGroup[];
  truncated: boolean;
  limit: number;
  classOptions: ClassOption[];
  classId: string | null;
  status: TaskStatus | null;
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
    tasks: tasks.map((t) =>
      toTaskView(t, t.classId ? (nameById.get(t.classId) ?? null) : null),
    ),
    classOptions: classes.map(toClassOption),
    timezone,
  };
}

function resolveAnchor(raw: string | null | undefined, timeZone: string): Ymd {
  if (raw) {
    const parsed = parseYmd(raw);
    if (parsed) return parsed;
  }
  return todayYmd(timeZone);
}

export async function getCalendarWorkspaceBootstrap(args: {
  actorUserId: string;
  userId: string;
  anchorDate?: string | null;
  classId?: string | null;
  status?: TaskStatus | null;
}): Promise<CalendarWorkspaceBootstrap> {
  assertResourceOwner(args.userId, args.actorUserId);

  const [timezone, classes] = await Promise.all([
    studentTimezone(args.userId),
    listClasses({
      actorUserId: args.actorUserId,
      userId: args.userId,
    }),
  ]);

  const anchor = resolveAnchor(args.anchorDate, timezone);
  const { from, to, endYmd } = sevenDayRange(anchor, timezone);
  const today = todayYmd(timezone);
  const todayKey = formatYmd(today);

  const result = await queryAcademicCalendar({
    actorUserId: args.actorUserId,
    userId: args.userId,
    query: {
      from: from.toISOString(),
      to: to.toISOString(),
      classId: args.classId ?? null,
      ...(args.status ? { status: args.status } : {}),
      limit: 200,
    },
  });

  const items = result.items.map(toCalendarItemView);
  const days = groupCalendarItemsByDay(
    items,
    timezone,
    todayKey,
    (dateKey) => {
      const ymd = parseYmd(dateKey);
      if (!ymd) return dateKey;
      return formatDayHeading(ymd, timezone);
    },
  );

  const rangeLabel = `${formatDayHeading(anchor, timezone)} – ${formatDayHeading(endYmd, timezone)}`;

  return {
    timezone,
    anchorDate: formatYmd(anchor),
    from: from.toISOString(),
    to: to.toISOString(),
    rangeLabel,
    todayKey,
    items,
    days,
    truncated: result.truncated,
    limit: result.limit,
    classOptions: classes.map(toClassOption),
    classId: args.classId ?? null,
    status: args.status ?? null,
  };
}
