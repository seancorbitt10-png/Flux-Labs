import type {
  MisconceptionStatus,
  StudentMisconception,
} from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";
import {
  clampConfidence,
  defaultConfidenceFor,
} from "@/lib/provenance/policy";
import { rejectClientAuthorityFields } from "./attribute-registry";

const STATEMENT_MAX = 500;

/**
 * Server-controlled misconception channels.
 * Provenance/confidence/source are assigned by the server from the channel.
 */
export const MISCONCEPTION_CHANNELS = {
  system: { source: "system", provenance: "OBSERVED" as const },
  tutor: { source: "tutor", provenance: "OBSERVED" as const },
  /** Student self-report via settings — EXPLICIT is server-assigned, not caller-chosen. */
  settings: { source: "settings", provenance: "EXPLICIT" as const },
} as const;

export type MisconceptionChannel = keyof typeof MISCONCEPTION_CHANNELS;

export type CreateMisconceptionInput = {
  actorUserId: string;
  userId: string;
  statement: string;
  channel: MisconceptionChannel;
  conceptId?: string | null;
};

/**
 * Student misconceptions — no evidence ID arrays, no JSON FK substitutes.
 * MisconceptionEvidence join is deferred.
 * Authority metadata is server-controlled via channel.
 */
export async function createStudentMisconception(
  input: CreateMisconceptionInput,
): Promise<StudentMisconception> {
  assertResourceOwner(input.userId, input.actorUserId);

  const bag = input as Record<string, unknown>;
  if (
    "provenance" in bag ||
    "confidence" in bag ||
    "source" in bag
  ) {
    rejectClientAuthorityFields({
      provenance: bag.provenance,
      confidence: bag.confidence,
      source: bag.source,
    });
  }

  const channel = MISCONCEPTION_CHANNELS[input.channel];
  if (!channel) {
    throw new ValidationError("Unknown misconception channel.");
  }

  const statement = input.statement?.trim();
  if (!statement || statement.length > STATEMENT_MAX) {
    throw new ValidationError("Invalid misconception statement.");
  }

  if (input.conceptId) {
    const concept = await prisma.concept.findUnique({
      where: { id: input.conceptId },
    });
    if (!concept) {
      throw new ValidationError("Concept not found.");
    }
  }

  const provenance = channel.provenance;

  return prisma.studentMisconception.create({
    data: {
      userId: input.userId,
      conceptId: input.conceptId ?? null,
      statement,
      status: "ACTIVE",
      provenance,
      confidence: clampConfidence(defaultConfidenceFor(provenance)),
      source: channel.source,
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

  const bag = args as Record<string, unknown>;
  if (
    "provenance" in bag ||
    "confidence" in bag ||
    "source" in bag
  ) {
    rejectClientAuthorityFields({
      provenance: bag.provenance,
      confidence: bag.confidence,
      source: bag.source,
    });
  }

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
