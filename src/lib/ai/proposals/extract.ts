/**
 * Extract structured proposal JSON from a provider reply using a server-owned fence.
 * Natural-language instructions inside student/AI text are ignored.
 * Returns null when no proposal fence is present.
 */
export const AI_PROPOSALS_FENCE_START = "<<<AI_PROPOSALS_V1>>>";
export const AI_PROPOSALS_FENCE_END = "<<<END_AI_PROPOSALS_V1>>>";

export function extractProposalPayloadFromReply(
  reply: string,
): unknown | null {
  if (typeof reply !== "string" || !reply.includes(AI_PROPOSALS_FENCE_START)) {
    return null;
  }

  const start = reply.indexOf(AI_PROPOSALS_FENCE_START);
  const end = reply.indexOf(AI_PROPOSALS_FENCE_END, start);
  if (start < 0 || end < 0 || end <= start) {
    return null;
  }

  const jsonText = reply
    .slice(start + AI_PROPOSALS_FENCE_START.length, end)
    .trim();
  if (!jsonText || jsonText.length > 20_000) {
    return null;
  }

  try {
    return JSON.parse(jsonText) as unknown;
  } catch {
    return null;
  }
}


/**
 * Remove server-owned proposal fences from the student-facing reply.
 *
 * Complete fenced proposal payloads are removed entirely. An unterminated
 * opening fence removes the remainder of the reply so malformed provider
 * control data cannot leak to the student. Stray closing fences are removed.
 */
export function stripProposalFencesFromReply(reply: string): string {
  if (typeof reply !== "string") return "";

  let cleaned = reply;
  while (true) {
    const start = cleaned.indexOf(AI_PROPOSALS_FENCE_START);
    if (start < 0) break;

    const contentStart = start + AI_PROPOSALS_FENCE_START.length;
    const end = cleaned.indexOf(AI_PROPOSALS_FENCE_END, contentStart);
    if (end < 0) {
      cleaned = cleaned.slice(0, start);
      break;
    }

    const before = cleaned.slice(0, start).replace(/\n$/, "");
    const after = cleaned
      .slice(end + AI_PROPOSALS_FENCE_END.length)
      .replace(/^\n/, "");
    cleaned = before + after;
  }

  cleaned = cleaned.replaceAll(AI_PROPOSALS_FENCE_END, "");
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}
