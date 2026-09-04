import type {
  EvidenceKind,
  EvidencePolarity,
  LearningEvidence,
  Prisma,
} from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";

const SUMMARY_MAX = 500;
const SOURCE_MAX = 80;

export type RecordEvidenceInput = {
  actorUserId: string;
  userId: string;
  kind: EvidenceKind;
  polarity: EvidencePolarity;
  source: string;
  summary: string;
  conceptId?: string | null;
  observationId?: string | null;
  weight?: number;
  /** Auxiliary non-relational only — never DB ID arrays / FK substitutes. */
  metadata?: Prisma.InputJsonValue | null;
};

function assertNoRelationalIdArrays(metadata: unknown): void {
  if (metadata === null || metadata === undefined) return;
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new ValidationError("Evidence metadata must be a plain object.");
  }
  for (const [k, v] of Object.entries(metadata as Record<string, unknown>)) {
    if (/ids?$/i.test(k) && Array.isArray(v)) {
      throw new ValidationError(
        "Evidence metadata must not contain ID arrays or relational FK substitutes.",
      );
    }
  }
}

/**
 * Append-only learning evidence.
 * Does NOT mutate StudentConceptState / mastery.
 */
export async function recordLearningEvidence(
  input: RecordEvidenceInput,
): Promise<LearningEvidence> {
  assertResourceOwner(input.userId, input.actorUserId);

  const summary = input.summary?.trim();
  const source = input.source?.trim();
  if (!summary || summary.length > SUMMARY_MAX) {
    throw new ValidationError("Invalid evidence summary.");
  }
  if (!source || source.length > SOURCE_MAX) {
    throw new ValidationError("Invalid evidence source.");
  }

  const weight = input.weight ?? 1;
  if (!Number.isFinite(weight) || weight < 0 || weight > 10) {
    throw new ValidationError("Invalid evidence weight.");
  }

  assertNoRelationalIdArrays(input.metadata);

  if (input.conceptId) {
    const concept = await prisma.concept.findUnique({
      where: { id: input.conceptId },
    });
    if (!concept) {
      throw new ValidationError("Concept not found.");
    }
  }

  if (input.observationId) {
    const observation = await prisma.studentObservation.findUnique({
      where: { id: input.observationId },
    });
    if (!observation || observation.userId !== input.userId) {
      throw new ValidationError("Observation not found.");
    }
  }

  return prisma.learningEvidence.create({
    data: {
      userId: input.userId,
      conceptId: input.conceptId ?? null,
      observationId: input.observationId ?? null,
      kind: input.kind,
      polarity: input.polarity,
      weight,
      source,
      summary,
      metadata: input.metadata ?? undefined,
    },
  });
}

export async function listLearningEvidence(args: {
  actorUserId: string;
  userId: string;
  conceptId?: string;
  limit?: number;
}): Promise<LearningEvidence[]> {
  assertResourceOwner(args.userId, args.actorUserId);
  const take = Math.min(Math.max(args.limit ?? 50, 1), 200);

  return prisma.learningEvidence.findMany({
    where: {
      userId: args.userId,
      ...(args.conceptId ? { conceptId: args.conceptId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}
