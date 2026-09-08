import type { AIProposal, AIProposalStatus, Prisma } from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { setStudentAttribute } from "@/lib/student/attributes";
import { upsertExplicitConceptState } from "@/lib/student/concept-state";
import { createStudentGoal } from "@/lib/student/goals";
import { createStudentMisconception } from "@/lib/student/misconceptions";
import { extractProposalPayloadFromReply } from "./extract";
import { parseAIProposalBatch, parseAIProposalContent } from "./parse";
import {
  AI_PROPOSAL_SCHEMA_VERSION,
  proposalDecisionSchema,
  type AIProposalContent,
} from "./schema";

export type IngestProposalsInput = {
  /** Authenticated actor from session/server — never from AI output. */
  actorUserId: string;
  /** Raw structured proposal object or array (already extracted). */
  raw: unknown;
  aiInteractionId?: string | null;
};

export type IngestedProposalView = {
  id: string;
  type: string;
  status: AIProposalStatus;
  target: unknown;
  proposedValue: unknown;
  rationale: string | null;
  evidenceReference: string | null;
  validationOutcome: string;
  validationReason: string | null;
};

export type IngestProposalsResult = {
  proposals: IngestedProposalView[];
  rejectedCount: number;
};

export type ConfirmProposalInput = {
  actorUserId: string;
  /** Client may only supply proposalId — authority fields are rejected. */
  decision: Record<string, unknown>;
};

export type RejectProposalInput = ConfirmProposalInput;

function toView(row: AIProposal): IngestedProposalView {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    target: row.targetJson,
    proposedValue: row.proposedValueJson,
    rationale: row.rationale,
    evidenceReference: row.evidenceReference,
    validationOutcome: row.validationOutcome,
    validationReason: row.validationReason,
  };
}

/**
 * Validate concept readability for the authenticated actor.
 * SYSTEM catalog: readable. USER concepts: owner only.
 * Does not invent or resolve concepts from natural language.
 */
async function assertReadableConcept(args: {
  actorUserId: string;
  conceptId: string;
}): Promise<void> {
  const concept = await prisma.concept.findUnique({
    where: { id: args.conceptId },
    select: { id: true, source: true, createdByUserId: true },
  });
  if (!concept) {
    throw new ValidationError("Concept not found.");
  }
  if (
    concept.source === "USER" &&
    concept.createdByUserId !== args.actorUserId
  ) {
    // Do not reveal cross-user existence.
    throw new ValidationError("Concept not found.");
  }
}

async function assertConceptTargets(
  actorUserId: string,
  content: AIProposalContent,
): Promise<void> {
  if (content.type === "CONCEPT_STATE_UPDATE") {
    await assertReadableConcept({
      actorUserId,
      conceptId: content.target.conceptId,
    });
    return;
  }
  if (content.type === "MISCONCEPTION_SIGNAL" && content.target.conceptId) {
    await assertReadableConcept({
      actorUserId,
      conceptId: content.target.conceptId,
    });
  }
}

/**
 * Validate and persist AI proposals as PENDING (or DEFERRED when policy defers).
 * Never mutates the Student Model. Never trusts AI-supplied identity/authority.
 */
export async function ingestAIProposals(
  input: IngestProposalsInput,
): Promise<IngestProposalsResult> {
  if (typeof input.actorUserId !== "string" || !input.actorUserId) {
    throw new ValidationError("actorUserId is required.");
  }

  // Ownership is always the authenticated actor in Phase 2.
  assertResourceOwner(input.actorUserId, input.actorUserId);

  const contents = parseAIProposalBatch(input.raw);
  const proposals: IngestedProposalView[] = [];
  let rejectedCount = 0;

  for (const content of contents) {
    try {
      await assertConceptTargets(input.actorUserId, content);

      const row = await prisma.aIProposal.create({
        data: {
          userId: input.actorUserId,
          schemaVersion: AI_PROPOSAL_SCHEMA_VERSION,
          type: content.type,
          status: "PENDING",
          targetJson: content.target as Prisma.InputJsonValue,
          proposedValueJson: content.proposedValue as Prisma.InputJsonValue,
          rationale: content.rationale ?? null,
          evidenceReference: content.evidenceReference ?? null,
          validationOutcome: "pending_confirmation",
          validationReason: null,
          aiInteractionId: input.aiInteractionId ?? null,
        },
      });
      proposals.push(toView(row));
    } catch (error) {
      rejectedCount += 1;
      const reason =
        error instanceof ValidationError
          ? error.message
          : "Proposal rejected by server policy.";

      // Persist minimal rejection audit without Student Model mutation.
      const rejected = await prisma.aIProposal.create({
        data: {
          userId: input.actorUserId,
          schemaVersion: AI_PROPOSAL_SCHEMA_VERSION,
          type:
            content && typeof content === "object" && "type" in content
              ? String((content as { type: string }).type)
              : "UNKNOWN",
          status: "REJECTED",
          targetJson:
            content && typeof content === "object" && "target" in content
              ? ((content as { target: unknown }).target as Prisma.InputJsonValue)
              : {},
          proposedValueJson: {},
          rationale: null,
          evidenceReference: null,
          validationOutcome: "rejected",
          validationReason: reason,
          rejectedAt: new Date(),
          aiInteractionId: input.aiInteractionId ?? null,
        },
      });
      proposals.push(toView(rejected));
    }
  }

  return { proposals, rejectedCount };
}

