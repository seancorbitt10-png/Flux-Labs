import { describe, expect, it } from "vitest";
import {
  addDaysYmd,
  formatYmd,
  parseYmd,
  sevenDayRange,
  todayYmd,
  zonedLocalToUtc,
} from "@/lib/academic/calendar-range";
import {
  groupCalendarItemsByDay,
  type CalendarItemView,
} from "@/lib/academic/calendar-views";

describe("calendar range helpers", () => {
  it("parses and formats YMD keys", () => {
    expect(parseYmd("2026-09-09")).toEqual({
      year: 2026,
      month: 9,
      day: 9,
    });
    expect(formatYmd({ year: 2026, month: 9, day: 9 })).toBe("2026-09-09");
    expect(parseYmd("bad")).toBeNull();
  });

  it("builds a seven-day inclusive range in America/New_York", () => {
    const anchor = { year: 2026, month: 9, day: 9 };
    const { from, to, endYmd } = sevenDayRange(anchor, "America/New_York");
    expect(formatYmd(endYmd)).toBe("2026-09-15");
    expect(from.toISOString()).toBe(
      zonedLocalToUtc(anchor, { hour: 0, minute: 0, second: 0 }, "America/New_York").toISOString(),
    );
    expect(to.getTime()).toBeGreaterThan(from.getTime());
    // EDT: Sep 9 00:00 local = 04:00 UTC
    expect(from.toISOString()).toBe("2026-09-09T04:00:00.000Z");
  });

  it("advances days without month overflow errors", () => {
    expect(formatYmd(addDaysYmd({ year: 2026, month: 1, day: 30 }, 3))).toBe(
      "2026-02-02",
    );
  });

  it("resolves today in a timezone", () => {
    const ymd = todayYmd("UTC", new Date("2026-03-01T12:00:00.000Z"));
    expect(formatYmd(ymd)).toBe("2026-03-01");
  });
});

describe("calendar day grouping", () => {
  it("groups mixed items by local day and marks today", () => {
    const items: CalendarItemView[] = [
      {
        kind: "task",
        id: "t1",
        title: "Essay",
        status: "TODO",
        dueAt: "2026-09-10T16:00:00.000Z",
        startsAt: null,
        priority: 1,
        estimatedMinutes: null,
        classId: null,
        className: null,
        courseCode: null,
        sortAt: "2026-09-10T16:00:00.000Z",
      },
      {
        kind: "class_period",
        id: "c1",
        name: "Biology",
        term: "Fall 2026",
        courseCode: "BIO",
        startsAt: "2026-09-09T14:00:00.000Z",
        endsAt: "2026-09-09T15:00:00.000Z",
        sortAt: "2026-09-09T14:00:00.000Z",
      },
    ];
    const days = groupCalendarItemsByDay(
      items,
      "UTC",
      "2026-09-09",
      (k) => k,
    );
    expect(days.map((d) => d.dateKey)).toEqual(["2026-09-09", "2026-09-10"]);
    expect(days[0]?.isToday).toBe(true);
    expect(days[0]?.items[0]?.kind).toBe("class_period");
    expect(days[1]?.items[0]?.kind).toBe("task");
  });
});
