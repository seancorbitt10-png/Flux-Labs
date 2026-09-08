import { ValidationError } from "@/lib/errors";

const FORBIDDEN_STUDY_FIELDS = [
  "userId",
  "actorUserId",
  "provenance",
  "confidence",
  "source",
  "channel",
  "modelKey",
  "provider",
  "providerId",
  "systemPrompt",
  "instructions",
  "systemDirective",
  "assistanceMode",
  "taskType",
  "attributes",
  "goals",
  "entitlement",
  "ownership",
  "authorized",
  "approved",
  "mapping",
  "key",
  "createdByUserId",
  "systemProvenance",
] as const;

/**
 * Reject client attempts to supply identity, authority, or routing fields
 * on Study action payloads.
 */
export function assertNoClientStudyAuthority(
  payload: Record<string, unknown>,
): void {
  for (const field of FORBIDDEN_STUDY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      throw new ValidationError(`Clients cannot supply ${field}.`);
    }
  }
}

export const STUDY_CLIENT_FORBIDDEN_FIELDS = FORBIDDEN_STUDY_FIELDS;
