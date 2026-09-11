"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  loadCalendarWorkspaceAction,
  navigateCalendarAction,
} from "@/lib/academic/actions";
import { formatAcademicInstant } from "@/lib/academic/dates";
import type { CalendarItemView } from "@/lib/academic/calendar-views";
import type { CalendarWorkspaceBootstrap } from "@/lib/academic/workspace";
import type { TaskStatus } from "@prisma/client";

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

function priorityTone(
  priority: number | null,
): "neutral" | "warning" | "danger" {
  if (priority == null) return "neutral";
  if (priority <= 2) return "danger";
  if (priority === 3) return "warning";
  return "neutral";
}

function CalendarItemCard({
  item,
  timezone,
}: {
  item: CalendarItemView;
  timezone: string;
}) {
  if (item.kind === "class_period") {
    return (
      <article className="flux-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold tracking-tight">{item.name}</h3>
          <Badge tone="info">Class</Badge>
          {item.courseCode ? (
            <span className="text-xs font-semibold text-muted">
              {item.courseCode}
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-sm font-medium text-muted">
          {item.term}
          {item.startsAt || item.endsAt
            ? ` · ${[
                item.startsAt
                  ? formatAcademicInstant(item.startsAt, timezone)
                  : null,
                item.endsAt
                  ? formatAcademicInstant(item.endsAt, timezone)
                  : null,
              ]
                .filter(Boolean)
                .join(" – ")}`
            : ""}
        </p>
        <p className="mt-3">
          <Link
            href="/classes"
            className="text-sm font-semibold text-accent underline-offset-2 hover:underline"
          >
            Open Classes
          </Link>
        </p>
      </article>
    );
  }

  const muted = item.status === "COMPLETED" || item.status === "CANCELLED";
  return (
    <article className={`flux-card p-4 ${muted ? "opacity-80" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3
          className={`text-base font-semibold tracking-tight ${
            item.status === "COMPLETED" ? "line-through text-foreground/70" : ""
          }`}
        >
          {item.title}
        </h3>
        <Badge tone="accent">Task</Badge>
        <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
        {item.priority != null ? (
          <Badge tone={priorityTone(item.priority)}>P{item.priority}</Badge>
        ) : null}
      </div>
      <p className="mt-2 text-sm font-medium text-muted">
        {item.className ?? "No class"}
        {item.dueAt ? (
          <span className="text-foreground/85">
            {" · Due "}
            {formatAcademicInstant(item.dueAt, timezone)}
          </span>
        ) : item.startsAt ? (
          <span className="text-foreground/85">
            {" · Starts "}
            {formatAcademicInstant(item.startsAt, timezone)}
          </span>
        ) : null}
        {item.estimatedMinutes ? ` · ${item.estimatedMinutes} min` : ""}
      </p>
      <p className="mt-3">
        <Link
          href="/tasks"
          className="text-sm font-semibold text-accent underline-offset-2 hover:underline"
        >
          Open Tasks
        </Link>
      </p>
    </article>
  );
}

export function CalendarWorkspace({
  initial,
}: {
  initial: CalendarWorkspaceBootstrap;
}) {
  const [pending, startTransition] = useTransition();
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [classId, setClassId] = useState(initial.classId ?? "");
  const [status, setStatus] = useState<string>(initial.status ?? "");

  const activeClassOptions = useMemo(
    () => data.classOptions.filter((c) => c.status === "ACTIVE"),
    [data.classOptions],
  );

  function applyResult(next: CalendarWorkspaceBootstrap) {
    setData(next);
    setClassId(next.classId ?? "");
    setStatus(next.status ?? "");
  }

  function reload(opts?: {
    anchorDate?: string;
    classId?: string | null;
    status?: TaskStatus | null;
  }) {
    setError(null);
    startTransition(async () => {
      const result = await loadCalendarWorkspaceAction({
        anchorDate: opts?.anchorDate ?? data.anchorDate,
        classId:
          opts && "classId" in opts
            ? opts.classId
            : classId.trim()
              ? classId
              : null,
        status:
          opts && "status" in opts
            ? opts.status
            : status
              ? (status as TaskStatus)
              : null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      applyResult(result.data);
    });
  }

  function navigate(direction: "prev" | "next" | "today") {
    setError(null);
    startTransition(async () => {
      const result = await navigateCalendarAction({
        direction,
        anchorDate: data.anchorDate,
        classId: classId.trim() ? classId : null,
        status: status ? (status as TaskStatus) : null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      applyResult(result.data);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate("prev")}
            disabled={pending}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate("today")}
            disabled={pending}
          >
            Today
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate("next")}
            disabled={pending}
          >
            Next
          </Button>
        </div>
        <p className="text-sm font-semibold tracking-tight text-foreground">
          {data.rangeLabel}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-medium text-muted">
          <span className="sr-only">Class filter</span>
          <select
            className="flux-select"
            value={classId}
            disabled={pending}
            onChange={(e) => {
              const next = e.target.value;
              setClassId(next);
              reload({
                classId: next.trim() ? next : null,
                status: status ? (status as TaskStatus) : null,
              });
            }}
          >
            <option value="">All classes</option>
            {activeClassOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-muted">
          <span className="sr-only">Task status filter</span>
          <select
            className="flux-select"
            value={status}
            disabled={pending}
            onChange={(e) => {
              const next = e.target.value;
              setStatus(next);
              reload({
                classId: classId.trim() ? classId : null,
                status: next ? (next as TaskStatus) : null,
              });
            }}
          >
            <option value="">All items</option>
            <option value="TODO">Tasks · To do</option>
            <option value="IN_PROGRESS">Tasks · In progress</option>
            <option value="COMPLETED">Tasks · Completed</option>
            <option value="CANCELLED">Tasks · Cancelled</option>
          </select>
        </label>
        <Button
          type="button"
          variant="ghost"
          onClick={() => reload()}
          disabled={pending}
        >
          Refresh
        </Button>
      </div>

      {status ? (
        <p className="text-xs font-medium text-muted">
          Task status filter hides class periods (calendar domain contract).
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger"
        >
          {error}
        </p>
      ) : null}

      {pending ? (
        <p className="text-sm font-medium text-muted" aria-live="polite">
          Updating calendar…
        </p>
      ) : null}

      {data.days.length === 0 ? (
        <EmptyState
          title="Nothing in this week"
          body="No dated tasks or class periods fall in this range. Add due dates on Tasks or term dates on Classes."
          action={
            <div className="flex flex-wrap gap-2">
              <Link href="/tasks">
                <Button type="button">Go to Tasks</Button>
              </Link>
              <Link href="/classes">
                <Button type="button" variant="secondary">
                  Go to Classes
                </Button>
              </Link>
            </div>
          }
        />
      ) : (
        <div className="space-y-8">
          {data.days.map((day) => (
            <section key={day.dateKey} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 border-b border-foreground/10 pb-2">
                <h2 className="text-sm font-bold tracking-tight uppercase text-foreground">
                  {day.isToday ? "Today · " : ""}
                  {day.label}
                </h2>
                <span className="text-xs font-semibold text-muted">
                  {day.items.length} item{day.items.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="space-y-3">
                {day.items.map((item) => (
                  <li key={`${item.kind}-${item.id}`}>
                    <CalendarItemCard item={item} timezone={data.timezone} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {data.truncated ? (
        <p className="text-xs font-medium text-muted">
          More matching items exist beyond this page. Narrow the class filter
          or week range if needed.
        </p>
      ) : null}
    </div>
  );
}
