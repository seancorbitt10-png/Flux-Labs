import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { getActiveEntitlement } from "@/lib/entitlements/check";
import { listConceptStates } from "@/lib/student/concept-state";

export type StudyFocusOption = {
  conceptId: string;
  name: string;
  mastery: string;
};

export type StudyBootstrap = {
  focusOptions: StudyFocusOption[];
  entitlement: {
    plan: string;
    status: string;
  } | null;
  guidance: {
    learningFirst: true;
    note: string;
  };
};

/**
 * Lightweight Study bootstrap — no second Student Model read path for AI context.
 * Focus options come from the student's existing concept states (server-owned IDs only).
 */
export async function getStudyBootstrap(args: {
  actorUserId: string;
  userId: string;
}): Promise<StudyBootstrap> {
  assertResourceOwner(args.userId, args.actorUserId);

  const [states, entitlement] = await Promise.all([
    listConceptStates({
      actorUserId: args.actorUserId,
      userId: args.userId,
    }),
    getActiveEntitlement(args.userId),
  ]);

  const conceptIds = states.map((s) => s.conceptId);
  const concepts =
    conceptIds.length === 0
      ? []
      : await prisma.concept.findMany({
          where: {
            id: { in: conceptIds },
            OR: [
              { source: "SYSTEM" },
              { source: "USER", createdByUserId: args.actorUserId },
            ],
          },
          select: { id: true, name: true },
        });
  const nameById = new Map(concepts.map((c) => [c.id, c.name]));

  const focusOptions: StudyFocusOption[] = [];
  for (const state of states) {
    const name = nameById.get(state.conceptId);
    if (!name) continue;
    focusOptions.push({
      conceptId: state.conceptId,
      name,
      mastery: state.mastery,
    });
    if (focusOptions.length >= 12) break;
  }

  return {
    focusOptions,
    entitlement: entitlement
      ? {
          plan: entitlement.entitlement.plan,
          status: entitlement.entitlement.status,
        }
      : null,
    guidance: {
      learningFirst: true,
      note: "Flux guides learning — ask, attempt, and check understanding rather than requesting finished work.",
    },
  };
}
