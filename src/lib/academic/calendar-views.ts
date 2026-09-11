import type { TaskStatus } from "@prisma/client";
import type {
  CalendarClassPeriodItem,
  CalendarItem,
  CalendarTaskItem,
} from "./calendar";

export type CalendarTaskView = {
  kind: "task";
  id: string;
  title: string;
  status: TaskStatus;
  dueAt: string | null;
  startsAt: string | null;
  priority: number | null;
  estimatedMinutes: number | null;
  classId: string | null;
  className: string | null;
  courseCode: string | null;
  sortAt: string;
};

export type CalendarClassPeriodView = {
  kind: "class_period";
  id: string;
  name: string;
  term: string;
  courseCode: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sortAt: string;
};

export type CalendarItemView = CalendarTaskView | CalendarClassPeriodView;

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export function toCalendarItemView(item: CalendarItem): CalendarItemView {
  if (item.kind === "task") {
    const t = item as CalendarTaskItem;
    return {
      kind: "task",
      id: t.id,
      title: t.title,
      status: t.status,
      dueAt: iso(t.dueAt),
      startsAt: iso(t.startsAt),
      priority: t.priority,
      estimatedMinutes: t.estimatedMinutes,
      classId: t.class?.id ?? null,
      className: t.class?.name ?? null,
      courseCode: t.class?.courseCode ?? null,
      sortAt: t.sortAt.toISOString(),
    };
  }
  const c = item as CalendarClassPeriodItem;
  return {
    kind: "class_period",
    id: c.id,
    name: c.name,
    term: c.term,
    courseCode: c.courseCode,
    startsAt: iso(c.startsAt),
    endsAt: iso(c.endsAt),
    sortAt: c.sortAt.toISOString(),
  };
}

export type CalendarDayGroup = {
  /** YYYY-MM-DD in profile timezone */
  dateKey: string;
  label: string;
  isToday: boolean;
  items: CalendarItemView[];
};

export function groupCalendarItemsByDay(
  items: CalendarItemView[],
  timeZone: string,
  todayKey: string,
  dayLabel: (dateKey: string) => string,
): CalendarDayGroup[] {
  const buckets = new Map<string, CalendarItemView[]>();
  for (const item of items) {
    const key = ymdKeyFromInstant(item.sortAt, timeZone);
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }
  const keys = [...buckets.keys()].sort();
  return keys.map((dateKey) => ({
    dateKey,
    label: dayLabel(dateKey),
    isToday: dateKey === todayKey,
    items: buckets.get(dateKey) ?? [],
  }));
}

function ymdKeyFromInstant(isoInstant: string, timeZone: string): string {
  const date = new Date(isoInstant);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
