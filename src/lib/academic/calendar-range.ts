/**
 * Timezone-aware calendar range helpers.
 * DB stores absolute instants; ranges are computed in the student profile TZ.
 */

export type Ymd = { year: number; month: number; day: number };

export function ymdInTimeZone(instant: Date, timeZone: string): Ymd {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function formatYmd(ymd: Ymd): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ymd.year}-${pad(ymd.month)}-${pad(ymd.day)}`;
}

export function parseYmd(value: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "UTC",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - date.getTime();
}

/** Interpret a civil local datetime in `timeZone` as a UTC instant. */
export function zonedLocalToUtc(
  ymd: Ymd,
  time: { hour: number; minute: number; second?: number },
  timeZone: string,
): Date {
  const utcGuess = new Date(
    Date.UTC(
      ymd.year,
      ymd.month - 1,
      ymd.day,
      time.hour,
      time.minute,
      time.second ?? 0,
    ),
  );
  const offset = timeZoneOffsetMs(utcGuess, timeZone || "UTC");
  return new Date(utcGuess.getTime() - offset);
}

export function addDaysYmd(ymd: Ymd, days: number): Ymd {
  const utc = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

/**
 * Seven-day agenda window starting at `anchorYmd` (inclusive) in profile TZ.
 * from = local midnight of day 0
 * to   = local end of day 6 (23:59:59.999)
 */
export function sevenDayRange(
  anchorYmd: Ymd,
  timeZone: string,
): { from: Date; to: Date; endYmd: Ymd } {
  const endYmd = addDaysYmd(anchorYmd, 6);
  const from = zonedLocalToUtc(
    anchorYmd,
    { hour: 0, minute: 0, second: 0 },
    timeZone,
  );
  const to = zonedLocalToUtc(
    endYmd,
    { hour: 23, minute: 59, second: 59 },
    timeZone,
  );
  // Include fractional end-of-second for inclusive upper bound.
  const toInclusive = new Date(to.getTime() + 999);
  return { from, to: toInclusive, endYmd };
}

export function todayYmd(timeZone: string, now: Date = new Date()): Ymd {
  return ymdInTimeZone(now, timeZone);
}

export function formatDayHeading(ymd: Ymd, timeZone: string): string {
  const noon = zonedLocalToUtc(ymd, { hour: 12, minute: 0 }, timeZone);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timeZone || "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(noon);
}

export function isSameYmd(a: Ymd, b: Ymd): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}
