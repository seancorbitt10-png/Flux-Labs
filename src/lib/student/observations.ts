import type { Prisma, StudentObservation } from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";
import {
  clampConfidence,
  defaultConfidenceFor,
} from "@/lib/provenance/policy";
import { rejectClientAuthorityFields } from "./attribute-registry";

const SUMMARY_MAX = 500;
const CATEGORY_MAX = 80;
const TYPE_MAX = 80;

/**
 * Server-controlled observation channels.
 * Callers choose an allowlisted channel; provenance/confidence/source are server-assigned.
 */
export const OBSERVATION_CHANNELS = {
  study_session: { source: "study_session", provenance: "OBSERVED" as const },
  assistance: { source: "assistance", provenance: "OBSERVED" as const },
  system: { source: "system", provenance: "OBSERVED" as const },
} as const;

export type ObservationChannel = keyof typeof OBSERVATION_CHANNELS;

export type RecordObservationInput = {
  actorUserId: string;
  userId: string;
  category: string;
  type: string;
  summary: string;
  channel: ObservationChannel;
  /** Auxiliary non-relational only — never DB ID arrays. */
  metadata?: Prisma.InputJsonValue | null;
};

function assertNoIdArrays(metadata: unknown): void {
  if (metadata === null || metadata === undefined) return;
  if (typeof metadata !== "object") {
    throw new ValidationError("Observation metadata must be an object.");
  }
  const obj = metadata as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (/ids?$/i.test(k) && Array.isArray(v)) {
      throw new ValidationError(
        "Observation metadata must not contain ID arrays or relational FK substitutes.",
      );
    }
    if (
      Array.isArray(v) &&
      v.every(
        (x) => typeof x === "string" && /^c[a-z0-9]{20,}$/i.test(x),
      )
    ) {
      throw new ValidationError(
        "Observation metadata must not contain ID arrays or relational FK substitutes.",
      );
    }
  }
}

/**
 * Append-only observation. Provenance, confidence, and source are server-controlled.
 */
export async function recordStudentObservation(
  input: RecordObservationInput,
): Promise<StudentObservation> {
  assertResourceOwner(input.userId, input.actorUserId);

  // Reject smuggled authority fields if a bag is passed as metadata misuse, or
  // if callers expand the input object with forbidden keys at runtime.
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

  const channel = OBSERVATION_CHANNELS[input.channel];
  if (!channel) {
    throw new ValidationError("Unknown observation channel.");
  }

  const category = input.category?.trim();
  const type = input.type?.trim();
  const summary = input.summary?.trim();

  if (!category || category.length > CATEGORY_MAX) {
    throw new ValidationError("Invalid observation category.");
  }
  if (!type || type.length > TYPE_MAX) {
    throw new ValidationError("Invalid observation type.");
  }
  if (!summary || summary.length > SUMMARY_MAX) {
    throw new ValidationError("Invalid observation summary.");
  }

  assertNoIdArrays(input.metadata);

  const provenance = channel.provenance;
  const confidence = clampConfidence(defaultConfidenceFor(provenance));

  return prisma.studentObservation.create({
    data: {
      userId: input.userId,
      category,
      type,
      summary,
      provenance,
      confidence,
      source: channel.source,
      metadata: input.metadata ?? undefined,
    },
  });
}

export async function listStudentObservations(args: {
  actorUserId: string;
  userId: string;
  limit?: number;
}): Promise<StudentObservation[]> {
  assertResourceOwner(args.userId, args.actorUserId);
  const take = Math.min(Math.max(args.limit ?? 20, 1), 100);

  return prisma.studentObservation.findMany({
    where: { userId: args.userId },
    orderBy: { createdAt: "desc" },
    take,
  });
}
