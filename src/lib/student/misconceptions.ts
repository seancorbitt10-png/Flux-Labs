import type {
  MisconceptionStatus,
  ProvenanceKind,
  StudentMisconception,
} from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";
import {
  clampConfidence,
  defaultConfidenceFor,
} from "@/lib/provenance/policy";

const STATEMENT_MAX = 500;

export type CreateMisconceptionInput = {
  actorUserId: string;
  userId: string;
  statement: string;
  source: string;
  conceptId?: string | null;
  provenance?: ProvenanceKind;
  confidence?: number;
};

/**
 * Student misconceptions — no evidence ID arrays, no JSON FK substitutes.
 * MisconceptionEvidence join is deferred.
 */
export async function createStudentMisconception(
  input: CreateMisconceptionInput,
): Promise<StudentMisconception> {
  assertResourceOwner(input.userId, input.actorUserId);

  const statement = input.statement?.trim();
  if (!statement || statement.length > STATEMENT_MAX) {
    throw new ValidationError("Invalid misconception statement.");
  }
  if (!input.source?.trim() || input.source.length > 80) {
    throw new ValidationError("Invalid misconception source.");
  }

  if (input.conceptId) {
    const concept = await prisma.concept.findUnique({
      where: { id: input.conceptId },
    });
    if (!concept) {
      throw new ValidationError("Concept not found.");
    }
  }

  const provenance = input.provenance ?? "OBSERVED";

  return prisma.studentMisconception.create({
    data: {
      userId: input.userId,
      conceptId: input.conceptId ?? null,
      statement,
      status: "ACTIVE",
      provenance,
      confidence: clampConfidence(
        input.confidence ?? defaultConfidenceFor(provenance),
      ),
      source: input.source.trim(),
    },
  });
}

export async function updateMisconceptionStatus(args: {
  actorUserId: string;
  userId: string;
  misconceptionId: string;
  status: MisconceptionStatus;
}): Promise<StudentMisconception> {
  assertResourceOwner(args.userId, args.actorUserId);

  const row = await prisma.studentMisconception.findUnique({
    where: { id: args.misconceptionId },
  });
  if (!row || row.userId !== args.userId) {
    throw new ValidationError("Misconception not found.");
  }

  return prisma.studentMisconception.update({
    where: { id: row.id },
    data: {
      status: args.status,
      resolvedAt:
        args.status === "RESOLVED" || args.status === "DISMISSED"
          ? new Date()
          : null,
    },
  });
}

export async function listMisconceptions(args: {
  actorUserId: string;
  userId: string;
  status?: MisconceptionStatus;
}): Promise<StudentMisconception[]> {
  assertResourceOwner(args.userId, args.actorUserId);
  return prisma.studentMisconception.findMany({
    where: {
      userId: args.userId,
      ...(args.status ? { status: args.status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}
