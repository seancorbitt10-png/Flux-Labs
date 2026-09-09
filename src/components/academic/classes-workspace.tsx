"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  createClassAction,
  deleteClassAction,
  loadClassesWorkspaceAction,
  setClassStatusAction,
  updateClassAction,
} from "@/lib/academic/actions";
import {
  fromDatetimeLocalValue,
  formatAcademicInstant,
  toDatetimeLocalValue,
} from "@/lib/academic/dates";
import type { ClassView } from "@/lib/academic/views";
import type { ClassesWorkspaceBootstrap } from "@/lib/academic/workspace";

type ClassFormState = {
  name: string;
  term: string;
  courseCode: string;
  instructorName: string;
  description: string;
  startsAt: string;
  endsAt: string;
};

const emptyForm = (): ClassFormState => ({
  name: "",
  term: "",
  courseCode: "",
  instructorName: "",
  description: "",
  startsAt: "",
  endsAt: "",
});

function formFromClass(row: ClassView): ClassFormState {
  return {
    name: row.name,
    term: row.term,
    courseCode: row.courseCode ?? "",
    instructorName: row.instructorName ?? "",
    description: row.description ?? "",
    startsAt: toDatetimeLocalValue(row.startsAt),
    endsAt: toDatetimeLocalValue(row.endsAt),
  };
}

function formToPayload(form: ClassFormState): Record<string, unknown> {
  return {
    name: form.name,
    term: form.term,
    courseCode: form.courseCode.trim() ? form.courseCode : null,
    instructorName: form.instructorName.trim() ? form.instructorName : null,
    description: form.description.trim() ? form.description : null,
    startsAt: fromDatetimeLocalValue(form.startsAt),
    endsAt: fromDatetimeLocalValue(form.endsAt),
  };
}

