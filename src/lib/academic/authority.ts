import { ValidationError } from "@/lib/errors";

/**
 * Reject client attempts to supply identity, ownership, or server-owned
 * timestamp/authority fields on academic mutation bags.
 */
const FORBIDDEN_ACADEMIC_FIELDS = [
  "userId",
  "actorUserId",
  "completedAt",
  "createdAt",
  "updatedAt",
  "ownership",
  "authorized",
  "approved",
  "provenance",
  "confidence",
  "source",
  "channel",
] as const;

export function assertNoClientAcademicAuthority(
  payload: Record<string, unknown>,
): void {
  for (const field of FORBIDDEN_ACADEMIC_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      throw new ValidationError(`Clients cannot supply ${field}.`);
    }
  }
}

export const ACADEMIC_CLIENT_FORBIDDEN_FIELDS = FORBIDDEN_ACADEMIC_FIELDS;
