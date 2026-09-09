import { describe, expect, it } from "vitest";
import {
  fromDatetimeLocalValue,
  formatAcademicInstant,
  toDatetimeLocalValue,
} from "@/lib/academic/dates";
import {
  filterTasks,
  sortTasks,
  type TaskView,
} from "@/lib/academic/views";

function task(partial: Partial<TaskView> & Pick<TaskView, "id" | "title">): TaskView {
  return {
    description: null,
    status: "TODO",
    classId: null,
    className: null,
    priority: null,
    dueAt: null,
    startsAt: null,
    estimatedMinutes: null,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("academic date helpers", () => {
  it("formats instants in a profile timezone", () => {
    const formatted = formatAcademicInstant(
      "2026-06-15T16:00:00.000Z",
      "America/New_York",
      { dateStyle: "medium", timeStyle: "short" },
    );
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).not.toMatch(/Invalid/i);
  });

  it("round-trips datetime-local through device-local helpers", () => {
    const iso = fromDatetimeLocalValue("2026-09-10T09:30");
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const local = toDatetimeLocalValue(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("treats empty datetime-local as null", () => {
    expect(fromDatetimeLocalValue("")).toBeNull();
    expect(fromDatetimeLocalValue("   ")).toBeNull();
  });
});

describe("task list filter/sort", () => {
  const sample: TaskView[] = [
    task({
      id: "1",
      title: "A",
      status: "TODO",
      dueAt: "2026-10-20T00:00:00.000Z",
      createdAt: "2026-10-01T00:00:00.000Z",
    }),
    task({
      id: "2",
      title: "B",
      status: "IN_PROGRESS",
      dueAt: "2026-10-10T00:00:00.000Z",
      createdAt: "2026-10-02T00:00:00.000Z",
    }),
    task({
      id: "3",
      title: "C",
      status: "COMPLETED",
      dueAt: "2026-10-05T00:00:00.000Z",
      createdAt: "2026-10-03T00:00:00.000Z",
    }),
    task({
      id: "4",
      title: "D",
      status: "CANCELLED",
      dueAt: null,
      createdAt: "2026-10-04T00:00:00.000Z",
    }),
  ];

  it("filters active/completed/cancelled/all", () => {
    expect(filterTasks(sample, "active").map((t) => t.id)).toEqual(["1", "2"]);
    expect(filterTasks(sample, "completed").map((t) => t.id)).toEqual(["3"]);
    expect(filterTasks(sample, "cancelled").map((t) => t.id)).toEqual(["4"]);
    expect(filterTasks(sample, "all")).toHaveLength(4);
  });

  it("sorts due soon with undated last", () => {
    const ordered = sortTasks(sample, "due_soon").map((t) => t.id);
    expect(ordered).toEqual(["3", "2", "1", "4"]);
  });

  it("sorts recently created", () => {
    const ordered = sortTasks(sample, "recent").map((t) => t.id);
    expect(ordered).toEqual(["4", "3", "2", "1"]);
  });
});