export function ClassesWorkspace({
  initial,
}: {
  initial: ClassesWorkspaceBootstrap;
}) {
  const [pending, startTransition] = useTransition();
  const [classes, setClasses] = useState(initial.classes);
  const [timezone] = useState(initial.timezone);
  const [showArchived, setShowArchived] = useState(false);
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ClassFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      classes.filter((c) =>
        showArchived ? c.status === "ARCHIVED" : c.status === "ACTIVE",
      ),
    [classes, showArchived],
  );

  function refresh() {
    startTransition(async () => {
      const result = await loadClassesWorkspaceAction();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setClasses(result.data.classes);
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

  function openEdit(row: ClassView) {
    setMode("edit");
    setEditingId(row.id);
    setForm(formFromClass(row));
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
    const payload = formToPayload(form);

    startTransition(async () => {
      const result =
        mode === "edit" && editingId
          ? await updateClassAction({ classId: editingId, input: payload })
          : await createClassAction(payload);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setClasses((prev) => {
        const without = prev.filter((c) => c.id !== result.data.class.id);
        return [...without, result.data.class].sort((a, b) => {
          const byTerm = b.term.localeCompare(a.term);
          if (byTerm !== 0) return byTerm;
          return a.name.localeCompare(b.name);
        });
      });
      setStatusMessage(mode === "edit" ? "Class updated." : "Class created.");
      closeForm();
    });
  }

  function setStatus(row: ClassView, status: "ACTIVE" | "ARCHIVED") {
    setError(null);
    startTransition(async () => {
      const result = await setClassStatusAction({ classId: row.id, status });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setClasses((prev) =>
        prev.map((c) => (c.id === row.id ? result.data.class : c)),
      );
      setStatusMessage(
        status === "ARCHIVED" ? "Class archived." : "Class restored.",
      );
    });
  }

  function confirmDelete(row: ClassView) {
    setConfirmDeleteId(row.id);
    setError(null);
  }

  function runDelete(classId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteClassAction({ classId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setClasses((prev) => prev.filter((c) => c.id !== classId));
      setConfirmDeleteId(null);
      setStatusMessage(
        result.data.tasksDetached > 0
          ? `Class deleted. ${result.data.tasksDetached} task(s) kept without a class.`
          : "Class deleted.",
      );
      if (editingId === classId) closeForm();
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
          New class
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setShowArchived((v) => !v);
            setConfirmDeleteId(null);
          }}
          disabled={pending}
        >
          {showArchived ? "Show active" : "Show archived"}
        </Button>
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
          className="rounded-md border border-red-500/30 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      {statusMessage ? (
        <p className="text-sm text-foreground/65" aria-live="polite">
          {statusMessage}
        </p>
      ) : null}

      {mode !== "list" ? (
        <form
          onSubmit={onSubmit}
          className="space-y-3 rounded-lg border border-foreground/15 bg-background/70 p-4"
        >
          <h2 className="font-display text-xl tracking-tight">
            {mode === "edit" ? "Edit class" : "Create class"}
          </h2>
          <Input
            label="Name"
            name="name"
            required
            maxLength={120}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label="Term"
            name="term"
            required
            maxLength={80}
            placeholder="Fall 2026"
            value={form.term}
            onChange={(e) => setForm((f) => ({ ...f, term: e.target.value }))}
          />
          <Input
            label="Course code"
            name="courseCode"
            maxLength={40}
            value={form.courseCode}
            onChange={(e) =>
              setForm((f) => ({ ...f, courseCode: e.target.value }))
            }
          />
          <Input
            label="Instructor"
            name="instructorName"
            maxLength={120}
            value={form.instructorName}
            onChange={(e) =>
              setForm((f) => ({ ...f, instructorName: e.target.value }))
            }
          />
          <label className="block space-y-1.5">
            <span className="text-sm text-foreground/70">Description</span>
            <textarea
              name="description"
              maxLength={5000}
              rows={3}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              className="w-full rounded-md border border-foreground/15 bg-background/80 px-3 py-2 text-sm outline-none transition focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
            />
          </label>
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
              label="Ends"
              name="endsAt"
              type="datetime-local"
              value={form.endsAt}
              onChange={(e) =>
                setForm((f) => ({ ...f, endsAt: e.target.value }))
              }
            />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" disabled={pending}>
              {mode === "edit" ? "Save changes" : "Create class"}
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
          title={showArchived ? "No archived classes" : "No classes yet"}
          body={
            showArchived
              ? "Archived classes will show up here when you archive an active class."
              : "Add the courses you are taking so tasks can stay organized by class."
          }
          action={
            showArchived ? undefined : (
              <Button type="button" onClick={openCreate} disabled={pending}>
                Create a class
              </Button>
            )
          }
        />
      ) : (
        <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
          {visible.map((row) => (
            <li key={row.id} className="py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <h3 className="truncate text-base font-medium">
                      {row.name}
                    </h3>
                    {row.courseCode ? (
                      <span className="font-mono text-xs text-foreground/55">
                        {row.courseCode}
                      </span>
                    ) : null}
                    <span className="text-xs uppercase tracking-wide text-foreground/45">
                      {row.status.toLowerCase()}
                    </span>
                  </div>
                  <p className="text-sm text-foreground/65">
                    {row.term}
                    {row.instructorName ? ` · ${row.instructorName}` : ""}
                  </p>
                  {row.description ? (
                    <p className="text-sm leading-relaxed text-foreground/60">
                      {row.description}
                    </p>
                  ) : null}
                  {(row.startsAt || row.endsAt) && (
                    <p className="text-xs text-foreground/50">
                      {row.startsAt
                        ? formatAcademicInstant(row.startsAt, timezone)
                        : "—"}
                      {" → "}
                      {row.endsAt
                        ? formatAcademicInstant(row.endsAt, timezone)
                        : "—"}
                    </p>
                  )}
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
                  {row.status === "ACTIVE" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setStatus(row, "ARCHIVED")}
                      disabled={pending}
                    >
                      Archive
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setStatus(row, "ACTIVE")}
                      disabled={pending}
                    >
                      Unarchive
                    </Button>
                  )}
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
                      onClick={() => confirmDelete(row)}
                      disabled={pending}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
              {confirmDeleteId === row.id ? (
                <p className="mt-2 text-xs text-foreground/55">
                  Deleting removes the class. Tasks stay and lose this class
                  link.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
