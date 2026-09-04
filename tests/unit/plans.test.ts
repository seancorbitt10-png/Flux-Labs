import { describe, expect, it } from "vitest";
import {
  capabilityToLimitKey,
  getPlanDefinition,
} from "@/lib/entitlements/plans";

describe("plan entitlements config", () => {
  it("defines a controlled trial with finite AI sessions", () => {
    const trial = getPlanDefinition("FREE_TRIAL");
    expect(trial.trialDays).toBe(7);
    expect(trial.limits.aiSessions).toBe(10);
    expect(trial.limits.documentAnalyses).toBe(3);
    expect(trial.limits.advancedTutoring).toBe(1);
    expect(trial.limits.aiBudgetMicros).toBeLessThanOrEqual(2_000_000);
  });

  it("maps capabilities to limit keys", () => {
    expect(capabilityToLimitKey("AI_SESSION")).toBe("aiSessions");
    expect(capabilityToLimitKey("DOCUMENT_ANALYSIS")).toBe("documentAnalyses");
    expect(capabilityToLimitKey("GENERAL")).toBe("aiSessions");
  });

  it("exposes user-facing capabilities without requiring model names", () => {
    const plus = getPlanDefinition("PLUS");
    expect(plus.capabilities.length).toBeGreaterThan(0);
    expect(plus.label).toBe("Plus");
  });
});
