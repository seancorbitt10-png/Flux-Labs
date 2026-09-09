"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  createTaskAction,
  deleteTaskAction,
  loadTasksWorkspaceAction,
  setTaskStatusAction,
  updateTaskAction,
} from "@/lib/academic/actions";
import {
  fromDatetimeLocalValue,
  formatAcademicInstant,
  toDatetimeLocalValue,
} from "@/lib/academic/dates";
import {
  filterTasks,
  sortTasks,
  type TaskListFilter,
  type TaskListSort,
  type TaskView,
} from "@/lib/academic/views";
import type { TasksWorkspaceBootstrap } from "@/lib/academic/workspace";
import type { TaskStatus } from "@prisma/client";

type TaskFormState = {
  title: string;
  description: string;
  classId: string;
  status: TaskStatus;
  priority: string;
  dueAt: string;
  startsAt: string;
  estimatedMinutes: string;
};

const emptyForm = (): TaskFormState => ({
  title: "",
  description: "",
  classId: "",
  status: "TODO",
  priority: "",
  dueAt: "",
  startsAt: "",
  estimatedMinutes: "",
});

function formFromTask(row: TaskView): TaskFormState {
  return {
    title: row.title,
    description: row.description ?? "",
    classId: row.classId ?? "",
    status: row.status,
    priority: row.priority != null ? String(row.priority) : "",
    dueAt: toDatetimeLocalValue(row.dueAt),
    startsAt: toDatetimeLocalValue(row.startsAt),
    estimatedMinutes:
      row.estimatedMinutes != null ? String(row.estimatedMinutes) : "",
  };
}

function formToCreatePayload(form: TaskFormState): Record<string, unknown> {
  return {
    title: form.title,
    description: form.description.trim() ? form.description : null,
    classId: form.classId.trim() ? form.classId : null,
    status: form.status === "TODO" || form.status === "IN_PROGRESS"
      ? form.status
      : "TODO",
    priority: form.priority ? Number(form.priority) : null,
    dueAt: fromDatetimeLocalValue(form.dueAt),
    startsAt: fromDatetimeLocalValue(form.startsAt),
    estimatedMinutes: form.estimatedMinutes
      ? Number(form.estimatedMinutes)
      : null,
  };
}

function formToUpdatePayload(form: TaskFormState): Record<string, unknown> {
  return {
    title: form.title,
    description: form.description.trim() ? form.description : null,
    classId: form.classId.trim() ? form.classId : null,
    status: form.status,
    priority: form.priority ? Number(form.priority) : null,
    dueAt: fromDatetimeLocalValue(form.dueAt),
    startsAt: fromDatetimeLocalValue(form.startsAt),
    estimatedMinutes: form.estimatedMinutes
      ? Number(form.estimatedMinutes)
      : null,
  };
}

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case "IN_PROGRESS":
      return "In progress";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return "To do";
  }
}

function statusTone(
  status: TaskStatus,
): "neutral" | "accent" | "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "IN_PROGRESS":
      return "info";
    case "COMPLETED":
      return "success";
    case "CANCELLED":
      return "neutral";
    default:
      return "accent";
  }
}

function priorityTone(
  priority: number | null,
): "neutral" | "warning" | "danger" {
  if (priority == null) return "neutral";
  if (priority <= 2) return "danger";
  if (priority === 3) return "warning";
  return "neutral";
}

