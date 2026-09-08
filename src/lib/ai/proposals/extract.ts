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
