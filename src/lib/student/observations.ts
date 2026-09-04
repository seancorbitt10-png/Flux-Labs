import type { Prisma, ProvenanceKind, StudentObservation } from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";
import {
  clampConfidence,
  defaultConfidenceFor,
} from "@/lib/provenance/policy";

const SUMMARY_MAX = 500;
const CATEGORY_MAX = 80;
const TYPE_MAX = 80;

export type RecordObservationInput = {
  actorUserId: string;
  userId: string;
  category: string;
  type: string;
  summary: string;
  source: string;
  provenance?: ProvenanceKind;
  confidence?: number;
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
    if (Array.isArray(v) && v.every((x) => typeof x === "string" && /^c[a-z0-9]{20,}$/i.test(x))) {
      throw new ValidationError(
        "Observation metadata must not contain ID arrays or relational FK substitutes.",
      );
    }
  }
}

export async function recordStudentObservation(
  input: RecordObservationInput,
): Promise<StudentObservation> {
  assertResourceOwner(input.userId, input.actorUserId);

  const category = input.category?.trim();
  const type = input.type?.trim();
  const summary = input.summary?.trim();
  const source = input.source?.trim();

  if (!category || category.length > CATEGORY_MAX) {
    throw new ValidationError("Invalid observation category.");
  }
  if (!type || type.length > TYPE_MAX) {
    throw new ValidationError("Invalid observation type.");
  }
  if (!summary || summary.length > SUMMARY_MAX) {
    throw new ValidationError("Invalid observation summary.");
  }
  if (!source || source.length > 80) {
    throw new ValidationError("Invalid observation source.");
  }

  assertNoIdArrays(input.metadata);

  const provenance = input.provenance ?? "OBSERVED";
  // System may pass confidence; clients must not — callers are server domain only.
  const confidence = clampConfidence(
    input.confidence ?? defaultConfidenceFor(provenance),
  );

  return prisma.studentObservation.create({
    data: {
      userId: input.userId,
      category,
      type,
      summary,
      provenance,
      confidence,
      source,
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
