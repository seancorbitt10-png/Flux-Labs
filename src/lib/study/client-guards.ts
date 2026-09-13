import { ValidationError } from "@/lib/errors";

/**
 * Reject client attempts to supply identity, authority, routing, or
 * trusted academic context blobs on Study action payloads.
 *
 * Clients may send classId / taskId / conceptIds (ID references only).
 * They must never send Class / Task / Concept / academicWorkspace objects.
 */
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
  "apiKey",
  "endpoint",
  "baseUrl",
  "temperature",
  "maxTokens",
  "systemPrompt",
  "instructions",
  "systemDirective",
  "assistanceMode",
  "learningIntent",
  "policyMode",
  "policyReason",
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
  // Academic / context blobs — IDs only cross the trust boundary.
  "class",
  "task",
  "classes",
  "tasks",
  "concept",
  "concepts",
  "academicWorkspace",
  "academicContext",
  "assembledContext",
  "studentModel",
  "focusClass",
  "focusTask",
  "focusConcept",
] as const;

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
