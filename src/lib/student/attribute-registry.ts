import { z } from "zod";
import type { ProvenanceKind } from "@prisma/client";
import { ValidationError } from "@/lib/errors";

/** Who may initiate a registry-backed attribute write. */
export type AttributeWriter = "onboarding" | "settings" | "system";

export type AttributeValueType =
  | "enum_string"
  | "string"
  | "string_array"
  | "boolean";

export type AttributeRegistryEntry = {
  key: string;
  valueType: AttributeValueType;
  /** Zod schema for the stored JSON value (after coercion). */
  schema: z.ZodType;
  writers: readonly AttributeWriter[];
  /** Server-assigned provenance for student-authoritative writers (onboarding/settings). Not used by system writers. */
  defaultProvenance: ProvenanceKind;
  aiContextEligible: boolean | "optional";
  description: string;
};

const ACADEMIC_LEVELS = ["hs", "undergrad", "grad", "other"] as const;
const EXPLANATION_LENGTHS = ["concise", "detailed"] as const;
const ASSISTANCE_STYLES = [
  "hints_first",
  "explain_first",
  "check_work_first",
] as const;
const WEEKLY_TIME_BANDS = [
  "under_3h",
  "3_to_6h",
  "6_to_10h",
  "10_to_15h",
  "over_15h",
] as const;

const MAX_SUBJECTS = 12;
const MAX_STRING = 200;
const MAX_SUBJECT_LEN = 80;

/**
 * Server-controlled StudentAttribute registry.
 * Clients cannot invent keys or supply provenance/confidence/source.
 */
export const ATTRIBUTE_REGISTRY: Record<string, AttributeRegistryEntry> = {
  "academic.level": {
    key: "academic.level",
    valueType: "enum_string",
    schema: z.enum(ACADEMIC_LEVELS),
    writers: ["onboarding", "settings"],
    defaultProvenance: "EXPLICIT",
    aiContextEligible: true,
    description: "Academic level band",
  },
  "academic.subjects": {
    key: "academic.subjects",
    valueType: "string_array",
    schema: z
      .array(z.string().trim().min(1).max(MAX_SUBJECT_LEN))
      .min(1)
      .max(MAX_SUBJECTS),
    writers: ["onboarding", "settings"],
    defaultProvenance: "EXPLICIT",
    aiContextEligible: true,
    description: "Subjects of interest this term",
  },
  "interest.primary": {
    key: "interest.primary",
    valueType: "string",
    schema: z.string().trim().min(1).max(MAX_STRING),
    writers: ["onboarding", "settings"],
    defaultProvenance: "EXPLICIT",
    aiContextEligible: true,
    description: "Primary academic interest",
  },
  "interest.secondary": {
    key: "interest.secondary",
    valueType: "string",
    schema: z.string().trim().min(1).max(MAX_STRING),
    writers: ["onboarding", "settings"],
    defaultProvenance: "EXPLICIT",
    aiContextEligible: "optional",
    description: "Secondary academic interest",
  },
  "pref.explanation_length": {
    key: "pref.explanation_length",
    valueType: "enum_string",
    schema: z.enum(EXPLANATION_LENGTHS),
    writers: ["onboarding", "settings"],
    defaultProvenance: "EXPLICIT",
    aiContextEligible: true,
    description: "Preferred explanation length",
  },
  "pref.guided_participation": {
    key: "pref.guided_participation",
    valueType: "boolean",
    schema: z.boolean(),
    writers: ["onboarding", "settings"],
    defaultProvenance: "EXPLICIT",
    aiContextEligible: true,
    description: "Prefer guided participation by default",
  },
  "pref.assistance_style": {
    key: "pref.assistance_style",
    valueType: "enum_string",
    schema: z.enum(ASSISTANCE_STYLES),
    writers: ["onboarding", "settings"],
    defaultProvenance: "EXPLICIT",
    aiContextEligible: true,
    description: "Preferred assistance style",
  },
  "habit.typical_weekly_time": {
    key: "habit.typical_weekly_time",
    valueType: "enum_string",
    schema: z.enum(WEEKLY_TIME_BANDS),
    writers: ["onboarding", "settings"],
    defaultProvenance: "EXPLICIT",
    aiContextEligible: true,
    description: "Typical weekly study time band",
  },
  "challenge.primary": {
    key: "challenge.primary",
    valueType: "string",
    schema: z.string().trim().min(1).max(MAX_STRING),
    writers: ["onboarding", "settings"],
    defaultProvenance: "EXPLICIT",
    aiContextEligible: true,
    description: "Primary academic challenge",
  },
  "approach.worked_example": {
    key: "approach.worked_example",
    valueType: "boolean",
    schema: z.boolean(),
    writers: ["settings", "system"],
    defaultProvenance: "EXPLICIT",
    aiContextEligible: "optional",
    description: "Worked-example approach preference (not a learning style)",
  },
} as const;

export type RegisteredAttributeKey = keyof typeof ATTRIBUTE_REGISTRY;

export function getAttributeDefinition(
  key: string,
): AttributeRegistryEntry | undefined {
  return ATTRIBUTE_REGISTRY[key];
}

export function assertRegisteredAttributeKey(key: string): AttributeRegistryEntry {
  const entry = getAttributeDefinition(key);
  if (!entry) {
    throw new ValidationError("Unknown or unregistered attribute key.");
  }
  return entry;
}

export function assertWriterAllowed(
  entry: AttributeRegistryEntry,
  writer: AttributeWriter,
): void {
  if (!entry.writers.includes(writer)) {
    throw new ValidationError("Attribute write not permitted for this flow.");
  }
}

export function validateAttributeValue(
  entry: AttributeRegistryEntry,
  value: unknown,
): unknown {
  const parsed = entry.schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError("Invalid attribute value for registered key.");
  }
  return parsed.data;
}

/** Reject client attempts to supply authority fields. */
export function rejectClientAuthorityFields(input: Record<string, unknown>): void {
  const forbidden = ["provenance", "confidence", "source", "key", "supersededAt", "supersededById"] as const;
  // Only reject when callers pass a bag that includes authority fields alongside value.
  // Keys that are explicitly allowed as server params are handled by typed APIs.
  for (const field of forbidden) {
    if (Object.prototype.hasOwnProperty.call(input, field) && field !== "key") {
      // `key` is validated via registry separately when present in client bags.
    }
  }
  if (
    "provenance" in input ||
    "confidence" in input ||
    "source" in input ||
    "supersededAt" in input ||
    "supersededById" in input
  ) {
    throw new ValidationError(
      "Clients cannot set provenance, confidence, source, or registry metadata.",
    );
  }
}

export const ACADEMIC_LEVEL_VALUES = ACADEMIC_LEVELS;
export const ASSISTANCE_STYLE_VALUES = ASSISTANCE_STYLES;
export const EXPLANATION_LENGTH_VALUES = EXPLANATION_LENGTHS;
export const WEEKLY_TIME_BAND_VALUES = WEEKLY_TIME_BANDS;
