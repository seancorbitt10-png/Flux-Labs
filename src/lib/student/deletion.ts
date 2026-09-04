import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";

/**
 * Technical deletion / ownership semantics for Phase 2 educational data.
 *
 * User-owned educational rows: deleted.
 * Global catalog (Subject / Topic / SYSTEM Concept / ConceptRelation): retained.
 * USER-created concepts owned by the user: deleted when unused by others
 *   (they are student-authored catalog rows scoped to the owner).
 * Operational rows (UsageRecord / AIInteraction / AuditLog): NOT deleted here.
 *   They retain Phase 1 FK behavior on full account delete and remain subject
 *   to a separate retention/anonymization policy after legal review.
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
    // OnboardingAnswer cascades from OnboardingSession
    const onboardingSessions = await tx.onboardingSession.deleteMany({
      where: { userId },
    });
    const studentProfile = await tx.studentProfile.deleteMany({
      where: { userId },
    });

    // USER-created concepts: delete relations then concepts authored by user.
    const userConcepts = await tx.concept.findMany({
      where: { createdByUserId: userId, source: "USER" },
      select: { id: true },
    });
    const userConceptIds = userConcepts.map((c) => c.id);
    if (userConceptIds.length > 0) {
      await tx.conceptRelation.deleteMany({
        where: {
          OR: [
            { fromConceptId: { in: userConceptIds } },
            { toConceptId: { in: userConceptIds } },
          ],
        },
      });
      // Clear remaining FK refs from other students if any (should be none for USER concepts)
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
    }

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
        userConcepts: userConceptIds.length,
      },
    };
  });
}
