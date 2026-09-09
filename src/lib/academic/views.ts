import type { Class, ClassStatus, Task, TaskStatus } from "@prisma/client";

/** Plain JSON shapes safe to pass from RSC → client components. */

export type ClassView = {
  id: string;
  name: string;
  term: string;
  status: ClassStatus;
  courseCode: string | null;
  instructorName: string | null;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskView = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  classId: string | null;
  className: string | null;
  priority: number | null;
  dueAt: string | null;
  startsAt: string | null;
  estimatedMinutes: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClassOption = {
  id: string;
  name: string;
  term: string;
  status: ClassStatus;
};

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export function toClassView(row: Class): ClassView {
  return {
    id: row.id,
    name: row.name,
    term: row.term,
    status: row.status,
    courseCode: row.courseCode,
    instructorName: row.instructorName,
    description: row.description,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toTaskView(
  row: Task,
  className: string | null = null,
): TaskView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    classId: row.classId,
    className,
    priority: row.priority,
    dueAt: iso(row.dueAt),
    startsAt: iso(row.startsAt),
    estimatedMinutes: row.estimatedMinutes,
    completedAt: iso(row.completedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toClassOption(row: Class): ClassOption {
  return {
    id: row.id,
    name: row.name,
    term: row.term,
    status: row.status,
  };
}

/** Active = open work (TODO + IN_PROGRESS). */
export function isActiveTaskStatus(status: TaskStatus): boolean {
  return status === "TODO" || status === "IN_PROGRESS";
}

export type TaskListFilter = "all" | "active" | "completed" | "cancelled";
export type TaskListSort = "due_soon" | "recent";

export function filterTasks(
  tasks: TaskView[],
  filter: TaskListFilter,
): TaskView[] {
  switch (filter) {
    case "active":
      return tasks.filter((t) => isActiveTaskStatus(t.status));
    case "completed":
      return tasks.filter((t) => t.status === "COMPLETED");
    case "cancelled":
      return tasks.filter((t) => t.status === "CANCELLED");
    default:
      return tasks;
  }
}

export function sortTasks(tasks: TaskView[], sort: TaskListSort): TaskView[] {
  const copy = [...tasks];
  if (sort === "recent") {
    copy.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return copy;
  }
  // due_soon: earliest due first; undated last; tie-break by createdAt desc
  copy.sort((a, b) => {
    if (a.dueAt && b.dueAt) {
      const byDue = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      if (byDue !== 0) return byDue;
    } else if (a.dueAt && !b.dueAt) return -1;
    else if (!a.dueAt && b.dueAt) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  return copy;
}
