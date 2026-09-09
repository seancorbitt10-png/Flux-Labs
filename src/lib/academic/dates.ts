/**
 * Presentation helpers for academic timestamps.
 * DB stores absolute instants; UI displays in the student profile timezone.
 * datetime-local form controls use the device local zone (browser contract).
 */

export function formatAcademicInstant(
  value: Date | string | null | undefined,
  timeZone: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (value == null) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timeZone || "UTC",
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(date);
}

/** Convert an ISO/Date instant into a datetime-local input value (device local). */
export function toDatetimeLocalValue(
  value: Date | string | null | undefined,
): string {
  if (value == null) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parse datetime-local (device local) into ISO string, or null if empty. */
export function fromDatetimeLocalValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
