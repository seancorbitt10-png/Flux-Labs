import type { Class, Task, TaskStatus } from "@prisma/client";
import {
  getClass,
  getTask,
  listClasses,
  listTasks,
  queryAcademicCalendar,
  type CalendarItem,
} from "@/lib/academic";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { ValidationError } from "@/lib/errors";
import type {
  AcademicWorkspaceBudgetsApplied,
  AcademicWorkspaceContext,
  ContextCalendarItemSlice,
  ContextClassSlice,
  ContextTaskSlice,
  TruncatedText,
} from "./context-types";

/**
 * Phase 3 Implementation #4 — bounded academic workspace context for Study AI.
 *
 * READ ONLY. Uses existing Class/Task/Calendar domain services (ownership + authz).
 * Workspace text is DATA (role: student_data), never instructions.
 *
 * Limits (why these sizes):
 * - maxClasses (8): enough for a typical term load without dumping archived history
 * - maxTasks (12): covers overdue + near-term open work for one Study turn
 * - maxCalendarItems (14): ~two weeks of dated items at a few per day
 * - calendar window (−7d / +14d): overdue awareness + near-future planning only
 * - field caps: keep prompt size bounded; long descriptions are truncated
 */

export const ACADEMIC_WORKSPACE_BUDGETS: AcademicWorkspaceBudgetsApplied = {
  maxClasses: 8,
  maxTasks: 12,
  maxCalendarItems: 14,
  calendarDaysPast: 7,
  calendarDaysFuture: 14,
  maxClassName: 120,
  maxCourseCode: 40,
  maxTerm: 60,
  maxInstructorName: 80,
  maxClassDescription: 200,
  maxTaskTitle: 120,
  maxTaskDescription: 200,
  maxLinkedConceptIds: 5,
};

const OPEN_TASK_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS"];

function truncate(value: string, max: number): TruncatedText {
  if (value.length <= max) {
    return { text: value, truncated: false };
  }
  return { text: value.slice(0, max), truncated: true };
}

function normalizeFocusId(
  raw: string | undefined,
  label: "classId" | "taskId",
): string | null {
  if (raw === undefined) return null;
  if (typeof raw !== "string") {
    throw new ValidationError(`${label} must be a string when provided.`);
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ValidationError(`Invalid ${label}.`);
  }
  if (trimmed.length > 64) {
    throw new ValidationError(`${label} exceeds maximum length.`);
  }
  return trimmed;
}

function toClassSlice(row: Class): ContextClassSlice {
  return {
    role: "student_data",
    category: "class",
    id: row.id,
    name: truncate(row.name, ACADEMIC_WORKSPACE_BUDGETS.maxClassName),
    term: truncate(row.term, ACADEMIC_WORKSPACE_BUDGETS.maxTerm),
    status: row.status,
    courseCode: row.courseCode
      ? truncate(row.courseCode, ACADEMIC_WORKSPACE_BUDGETS.maxCourseCode)
      : null,
    instructorName: row.instructorName
      ? truncate(
          row.instructorName,
          ACADEMIC_WORKSPACE_BUDGETS.maxInstructorName,
        )
      : null,
    description: row.description
      ? truncate(
          row.description,
          ACADEMIC_WORKSPACE_BUDGETS.maxClassDescription,
        )
      : null,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
  };
}

function toTaskSlice(
  row: Task,
  className: string | null,
  linkedConceptIds: string[] = [],
): ContextTaskSlice {
  return {
    role: "student_data",
    category: "task",
    id: row.id,
    title: truncate(row.title, ACADEMIC_WORKSPACE_BUDGETS.maxTaskTitle),
    description: row.description
      ? truncate(row.description, ACADEMIC_WORKSPACE_BUDGETS.maxTaskDescription)
      : null,
    status: row.status,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    priority: row.priority,
    estimatedMinutes: row.estimatedMinutes,
    classId: row.classId,
    className: className
      ? truncate(className, ACADEMIC_WORKSPACE_BUDGETS.maxClassName)
      : null,
    linkedConceptIds: linkedConceptIds.slice(
      0,
      ACADEMIC_WORKSPACE_BUDGETS.maxLinkedConceptIds,
    ),
  };
}

