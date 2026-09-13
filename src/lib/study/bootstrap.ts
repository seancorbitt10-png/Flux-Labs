import { listClasses } from "@/lib/academic/classes";
import { listTasks } from "@/lib/academic/tasks";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { getActiveEntitlement } from "@/lib/entitlements/check";
import { listConceptStates } from "@/lib/student/concept-state";

/** Concept focus option — server-owned concept IDs only. */
export type StudyFocusOption = {
  conceptId: string;
  name: string;
  mastery: string;
};

/** Class focus option — IDs + display labels; never trust client Class blobs. */
export type StudyClassFocusOption = {
  classId: string;
  name: string;
  term: string;
  courseCode: string | null;
};

/** Task focus option — IDs + display labels; never trust client Task blobs. */
export type StudyTaskFocusOption = {
  taskId: string;
  title: string;
  classId: string | null;
  status: string;
  dueAt: string | null;
};

export type StudyBootstrap = {
  focusOptions: StudyFocusOption[];
  classOptions: StudyClassFocusOption[];
  taskOptions: StudyTaskFocusOption[];
  entitlement: {
    plan: string;
    status: string;
  } | null;
  guidance: {
    learningFirst: true;
    note: string;
  };
};

const MAX_CONCEPT_OPTIONS = 12;
const MAX_CLASS_OPTIONS = 24;
const MAX_TASK_OPTIONS = 40;

/**
 * Lightweight Study bootstrap — no second Student Model read path for AI context.
 * Focus options are server-owned IDs only (concepts, classes, tasks).
 *
 * Class/task lists reuse academic domain services (ownership-scoped).
 * Selected focus IDs are validated again at orchestration via academicWorkspace.
 */
export async function getStudyBootstrap(args: {
  actorUserId: string;
  userId: string;
}): Promise<StudyBootstrap> {
  assertResourceOwner(args.userId, args.actorUserId);

  const [states, entitlement, classes, tasks] = await Promise.all([
    listConceptStates({
      actorUserId: args.actorUserId,
      userId: args.userId,
    }),
    getActiveEntitlement(args.userId),
    listClasses({
      actorUserId: args.actorUserId,
      userId: args.userId,
      status: "ACTIVE",
    }),
    listTasks({
      actorUserId: args.actorUserId,
      userId: args.userId,
    }),
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
    if (focusOptions.length >= MAX_CONCEPT_OPTIONS) break;
  }

  const classOptions: StudyClassFocusOption[] = classes
    .slice(0, MAX_CLASS_OPTIONS)
    .map((c) => ({
      classId: c.id,
      name: c.name,
      term: c.term,
      courseCode: c.courseCode ?? null,
    }));

  // Prefer open work for Study focus; include a few recently updated completed
  // only if open list is empty so the picker is never silently blank when
  // the student only has finished tasks.
  const openTasks = tasks.filter(
    (t) => t.status === "TODO" || t.status === "IN_PROGRESS",
  );
  const taskPool =
    openTasks.length > 0
      ? openTasks
      : [...tasks].sort(
          (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
        );

  const taskOptions: StudyTaskFocusOption[] = taskPool
    .slice(0, MAX_TASK_OPTIONS)
    .map((t) => ({
      taskId: t.id,
      title: t.title,
      classId: t.classId,
      status: t.status,
      dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    }));

  return {
    focusOptions,
    classOptions,
    taskOptions,
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
