import { describe, expect, it } from "vitest";
import {
  assertNoClientStudyAuthority,
  STUDY_CLIENT_FORBIDDEN_FIELDS,
} from "@/lib/study/client-guards";

describe("Study client authority guards (Slice 3)", () => {
  it("allows ID-only focus fields", () => {
    expect(() =>
      assertNoClientStudyAuthority({
        message: "help",
        intent: "ask",
        classId: "class_1",
        taskId: "task_1",
        conceptIds: ["c1"],
        focusLabel: "Biology",
      }),
    ).not.toThrow();
  });

  it("rejects academic context blobs and policy overrides", () => {
    for (const field of [
      "class",
      "task",
      "classes",
      "tasks",
      "concept",
      "concepts",
      "academicWorkspace",
      "assistanceMode",
      "policyMode",
      "systemDirective",
      "taskType",
    ] as const) {
      expect(STUDY_CLIENT_FORBIDDEN_FIELDS as readonly string[]).toContain(field);
      expect(() =>
        assertNoClientStudyAuthority({
          message: "help",
          [field]: { id: "x", name: "forged" },
        }),
      ).toThrow(new RegExp(field));
    }
  });
});