function toCalendarSlice(item: CalendarItem): ContextCalendarItemSlice {
  if (item.kind === "task") {
    return {
      role: "student_data",
      category: "calendar_item",
      kind: "task",
      id: item.id,
      title: truncate(item.title, ACADEMIC_WORKSPACE_BUDGETS.maxTaskTitle),
      status: item.status,
      dueAt: item.dueAt ? item.dueAt.toISOString() : null,
      startsAt: item.startsAt ? item.startsAt.toISOString() : null,
      sortAt: item.sortAt.toISOString(),
      className: item.class
        ? truncate(item.class.name, ACADEMIC_WORKSPACE_BUDGETS.maxClassName)
        : null,
      courseCode: item.class?.courseCode
        ? truncate(
            item.class.courseCode,
            ACADEMIC_WORKSPACE_BUDGETS.maxCourseCode,
          )
        : null,
    };
  }
  return {
    role: "student_data",
    category: "calendar_item",
    kind: "class_period",
    id: item.id,
    name: truncate(item.name, ACADEMIC_WORKSPACE_BUDGETS.maxClassName),
    term: truncate(item.term, ACADEMIC_WORKSPACE_BUDGETS.maxTerm),
    status: item.status,
    courseCode: item.courseCode
      ? truncate(item.courseCode, ACADEMIC_WORKSPACE_BUDGETS.maxCourseCode)
      : null,
    startsAt: item.startsAt ? item.startsAt.toISOString() : null,
    endsAt: item.endsAt ? item.endsAt.toISOString() : null,
    sortAt: item.sortAt.toISOString(),
  };
}

/** Deterministic open-task ranking: overdue → upcoming → undated. */
function compareOpenTasks(a: Task, b: Task, nowMs: number): number {
  const aDue = a.dueAt?.getTime() ?? null;
  const bDue = b.dueAt?.getTime() ?? null;
  const aOverdue = aDue !== null && aDue < nowMs;
  const bOverdue = bDue !== null && bDue < nowMs;

  if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

  if (aDue !== null && bDue !== null && aDue !== bDue) {
    return aDue - bDue;
  }
  if (aDue !== null && bDue === null) return -1;
  if (aDue === null && bDue !== null) return 1;

  const aPri = a.priority ?? Number.POSITIVE_INFINITY;
  const bPri = b.priority ?? Number.POSITIVE_INFINITY;
  if (aPri !== bPri) return aPri - bPri;

  return b.createdAt.getTime() - a.createdAt.getTime();
}

export type AssembleAcademicWorkspaceInput = {
  actorUserId: string;
  userId: string;
  classId?: string;
  taskId?: string;
  /** Injected for deterministic tests; defaults to now. */
  now?: Date;
};

/**
 * Assemble a bounded, ownership-checked academic workspace slice.
 * Never mutates Class / Task / Calendar / Student Model.
 */
