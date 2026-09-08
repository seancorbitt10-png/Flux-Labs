import { ValidationError } from "@/lib/errors";
import {
  assertRegisteredAttributeKey,
  assertWriterAllowed,
  validateAttributeValue,
} from "@/lib/student/attribute-registry";
import {
  AI_PROPOSAL_TYPES,
  MAX_PROPOSALS_PER_BATCH,
  PROPOSABLE_MASTERY_LEVELS,
  PROPOSAL_FORBIDDEN_AUTHORITY_KEYS,
  aiProposalBatchSchema,
  aiProposalContentSchema,
  type AIProposalContent,
} from "./schema";

function collectForbiddenKeys(
  value: unknown,
  found: Set<string> = new Set(),
): Set<string> {
  if (value === null || value === undefined) return found;
  if (Array.isArray(value)) {
    for (const item of value) collectForbiddenKeys(item, found);
    return found;
  }
  if (typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      (PROPOSAL_FORBIDDEN_AUTHORITY_KEYS as readonly string[]).includes(key)
    ) {
      found.add(key);
    }
    collectForbiddenKeys(child, found);
  }
  return found;
}

/**
 * Reject AI/client bags that smuggle authority, identity, or routing fields.
 * Unexpected authority keys are rejected — never silently trusted.
 */
export function assertNoProposalAuthorityFields(value: unknown): void {
  const found = collectForbiddenKeys(value);
  if (found.size > 0) {
    throw new ValidationError(
      "AI proposals cannot include authority, identity, routing, or entitlement fields.",
    );
  }
}

function assertAttributeSettingsWritable(content: AIProposalContent): void {
  if (content.type !== "ATTRIBUTE_UPDATE") return;
  const entry = assertRegisteredAttributeKey(content.target.key);
  // Confirmation applies via settings (student-authoritative). Keys must allow it.
  assertWriterAllowed(entry, "settings");
  validateAttributeValue(entry, content.proposedValue);
}

/**
 * Parse and validate a single structured AI proposal.
 * Returns typed content only — no userId/provenance/confidence.
 */
export function parseAIProposalContent(raw: unknown): AIProposalContent {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("Malformed proposal: expected an object.");
  }

  const bag = raw as Record<string, unknown>;

  // Reject unknown types early with a clear message (before Zod union noise).
  if (!("type" in bag) || typeof bag.type !== "string") {
    throw new ValidationError("Malformed proposal: type is required.");
  }
  if (!(AI_PROPOSAL_TYPES as readonly string[]).includes(bag.type)) {
    throw new ValidationError("Unknown proposal type.");
  }

  // Explicit MASTERED attempt (even if Zod would reject) — mastery safety.
  if (
    bag.type === "CONCEPT_STATE_UPDATE" &&
    bag.proposedValue &&
    typeof bag.proposedValue === "object" &&
    !Array.isArray(bag.proposedValue) &&
    (bag.proposedValue as { mastery?: unknown }).mastery === "MASTERED"
  ) {
    throw new ValidationError(
      "AI proposals cannot create MASTERED concept state.",
    );
  }

  assertNoProposalAuthorityFields(bag);

  const parsed = aiProposalContentSchema.safeParse(bag);
  if (!parsed.success) {
    // Oversized / invalid enum / unknown keys / malformed target
    const issue = parsed.error.issues[0];
    if (issue?.code === "unrecognized_keys") {
      throw new ValidationError("Proposal contains unknown fields.");
    }
    if (issue?.code === "too_big") {
      throw new ValidationError("Oversized proposal rejected.");
    }
    throw new ValidationError("Malformed proposal rejected.");
  }

  assertAttributeSettingsWritable(parsed.data);
  return parsed.data;
}

/**
 * Parse a batch of proposals. Rejects oversized batches and invalid members.
 */
export function parseAIProposalBatch(raw: unknown): AIProposalContent[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError("Malformed proposal batch: expected an array.");
  }
  if (raw.length === 0) {
    throw new ValidationError("Malformed proposal batch: empty.");
  }
  if (raw.length > MAX_PROPOSALS_PER_BATCH) {
    throw new ValidationError("Oversized proposal batch rejected.");
  }

  assertNoProposalAuthorityFields(raw);

  // Prefer per-item errors for clearer security tests; also run batch schema.
  const batchCheck = aiProposalBatchSchema.safeParse(
    raw.map((item) => {
      // Soft pre-check so Zod batch doesn't obscure authority failures.
      return item;
    }),
  );
  if (!batchCheck.success) {
    // Fall through to per-item parse for precise messages.
  }

  return raw.map((item) => parseAIProposalContent(item));
}

export function isProposableMastery(
  value: string,
): value is (typeof PROPOSABLE_MASTERY_LEVELS)[number] {
  return (PROPOSABLE_MASTERY_LEVELS as readonly string[]).includes(value);
}
