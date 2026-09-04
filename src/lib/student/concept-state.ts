import type { MasteryLevel, StudentConceptState } from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";
import {
  clampConfidence,
  defaultConfidenceFor,
  mayOverwriteCurrentState,
} from "@/lib/provenance/policy";
import { rejectClientAuthorityFields } from "./attribute-registry";

/**
 * Conservative ConceptState writes.
 * Recording LearningEvidence alone must NOT call this.
 *
 * Phase 2 authority boundary:
 * - Only student-originated onboarding/settings paths may write ConceptState.
 * - Those writes are always EXPLICIT with server-assigned confidence.
 * - System/AI cannot write ConceptState, mint EXPLICIT, or set MASTERED.
 * - Mastery algorithms remain deferred.
 */
export type UpsertConceptStateInput = {
  actorUserId: string;
  userId: string;
  conceptId: string;
  mastery: MasteryLevel;
  /** Student-authoritative writers only. System is rejected. */
  source: "onboarding" | "settings";
  lastEvidenceAt?: Date | null;
};

const STUDENT_SOURCES = new Set(["onboarding", "settings"]);

/**
 * Upsert current concept state from an authorized student-originated path.
 * Provenance/confidence are server-assigned (EXPLICIT).
 */
export async function upsertExplicitConceptState(
  input: UpsertConceptStateInput,
): Promise<StudentConceptState> {
  assertResourceOwner(input.userId, input.actorUserId);

  const bag = input as Record<string, unknown>;
  if (
    "provenance" in bag ||
    "confidence" in bag ||
    Object.prototype.hasOwnProperty.call(bag, "systemProvenance")
  ) {
    rejectClientAuthorityFields({
      provenance: bag.provenance,
      confidence: bag.confidence,
      source: bag.source,
    });
  }

  if (!STUDENT_SOURCES.has(input.source)) {
    throw new ValidationError(
      "Concept state writes require an authorized student-originated path (onboarding/settings).",
    );
  }

  // Defense: reject any residual system-shaped source string at runtime.
  if ((input.source as string) === "system") {
    throw new ValidationError(
      "System/AI actors cannot write StudentConceptState in Phase 2.",
    );
  }

  const concept = await prisma.concept.findUnique({
    where: { id: input.conceptId },
  });
  if (!concept) {
    throw new ValidationError("Concept not found.");
  }

  // Server-controlled authority — never caller-selected.
  const provenance = "EXPLICIT" as const;
  const confidence = clampConfidence(defaultConfidenceFor(provenance));
  const source = input.source;

  const existing = await prisma.studentConceptState.findUnique({
    where: {
      userId_conceptId: {
        userId: input.userId,
        conceptId: input.conceptId,
      },
    },
  });

  if (existing) {
    const allowed = mayOverwriteCurrentState({
      existingProvenance: existing.provenance,
      existingConfidence: existing.confidence,
      incomingProvenance: provenance,
    });
    if (!allowed) {
      return existing;
    }

    return prisma.studentConceptState.update({
      where: { id: existing.id },
      data: {
        mastery: input.mastery,
        confidence,
        provenance,
        source,
        lastEvidenceAt: input.lastEvidenceAt ?? existing.lastEvidenceAt,
      },
    });
  }

  return prisma.studentConceptState.create({
    data: {
      userId: input.userId,
      conceptId: input.conceptId,
      mastery: input.mastery,
      confidence,
      provenance,
      source,
      lastEvidenceAt: input.lastEvidenceAt ?? null,
    },
  });
}

export async function getConceptState(args: {
  actorUserId: string;
  userId: string;
  conceptId: string;
}): Promise<StudentConceptState | null> {
  assertResourceOwner(args.userId, args.actorUserId);
  return prisma.studentConceptState.findUnique({
    where: {
      userId_conceptId: {
        userId: args.userId,
        conceptId: args.conceptId,
      },
    },
  });
}

export async function listConceptStates(args: {
  actorUserId: string;
  userId: string;
}): Promise<StudentConceptState[]> {
  assertResourceOwner(args.userId, args.actorUserId);
  return prisma.studentConceptState.findMany({
    where: { userId: args.userId },
    orderBy: { updatedAt: "desc" },
  });
}