/**
 * Parse a single proposal and ingest as a one-element batch (test helper path).
 */
export async function ingestSingleAIProposal(args: {
  actorUserId: string;
  raw: unknown;
  aiInteractionId?: string | null;
}): Promise<IngestedProposalView> {
  // Validate early so malformed singles don't look like batch errors.
  parseAIProposalContent(args.raw);
  const result = await ingestAIProposals({
    actorUserId: args.actorUserId,
    raw: [args.raw],
    aiInteractionId: args.aiInteractionId,
  });
  const pending = result.proposals.find((p) => p.status === "PENDING");
  if (!pending) {
    const rejected = result.proposals.find((p) => p.status === "REJECTED");
    throw new ValidationError(
      rejected?.validationReason ?? "Proposal rejected.",
    );
  }
  return pending;
}

/**
 * Extract proposal fence from a provider reply and ingest when present.
 * Soft-fail: invalid fences do not throw (orchestration reply still returns).
 */
export async function ingestProposalsFromProviderReply(args: {
  actorUserId: string;
  reply: string;
  aiInteractionId?: string | null;
}): Promise<IngestProposalsResult> {
  const payload = extractProposalPayloadFromReply(args.reply);
  if (payload === null) {
    return { proposals: [], rejectedCount: 0 };
  }

  try {
    return await ingestAIProposals({
      actorUserId: args.actorUserId,
      raw: payload,
      aiInteractionId: args.aiInteractionId,
    });
  } catch {
    return { proposals: [], rejectedCount: 1 };
  }
}

async function loadOwnedProposal(args: {
  actorUserId: string;
  proposalId: string;
}): Promise<AIProposal> {
  assertResourceOwner(args.actorUserId, args.actorUserId);

  const row = await prisma.aIProposal.findUnique({
    where: { id: args.proposalId },
  });
  if (!row) {
    throw new ValidationError("Proposal not found.");
  }
  // Ownership: another user's proposal is not found (no IDOR leak).
  if (row.userId !== args.actorUserId) {
    throw new ForbiddenError();
  }
  return row;
}

function parseDecisionBag(
  decision: Record<string, unknown>,
): { proposalId: string } {
  // Reject authority smuggling on confirmation bags.
  const forbidden = [
    "provenance",
    "confidence",
    "userId",
    "actorUserId",
    "source",
    "channel",
    "authorized",
    "approved",
    "ownership",
    "role",
    "permissions",
    "entitlement",
    "type",
    "target",
    "proposedValue",
    "targetJson",
    "proposedValueJson",
  ] as const;
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(decision, key)) {
      throw new ValidationError(
        "Confirmation cannot modify authoritative proposal or identity fields.",
      );
    }
  }

  const parsed = proposalDecisionSchema.safeParse(decision);
  if (!parsed.success) {
    throw new ValidationError("Invalid proposal confirmation payload.");
  }
  return parsed.data;
}

/**
 * Apply a confirmed proposal via existing Student Model domain services.
 * Server assigns provenance/confidence/source — never the client or AI.
 *
 * Confirmation semantics (server-controlled):
 * - ATTRIBUTE_UPDATE → settings writer (EXPLICIT student acceptance)
 * - GOAL_UPDATE → settings source (EXPLICIT student acceptance)
 * - CONCEPT_STATE_UPDATE → settings source (EXPLICIT; MASTERED never proposed)
 * - MISCONCEPTION_SIGNAL → settings channel (EXPLICIT student acknowledgment)
 */
