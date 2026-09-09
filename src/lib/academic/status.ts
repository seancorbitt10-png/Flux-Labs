import type { TaskStatus } from "@prisma/client";
import { ValidationError } from "@/lib/errors";

/**
 * Allowed Task status transitions (Phase 3 architecture).
 * COMPLETED/CANCELLED reopen only via explicit mutation to permitted targets.
 */
const ALLOWED: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  TODO: new Set(["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  IN_PROGRESS: new Set(["IN_PROGRESS", "TODO", "COMPLETED", "CANCELLED"]),
  COMPLETED: new Set(["COMPLETED", "TODO", "IN_PROGRESS"]),
  CANCELLED: new Set(["CANCELLED", "TODO"]),
};

export function assertValidTaskStatusTransition(
  from: TaskStatus,
  to: TaskStatus,
): void {
  if (!ALLOWED[from].has(to)) {
    throw new ValidationError(
      `Invalid task status transition from ${from} to ${to}.`,
    );
  }
}

/** Server-owned completedAt consistency for a target status. */
export function completedAtForStatus(
  status: TaskStatus,
  now: Date = new Date(),
): Date | null {
  return status === "COMPLETED" ? now : null;
}
