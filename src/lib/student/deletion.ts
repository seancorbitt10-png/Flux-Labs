import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Technical deletion / ownership semantics for Phase 2 educational data.
 *
 * User-owned educational rows: deleted.
 * Global catalog (Subject / Topic / SYSTEM Concept / ConceptRelation): retained.
 * USER-created concepts owned by the user: deleted with the user
 *   (FK onDelete Cascade on Concept.createdByUserId — SYSTEM concepts have
 *   null createdByUserId and are unaffected).
 * Operational rows (UsageRecord / AIInteraction / AuditLog): NOT deleted here
 *   for educational wipe; on full account delete they follow Phase 1 FK rules
 *   (Usage/AI Cascade, AuditLog SetNull) pending separate retention review.
 *   This module does not invent a legal retention policy.
 */
export type DeleteEducationalDataResult = {
  deleted: {
    studentProfile: number;
    studentAttributes: number;
    studentGoals: number;
    onboardingSessions: number;
    studentObservations: number;
    learningEvidence: number;
    studentConceptStates: number;
    studentMisconceptions: number;
    userConcepts: number;
  };
};

async function deleteUserOwnedConcepts(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  const userConcepts = await tx.concept.findMany({
    where: { createdByUserId: userId, source: "USER" },
    select: { id: true },
  });
  const userConceptIds = userConcepts.map((c) => c.id);
  if (userConceptIds.length === 0) return 0;

  await tx.conceptRelation.deleteMany({
    where: {
      OR: [
        { fromConceptId: { in: userConceptIds } },
        { toConceptId: { in: userConceptIds } },
      ],
    },
  });
  await tx.learningEvidence.updateMany({
    where: { conceptId: { in: userConceptIds } },
    data: { conceptId: null },
  });
  await tx.studentMisconception.updateMany({
    where: { conceptId: { in: userConceptIds } },
    data: { conceptId: null },
  });
  await tx.studentConceptState.deleteMany({
    where: { conceptId: { in: userConceptIds } },
  });
  await tx.concept.deleteMany({
    where: { id: { in: userConceptIds } },
  });
  return userConceptIds.length;
}

export async function deleteUserEducationalData(args: {
  actorUserId: string;
  userId: string;
}): Promise<DeleteEducationalDataResult> {
  assertResourceOwner(args.userId, args.actorUserId);

  return prisma.$transaction(async (tx) => {
    const userId = args.userId;

    const learningEvidence = await tx.learningEvidence.deleteMany({
      where: { userId },
    });
    const studentConceptStates = await tx.studentConceptState.deleteMany({
      where: { userId },
    });
    const studentMisconceptions = await tx.studentMisconception.deleteMany({
      where: { userId },
    });
    const studentObservations = await tx.studentObservation.deleteMany({
      where: { userId },
    });
    const studentAttributes = await tx.studentAttribute.deleteMany({
      where: { userId },
    });
    const studentGoals = await tx.studentGoal.deleteMany({
      where: { userId },
    });
    const onboardingSessions = await tx.onboardingSession.deleteMany({
      where: { userId },
    });
    const studentProfile = await tx.studentProfile.deleteMany({
      where: { userId },
    });

    const userConcepts = await deleteUserOwnedConcepts(tx, userId);

    await tx.auditLog.create({
      data: {
        userId,
        action: "student.educational_data.deleted",
        resource: "User",
        resourceId: userId,
        metadata: { scope: "educational_only" },
      },
    });

    return {
      deleted: {
        studentProfile: studentProfile.count,
        studentAttributes: studentAttributes.count,
        studentGoals: studentGoals.count,
        onboardingSessions: onboardingSessions.count,
        studentObservations: studentObservations.count,
        learningEvidence: learningEvidence.count,
        studentConceptStates: studentConceptStates.count,
        studentMisconceptions: studentMisconceptions.count,
        userConcepts,
      },
    };
  });
}

/**
 * Full account deletion path.
 * Deletes USER concepts, then the User row (remaining student-owned rows cascade).
 * SYSTEM catalog concepts (createdByUserId null) are retained.
 * FK Concept.createdByUserId ON DELETE CASCADE is a safety net if any USER
 * concepts remain at user-delete time.
 */
export async function deleteUserAccount(args: {
  actorUserId: string;
  userId: string;
}): Promise<void> {
  assertResourceOwner(args.userId, args.actorUserId);

  await prisma.$transaction(async (tx) => {
    await deleteUserOwnedConcepts(tx, args.userId);
    await tx.user.delete({ where: { id: args.userId } });
  });
}