export function TasksWorkspace({
  initial,
}: {
  initial: TasksWorkspaceBootstrap;
}) {
  const [pending, startTransition] = useTransition();
  const [tasks, setTasks] = useState(initial.tasks);
  const [classOptions, setClassOptions] = useState(initial.classOptions);
  const [timezone] = useState(initial.timezone);
  const [filter, setFilter] = useState<TaskListFilter>("active");
  const [sort, setSort] = useState<TaskListSort>("due_soon");
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TaskFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const visible = useMemo(
    () => sortTasks(filterTasks(tasks, filter), sort),
    [tasks, filter, sort],
  );

  const activeClassOptions = useMemo(
    () => classOptions.filter((c) => c.status === "ACTIVE"),
    [classOptions],
  );

  function upsertTask(task: TaskView) {
    setTasks((prev) => {
      const without = prev.filter((t) => t.id !== task.id);
      return [...without, task];
    });
  }

  function refresh() {
    startTransition(async () => {
      const result = await loadTasksWorkspaceAction();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setTasks(result.data.tasks);
      setClassOptions(result.data.classOptions);
    });
  }

  function openCreate() {
    setMode("create");
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
    setStatusMessage(null);
    setConfirmDeleteId(null);
  }

  function openEdit(row: TaskView) {
    setMode("edit");
    setEditingId(row.id);
    setForm(formFromTask(row));
    setError(null);
    setStatusMessage(null);
    setConfirmDeleteId(null);
  }

  function closeForm() {
    setMode("list");
    setEditingId(null);
    setForm(emptyForm());
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setStatusMessage(null);

    startTransition(async () => {
      const result =
        mode === "edit" && editingId
          ? await updateTaskAction({
              taskId: editingId,
              input: formToUpdatePayload(form),
            })
          : await createTaskAction(formToCreatePayload(form));

      if (!result.ok) {
        setError(result.message);
        return;
      }

      upsertTask(result.data.task);
      setStatusMessage(mode === "edit" ? "Task updated." : "Task created.");
      closeForm();
    });
  }

  function setStatus(row: TaskView, status: TaskStatus) {
    setError(null);
    startTransition(async () => {
      const result = await setTaskStatusAction({ taskId: row.id, status });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      upsertTask(result.data.task);
      setStatusMessage(`Marked ${statusLabel(status).toLowerCase()}.`);
    });
  }

  function runDelete(taskId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteTaskAction({ taskId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setConfirmDeleteId(null);
      setStatusMessage("Task deleted.");
      if (editingId === taskId) closeForm();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={openCreate}
          disabled={pending || mode === "create"}
        >
          New task
        </Button>
        <label className="flex items-center gap-2 text-sm font-medium text-muted">
          <span className="sr-only">Filter</span>
          <select
            className="flux-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value as TaskListFilter)}
            disabled={pending}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-muted">
          <span className="sr-only">Sort</span>
          <select
            className="flux-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as TaskListSort)}
            disabled={pending}
          >
            <option value="due_soon">Due soon</option>
            <option value="recent">Recently created</option>
          </select>
        </label>
        <Button
          type="button"
          variant="ghost"
          onClick={refresh}
          disabled={pending}
        >
          Refresh
        </Button>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger"
        >
          {error}
        </p>
      ) : null}
      {statusMessage ? (
        <p className="text-sm font-medium text-muted" aria-live="polite">
          {statusMessage}
        </p>
      ) : null}

      {mode !== "list" ? (
        <form
          onSubmit={onSubmit}
          className="flux-card space-y-3 p-4 sm:p-5"
        >
          <h2 className="text-lg font-bold tracking-tight">
            {mode === "edit" ? "Edit task" : "Create task"}
          </h2>
          <Input
            label="Title"
            name="title"
            required
            maxLength={300}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground/75">
              Description
            </span>
            <textarea
              name="description"
              maxLength={5000}
              rows={3}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              className="w-full rounded-lg border border-foreground/12 bg-surface px-3 py-2 text-sm font-medium outline-none transition focus:border-accent/50 focus:ring-2 focus:ring-accent/25"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground/75">Class</span>
            <select
              name="classId"
              value={form.classId}
              onChange={(e) =>
                setForm((f) => ({ ...f, classId: e.target.value }))
              }
              className="flux-select w-full"
            >
              <option value="">No class</option>
              {activeClassOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.term}
                </option>
              ))}
              {form.classId &&
              !activeClassOptions.some((c) => c.id === form.classId) ? (
                <option value={form.classId}>
                  {classOptions.find((c) => c.id === form.classId)?.name ??
                    "Current class"}{" "}
                  (archived)
                </option>
              ) : null}
            </select>
          </label>
          {mode === "edit" ? (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground/75">
                Status
              </span>
              <select
                name="status"
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    status: e.target.value as TaskStatus,
                  }))
                }
                className="flux-select w-full"
              >
                <option value="TODO">To do</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </label>
          ) : (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground/75">
                Starting status
              </span>
              <select
                name="status"
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    status: e.target.value as TaskStatus,
                  }))
                }
                className="flux-select w-full"
              >
                <option value="TODO">To do</option>
                <option value="IN_PROGRESS">In progress</option>
              </select>
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground/75">
                Priority (1–5)
              </span>
              <select
                name="priority"
                value={form.priority}
                onChange={(e) =>
                  setForm((f) => ({ ...f, priority: e.target.value }))
                }
                className="flux-select w-full"
              >
                <option value="">None</option>
                <option value="1">1 · Highest</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5 · Lowest</option>
              </select>
            </label>
            <Input
              label="Estimated minutes"
              name="estimatedMinutes"
              type="number"
              min={1}
              max={10080}
              value={form.estimatedMinutes}
              onChange={(e) =>
                setForm((f) => ({ ...f, estimatedMinutes: e.target.value }))
              }
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Starts"
              name="startsAt"
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) =>
                setForm((f) => ({ ...f, startsAt: e.target.value }))
              }
            />
            <Input
              label="Due"
              name="dueAt"
              type="datetime-local"
              value={form.dueAt}
              onChange={(e) =>
                setForm((f) => ({ ...f, dueAt: e.target.value }))
              }
            />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" disabled={pending}>
              {mode === "edit" ? "Save changes" : "Create task"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={closeForm}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          title={
            filter === "active"
              ? "No active tasks"
              : filter === "completed"
                ? "No completed tasks"
                : filter === "cancelled"
                  ? "No cancelled tasks"
                  : "No tasks yet"
          }
          body={
            filter === "all" || filter === "active"
              ? "Capture assignments and deadlines here. Link them to a class when you have one."
              : "Nothing in this view right now. Switch the filter to see other tasks."
          }
          action={
            filter === "all" || filter === "active" ? (
              <Button type="button" onClick={openCreate} disabled={pending}>
                Create a task
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => {
            const muted =
              row.status === "COMPLETED" || row.status === "CANCELLED";
            return (
              <li
                key={row.id}
                className={`flux-card p-4 sm:p-5 ${muted ? "opacity-80" : ""}`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3
                        className={`text-base font-semibold tracking-tight sm:text-lg ${
                          row.status === "COMPLETED"
                            ? "text-foreground/70 line-through"
                            : ""
                        }`}
                      >
                        {row.title}
                      </h3>
                      <Badge tone={statusTone(row.status)}>
                        {statusLabel(row.status)}
                      </Badge>
                      {row.priority != null ? (
                        <Badge tone={priorityTone(row.priority)}>
                          P{row.priority}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-sm font-medium text-muted">
                      <span>{row.className ? row.className : "No class"}</span>
                      {row.dueAt ? (
                        <span className="text-foreground/85">
                          {" · Due "}
                          {formatAcademicInstant(row.dueAt, timezone)}
                        </span>
                      ) : null}
                      {row.estimatedMinutes
                        ? ` · ${row.estimatedMinutes} min`
                        : ""}
                    </p>
                    {row.description ? (
                      <p className="text-sm font-medium leading-relaxed text-foreground/70">
                        {row.description}
                      </p>
                    ) : null}
                    {row.completedAt ? (
                      <p className="text-xs font-medium text-foreground/45">
                        Completed{" "}
                        {formatAcademicInstant(row.completedAt, timezone)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => openEdit(row)}
                      disabled={pending}
                    >
                      Edit
                    </Button>
                    {row.status === "TODO" || row.status === "IN_PROGRESS" ? (
                      <>
                        {row.status === "TODO" ? (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setStatus(row, "IN_PROGRESS")}
                            disabled={pending}
                          >
                            Start
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setStatus(row, "COMPLETED")}
                          disabled={pending}
                        >
                          Complete
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setStatus(row, "CANCELLED")}
                          disabled={pending}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : null}
                    {row.status === "COMPLETED" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setStatus(row, "TODO")}
                        disabled={pending}
                      >
                        Reopen
                      </Button>
                    ) : null}
                    {row.status === "CANCELLED" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setStatus(row, "TODO")}
                        disabled={pending}
                      >
                        Restore
                      </Button>
                    ) : null}
                    {confirmDeleteId === row.id ? (
                      <>
                        <Button
                          type="button"
                          onClick={() => runDelete(row.id)}
                          disabled={pending}
                        >
                          Confirm delete
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={pending}
                        >
                          Keep
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setConfirmDeleteId(row.id)}
                        disabled={pending}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
