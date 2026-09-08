import { z } from "zod";
import { ATTRIBUTE_REGISTRY } from "@/lib/student/attribute-registry";

/**
 * Server-owned AI proposal contract (versioned).
 * Describes WHAT the AI proposes — never identity, provenance, confidence,
 * authorization, routing, entitlement, or ownership.
 */
export const AI_PROPOSAL_SCHEMA_VERSION = "ai-proposal.v1" as const;

export const AI_PROPOSAL_TYPES = [
  "ATTRIBUTE_UPDATE",
  "GOAL_UPDATE",
  "CONCEPT_STATE_UPDATE",
  "MISCONCEPTION_SIGNAL",
] as const;

export type AIProposalType = (typeof AI_PROPOSAL_TYPES)[number];

/** Authority / identity / routing fields that must never appear on proposals. */
export const PROPOSAL_FORBIDDEN_AUTHORITY_KEYS = [
  "userId",
  "actorUserId",
  "provenance",
  "confidence",
  "source",
  "channel",
  "createdByUserId",
  "authorized",
  "approved",
  "role",
  "permissions",
  "entitlement",
  "routing",
  "model",
  "modelKey",
  "provider",
  "providerId",
  "systemProvenance",
  "ownership",
  "ownerId",
  "authenticated",
  "approvedBy",
  "confirmed",
  "status",
  "supersededAt",
  "supersededById",
] as const;

export const MAX_PROPOSAL_RATIONALE_CHARS = 500;
export const MAX_EVIDENCE_REFERENCE_CHARS = 120;
export const MAX_PROPOSALS_PER_BATCH = 5;
export const MAX_GOAL_TITLE_CHARS = 200;
export const MAX_GOAL_DESCRIPTION_CHARS = 2000;
export const MAX_GOAL_CATEGORY_CHARS = 80;
export const MAX_MISCONCEPTION_STATEMENT_CHARS = 500;

/**
 * Mastery levels AI may propose for CONCEPT_STATE_UPDATE.
 * MASTERED is excluded — AI cannot mint mastery; student settings path remains separate.
 */
export const PROPOSABLE_MASTERY_LEVELS = [
  "UNKNOWN",
  "INTRODUCED",
  "DEVELOPING",
  "PROFICIENT",
] as const;

const registeredAttributeKeys = Object.keys(ATTRIBUTE_REGISTRY) as [
  string,
  ...string[],
];

const rationaleSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PROPOSAL_RATIONALE_CHARS)
  .optional();

const evidenceReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_EVIDENCE_REFERENCE_CHARS)
  .optional();

const attributeUpdateProposalSchema = z
  .object({
    type: z.literal("ATTRIBUTE_UPDATE"),
    target: z
      .object({
        key: z.enum(registeredAttributeKeys),
      })
      .strict(),
    proposedValue: z.unknown(),
    rationale: rationaleSchema,
    evidenceReference: evidenceReferenceSchema,
  })
  .strict();

const goalUpdateProposalSchema = z
  .object({
    type: z.literal("GOAL_UPDATE"),
    target: z
      .object({
        scope: z.literal("student_goals"),
      })
      .strict(),
    proposedValue: z
      .object({
        title: z.string().trim().min(1).max(MAX_GOAL_TITLE_CHARS),
        description: z
          .string()
          .trim()
          .max(MAX_GOAL_DESCRIPTION_CHARS)
          .optional()
          .nullable(),
        category: z
          .string()
          .trim()
          .max(MAX_GOAL_CATEGORY_CHARS)
          .optional()
          .nullable(),
        priority: z.number().int().min(0).max(100).optional().nullable(),
      })
      .strict(),
    rationale: rationaleSchema,
    evidenceReference: evidenceReferenceSchema,
  })
  .strict();

const conceptStateUpdateProposalSchema = z
  .object({
    type: z.literal("CONCEPT_STATE_UPDATE"),
    target: z
      .object({
        conceptId: z.string().trim().min(1).max(64),
      })
      .strict(),
    proposedValue: z
      .object({
        mastery: z.enum(PROPOSABLE_MASTERY_LEVELS),
      })
      .strict(),
    rationale: rationaleSchema,
    evidenceReference: evidenceReferenceSchema,
  })
  .strict();

const misconceptionSignalProposalSchema = z
  .object({
    type: z.literal("MISCONCEPTION_SIGNAL"),
    target: z
      .object({
        conceptId: z.string().trim().min(1).max(64).optional().nullable(),
      })
      .strict(),
    proposedValue: z
      .object({
        statement: z
          .string()
          .trim()
          .min(1)
          .max(MAX_MISCONCEPTION_STATEMENT_CHARS),
      })
      .strict(),
    rationale: rationaleSchema,
    evidenceReference: evidenceReferenceSchema,
  })
  .strict();

export const aiProposalContentSchema = z.discriminatedUnion("type", [
  attributeUpdateProposalSchema,
  goalUpdateProposalSchema,
  conceptStateUpdateProposalSchema,
  misconceptionSignalProposalSchema,
]);

export type AIProposalContent = z.infer<typeof aiProposalContentSchema>;

export const aiProposalBatchSchema = z
  .array(aiProposalContentSchema)
  .min(1)
  .max(MAX_PROPOSALS_PER_BATCH);

/** Confirmation / rejection client bags — proposalId only; no authority fields. */
export const proposalDecisionSchema = z
  .object({
    proposalId: z.string().trim().min(1).max(64),
  })
  .strict();

export type ProposalDecisionInput = z.infer<typeof proposalDecisionSchema>;