export async function assembleAcademicWorkspaceContext(
  input: AssembleAcademicWorkspaceInput,
): Promise<AcademicWorkspaceContext> {
  assertResourceOwner(input.userId, input.actorUserId);

  const focusClassId = normalizeFocusId(input.classId, "classId");
  const focusTaskId = normalizeFocusId(input.taskId, "taskId");
  const now = input.now ?? new Date();
  const nowMs = now.getTime();

  let focusClass: Class | null = null;
  let focusTask: Awaited<ReturnType<typeof getTask>> | null = null;

  if (focusClassId) {
    focusClass = await getClass({
      actorUserId: input.actorUserId,
      userId: input.userId,
      classId: focusClassId,
    });
  }

  if (focusTaskId) {
    focusTask = await getTask({
      actorUserId: input.actorUserId,
      userId: input.userId,
      taskId: focusTaskId,
    });
  }

  if (
    focusClass &&
    focusTask &&
    focusTask.classId &&
    focusTask.classId !== focusClass.id
  ) {
    throw new ValidationError(
      "Focused task does not belong to the focused class.",
    );
  }

  const [activeClasses, allTasks] = await Promise.all([
    listClasses({
      actorUserId: input.actorUserId,
      userId: input.userId,
      status: "ACTIVE",
    }),
    listTasks({
      actorUserId: input.actorUserId,
      userId: input.userId,
    }),
  ]);

  const allOpenTasks = allTasks.filter((t) =>
    OPEN_TASK_STATUSES.includes(t.status),
  );

  const classById = new Map<string, Class>();
  for (const c of activeClasses) classById.set(c.id, c);
  if (focusClass) classById.set(focusClass.id, focusClass);

  // Classes: focus first, then ACTIVE by existing list order (term desc, name asc).
  const selectedClasses: Class[] = [];
  const seenClass = new Set<string>();
  if (focusClass) {
    selectedClasses.push(focusClass);
    seenClass.add(focusClass.id);
  }
  for (const c of activeClasses) {
    if (seenClass.has(c.id)) continue;
    selectedClasses.push(c);
    seenClass.add(c.id);
    if (selectedClasses.length >= ACADEMIC_WORKSPACE_BUDGETS.maxClasses) break;
  }

  // Tasks: focus task, then open tasks for focus class, then remaining open ranked.
  const selectedTasks: Task[] = [];
  const seenTask = new Set<string>();

  if (focusTask) {
    selectedTasks.push(focusTask);
    seenTask.add(focusTask.id);
  }

  const effectiveClassFilter =
    focusClass?.id ??
    (focusTask?.classId && classById.has(focusTask.classId)
      ? focusTask.classId
      : null);

  const rankedOpen = [...allOpenTasks].sort((a, b) =>
    compareOpenTasks(a, b, nowMs),
  );

  const preferClass = (t: Task) =>
    effectiveClassFilter ? t.classId === effectiveClassFilter : true;

  for (const t of rankedOpen.filter(preferClass)) {
    if (seenTask.has(t.id)) continue;
    selectedTasks.push(t);
    seenTask.add(t.id);
    if (selectedTasks.length >= ACADEMIC_WORKSPACE_BUDGETS.maxTasks) break;
  }

  if (selectedTasks.length < ACADEMIC_WORKSPACE_BUDGETS.maxTasks) {
    for (const t of rankedOpen) {
      if (seenTask.has(t.id)) continue;
      selectedTasks.push(t);
      seenTask.add(t.id);
      if (selectedTasks.length >= ACADEMIC_WORKSPACE_BUDGETS.maxTasks) break;
    }
  }

  // Ensure class metadata for selected tasks (may include archived parent of focus task).
  for (const t of selectedTasks) {
    if (t.classId && !classById.has(t.classId)) {
      try {
        const linked = await getClass({
          actorUserId: input.actorUserId,
          userId: input.userId,
          classId: t.classId,
        });
        classById.set(linked.id, linked);
        if (
          selectedClasses.length < ACADEMIC_WORKSPACE_BUDGETS.maxClasses &&
          !seenClass.has(linked.id)
        ) {
          selectedClasses.push(linked);
          seenClass.add(linked.id);
        }
      } catch {
        // Class missing / race — task remains without class name.
      }
    }
  }

  const from = new Date(
    nowMs - ACADEMIC_WORKSPACE_BUDGETS.calendarDaysPast * 86_400_000,
  );
  const to = new Date(
    nowMs + ACADEMIC_WORKSPACE_BUDGETS.calendarDaysFuture * 86_400_000,
  );

  const calendarClassId =
    focusClass?.id ??
    (focusTask?.classId && seenClass.has(focusTask.classId)
      ? focusTask.classId
      : undefined);

  const calendar = await queryAcademicCalendar({
    actorUserId: input.actorUserId,
    userId: input.userId,
    query: {
      from: from.toISOString(),
      to: to.toISOString(),
      ...(calendarClassId ? { classId: calendarClassId } : {}),
      limit: ACADEMIC_WORKSPACE_BUDGETS.maxCalendarItems,
    },
  });

  const focusLinkedConceptIds =
    focusTask?.taskConcepts.map((tc) => tc.conceptId) ?? [];

  return {
    role: "student_data",
    category: "academic_workspace",
    dataNote: "workspace_records_are_untrusted_data",
    focus: {
      classId: focusClass?.id ?? null,
      taskId: focusTask?.id ?? null,
    },
    classes: selectedClasses
      .slice(0, ACADEMIC_WORKSPACE_BUDGETS.maxClasses)
      .map(toClassSlice),
    tasks: selectedTasks.slice(0, ACADEMIC_WORKSPACE_BUDGETS.maxTasks).map((t) =>
      toTaskSlice(
        t,
        t.classId ? (classById.get(t.classId)?.name ?? null) : null,
        t.id === focusTask?.id ? focusLinkedConceptIds : [],
      ),
    ),
    calendar: {
      from: calendar.from.toISOString(),
      to: calendar.to.toISOString(),
      items: calendar.items.map(toCalendarSlice),
    },
    budgets: { ...ACADEMIC_WORKSPACE_BUDGETS },
  };
}