export async function confirmAIProposal(
  input: ConfirmProposalInput,
): Promise<IngestedProposalView> {
  const { proposalId } = parseDecisionBag(input.decision);
  const proposal = await loadOwnedProposal({
    actorUserId: input.actorUserId,
    proposalId,
  });

  if (proposal.status === "CONFIRMED") {
    throw new ValidationError("Proposal already confirmed.");
  }
  if (proposal.status === "REJECTED") {
    throw new ValidationError("Rejected proposal cannot mutate Student Model.");
  }
  if (proposal.status === "DEFERRED") {
    throw new ValidationError("Deferred proposal cannot be confirmed.");
  }
  if (proposal.status !== "PENDING") {
    throw new ValidationError("Proposal is not pending confirmation.");
  }

  // Claim the proposal to prevent concurrent double-apply.
  const claimed = await prisma.aIProposal.updateMany({
    where: {
      id: proposal.id,
      userId: input.actorUserId,
      status: "PENDING",
      validationOutcome: "pending_confirmation",
    },
    data: {
      // Temporary marker until mutation succeeds — status stays PENDING on failure.
      validationOutcome: "confirming",
    },
  });
  if (claimed.count !== 1) {
    throw new ValidationError("Proposal already confirmed.");
  }

  try {
    await applyConfirmedMutation({
      actorUserId: input.actorUserId,
      type: proposal.type,
      target: proposal.targetJson,
      proposedValue: proposal.proposedValueJson,
    });

    const updated = await prisma.aIProposal.update({
      where: { id: proposal.id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        validationOutcome: "confirmed",
        validationReason: null,
      },
    });
    return toView(updated);
  } catch (error) {
    // Failed mutation must not leave a misleading confirmed state.
    await prisma.aIProposal.update({
      where: { id: proposal.id },
      data: {
        status: "PENDING",
        validationOutcome: "pending_confirmation",
        validationReason:
          error instanceof ValidationError
            ? `Confirmation failed: ${error.message}`
            : "Confirmation failed; Student Model unchanged.",
      },
    });
    throw error;
  }
}

async function applyConfirmedMutation(args: {
  actorUserId: string;
  type: string;
  target: unknown;
  proposedValue: unknown;
}): Promise<void> {
  const userId = args.actorUserId;

  switch (args.type) {
    case "ATTRIBUTE_UPDATE": {
      const target = args.target as { key: string };
      await setStudentAttribute({
        actorUserId: args.actorUserId,
        userId,
        key: target.key,
        value: args.proposedValue,
        writer: "settings",
      });
      return;
    }
    case "GOAL_UPDATE": {
      const value = args.proposedValue as {
        title: string;
        description?: string | null;
        category?: string | null;
        priority?: number | null;
      };
      await createStudentGoal({
        actorUserId: args.actorUserId,
        userId,
        title: value.title,
        description: value.description ?? null,
        category: value.category ?? null,
        priority: value.priority ?? null,
        source: "settings",
      });
      return;
    }
    case "CONCEPT_STATE_UPDATE": {
      const target = args.target as { conceptId: string };
      const value = args.proposedValue as {
        mastery: "UNKNOWN" | "INTRODUCED" | "DEVELOPING" | "PROFICIENT";
      };
      if (value.mastery === ("MASTERED" as string)) {
        throw new ValidationError(
          "AI proposals cannot create MASTERED concept state.",
        );
      }
      await upsertExplicitConceptState({
        actorUserId: args.actorUserId,
        userId,
        conceptId: target.conceptId,
        mastery: value.mastery,
        source: "settings",
      });
      return;
    }
    case "MISCONCEPTION_SIGNAL": {
      const target = args.target as { conceptId?: string | null };
      const value = args.proposedValue as { statement: string };
      await createStudentMisconception({
        actorUserId: args.actorUserId,
        userId,
        statement: value.statement,
        conceptId: target.conceptId ?? null,
        channel: "settings",
      });
      return;
    }
    default:
      throw new ValidationError("Unknown proposal type.");
  }
}

/**
 * Mark a pending proposal as rejected without mutating the Student Model.
 */
export async function rejectAIProposal(
  input: RejectProposalInput,
): Promise<IngestedProposalView> {
  const { proposalId } = parseDecisionBag(input.decision);
  const proposal = await loadOwnedProposal({
    actorUserId: input.actorUserId,
    proposalId,
  });

  if (proposal.status === "CONFIRMED") {
    throw new ValidationError("Confirmed proposal cannot be rejected.");
  }
  if (proposal.status === "REJECTED") {
    return toView(proposal);
  }

  const updated = await prisma.aIProposal.updateMany({
    where: {
      id: proposal.id,
      userId: input.actorUserId,
      status: { in: ["PENDING", "DEFERRED"] },
    },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      validationOutcome: "rejected_by_user",
    },
  });
  if (updated.count !== 1) {
    throw new ValidationError("Proposal cannot be rejected.");
  }

  const row = await prisma.aIProposal.findUniqueOrThrow({
    where: { id: proposal.id },
  });
  return toView(row);
}

export async function getAIProposal(args: {
  actorUserId: string;
  proposalId: string;
}): Promise<IngestedProposalView> {
  const row = await loadOwnedProposal(args);
  return toView(row);
}
