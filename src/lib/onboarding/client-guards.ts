import { ValidationError } from "@/lib/errors";

const FORBIDDEN_CLIENT_FIELDS = [
  "userId",
  "actorUserId",
  "provenance",
  "confidence",
  "source",
  "channel",
  "onboardingVersion",
  "version",
  "key",
  "mapping",
  "createdByUserId",
  "systemProvenance",
  "supersededAt",
  "supersededById",
] as const;

/**
 * Reject client attempts to supply identity or authority fields.
 * Authenticated identity and provenance are server-assigned only.
 */
export function assertNoClientOnboardingAuthority(
  payload: Record<string, unknown>,
): void {
  for (const field of FORBIDDEN_CLIENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      throw new ValidationError(`Clients cannot supply ${field}.`);
    }
  }
}

export const ONBOARDING_CLIENT_FORBIDDEN_FIELDS = FORBIDDEN_CLIENT_FIELDS;
