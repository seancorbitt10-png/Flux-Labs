import { describe, expect, it } from "vitest";
import { nextStudyIntents } from "@/lib/study/intents";

describe("nextStudyIntents", () => {
  it("moves an ask into hint/steps/attempt actions", () => {
    expect(nextStudyIntents("ask")).toEqual(["hint", "steps", "attempt"]);
  });

  it("moves a hint or steps turn toward student work", () => {
    expect(nextStudyIntents("hint")).toEqual(["attempt", "check_work", "steps"]);
    expect(nextStudyIntents("steps")).toEqual(["attempt", "check_work", "hint"]);
  });

  it("moves an attempt into check-work feedback", () => {
    expect(nextStudyIntents("attempt")).toEqual(["check_work", "hint", "steps"]);
  });

  it("keeps every suggested action inside the supported Study intent set", () => {
    const intents = ["ask", "hint", "check_work", "explain", "steps", "attempt"] as const;
    for (const intent of intents) {
      expect(nextStudyIntents(intent)).toHaveLength(3);
      expect(nextStudyIntents(intent).every((next) => intents.includes(next))).toBe(true);
    }
  });
});
