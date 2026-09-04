import type {
  MasteryLevel,
  ProvenanceKind,
  StudentConceptState,
} from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";
import {
  clampConfidence,
  defaultConfidenceFor,
  mayOverwriteCurrentState,
} from "@/lib/provenance/policy";

/**
 * Conservative ConceptState writes.
 * Recording LearningEvidence alone must NOT call this.
 * Phase 2 allows EXPLICIT self-report / settings corrections only for mastery labels.
 */
export type UpsertConceptStateInput = {
  actorUserId: string;
  userId: string;
  conceptId: string;
  mastery: MasteryLevel;
  source: "onboarding" | "settings" | "system";
  /**
   * System may set OBSERVED later; onboarding/settings are always EXPLICIT.
   * TUTOR_SIGNAL must never be treated as EXPLICIT authority.
   */
  provenance?: ProvenanceKind;
  confidence?: number;
  lastEvidenceAt?: Date | null;
};

export async function upsertExplicitConceptState(
  input: UpsertConceptStateInput,
): Promise<StudentConceptState> {
  assertResourceOwner(input.userId, input.actorUserId);

  const concept = await prisma.concept.findUnique({
    where: { id: input.conceptId },
  });
  if (!concept) {
    throw new ValidationError("Concept not found.");
  }

  const provenance: ProvenanceKind =
    input.source === "system" ? (input.provenance ?? "OBSERVED") : "EXPLICIT";

  if (input.source !== "system" && input.provenance && input.provenance !== "EXPLICIT") {
    throw new ValidationError(
      "Onboarding/settings concept state writes must be EXPLICIT.",
    );
  }

  // Never allow callers to smuggle TUTOR_SIGNAL-style authority into EXPLICIT.
  if (provenance !== "EXPLICIT" && input.mastery === "MASTERED") {
    throw new ValidationError(
      "Non-explicit writers cannot set MASTERED in Phase 2.",
    );
  }

  const confidence = clampConfidence(
    input.confidence ?? defaultConfidenceFor(provenance),
  );

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
        source: input.source,
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
      source: input.source,
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
