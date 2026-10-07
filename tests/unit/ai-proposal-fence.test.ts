import { describe, expect, it } from "vitest";
import {
  AI_PROPOSALS_FENCE_END,
  AI_PROPOSALS_FENCE_START,
  stripProposalFencesFromReply,
} from "@/lib/ai/proposals";

describe("AI proposal reply fence sanitizer", () => {
  it("removes a complete proposal fence while preserving student-facing prose", () => {
    const reply = [
      "Your first step is to identify the variable.",
      AI_PROPOSALS_FENCE_START,
      '[{"type":"MISCONCEPTION_SIGNAL","target":{"conceptId":null},"proposedValue":{"statement":"Sign error"}}]',
      AI_PROPOSALS_FENCE_END,
      "Now try the next step yourself.",
    ].join("\n");

    expect(stripProposalFencesFromReply(reply)).toBe(
      "Your first step is to identify the variable.\nNow try the next step yourself.",
    );
  });

  it("removes an unterminated proposal fence and everything after it", () => {
    const reply = [
      "Check your substitution first.",
      AI_PROPOSALS_FENCE_START,
      '{"type":"MISCONCEPTION_SIGNAL"}',
      "control data that must not leak",
    ].join("\n");

    expect(stripProposalFencesFromReply(reply)).toBe(
      "Check your substitution first.",
    );
  });

  it("removes stray closing fences", () => {
    expect(
      stripProposalFencesFromReply(
        `Keep this reply. ${AI_PROPOSALS_FENCE_END}`,
      ),
    ).toBe("Keep this reply.");
  });

  it("normalizes excessive blank lines after fence removal", () => {
    const reply = [
      "First point.",
      "",
      AI_PROPOSALS_FENCE_START,
      "[]",
      AI_PROPOSALS_FENCE_END,
      "",
      "",
      "Second point.",
    ].join("\n");

    expect(stripProposalFencesFromReply(reply)).toBe(
      "First point.\n\nSecond point.",
    );
  });
});
