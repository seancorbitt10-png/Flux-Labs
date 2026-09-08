import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import {
  assertNoClientAcademicAuthority,
  archiveClass,
  attachTaskConcepts,
  compareCalendarItems,
  createClass,
  createTask,
  deleteClass,
  deleteTask,
  detachTaskConcepts,
  getClass,
  getTask,
  listClasses,
  listTaskConcepts,
  listTasks,
  queryAcademicCalendar,
  transitionTaskStatus,
  updateClass,
  updateTask,
} from "@/lib/academic";
import {
  createSubject,
  createTopic,
  createSystemConcept,
  createUserConcept,
} from "@/lib/knowledge/catalog";
import {
  deleteUserAccount,
  deleteUserEducationalData,
} from "@/lib/student/deletion";

const prisma = new PrismaClient();
const SYSTEM = { type: "system" as const };

async function cleanup() {
  const where = { email: { endsWith: "@fluxlabs.test" } };
  const users = await prisma.user.findMany({ where, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await prisma.taskConcept.deleteMany({
      where: { task: { userId: { in: ids } } },
    });
    await prisma.task.deleteMany({ where: { userId: { in: ids } } });
    await prisma.class.deleteMany({ where: { userId: { in: ids } } });
    await prisma.aIProposal.deleteMany({ where: { userId: { in: ids } } });
    await prisma.learningEvidence.deleteMany({ where: { userId: { in: ids } } });
    await prisma.studentConceptState.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.studentMisconception.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.studentObservation.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.studentAttribute.deleteMany({ where: { userId: { in: ids } } });
    await prisma.studentGoal.deleteMany({ where: { userId: { in: ids } } });
    await prisma.concept.deleteMany({
      where: { createdByUserId: { in: ids }, source: "USER" },
    });
  }
  await prisma.usageRecord.deleteMany({ where: { user: where } });
  await prisma.aIInteraction.deleteMany({ where: { user: where } });
  await prisma.auditLog.deleteMany({ where: { user: where } });
  await prisma.trial.deleteMany({ where: { user: where } });
  await prisma.entitlement.deleteMany({ where: { user: where } });
  await prisma.studentProfile.deleteMany({ where: { user: where } });
  await prisma.user.deleteMany({ where });

  await prisma.concept.deleteMany({
    where: { topic: { subject: { slug: { startsWith: "test-acad-" } } } },
  });
  await prisma.topic.deleteMany({
    where: { subject: { slug: { startsWith: "test-acad-" } } },
  });
  await prisma.subject.deleteMany({
    where: { slug: { startsWith: "test-acad-" } },
  });
}

async function createUser(suffix: string) {
  return prisma.user.create({
    data: {
      email: `acad.${suffix}@fluxlabs.test`,
      name: "Academic Student",
      passwordHash: "x",
      studentProfile: {
        create: { displayName: "Academic Student", timezone: "America/New_York" },
      },
    },
  });
}

async function seedSystemConcept(slugSuffix: string) {
  const subject = await createSubject({
    actor: SYSTEM,
    slug: `test-acad-sub-${slugSuffix}`,
    name: "Acad Subject",
  });
  const topic = await createTopic({
    actor: SYSTEM,
    subjectId: subject.id,
    slug: `test-acad-top-${slugSuffix}`,
    name: "Acad Topic",
  });
  const concept = await createSystemConcept({
    actor: SYSTEM,
    topicId: topic.id,
    slug: `test-acad-con-${slugSuffix}`,
    name: "System Concept",
  });
  return { subject, topic, concept };
}

describe("Phase 3 Academic Workspace Data Foundation", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanup();
  });

  describe("authority", () => {
    it("rejects client-supplied ownership and completedAt fields", () => {
      expect(() =>
        assertNoClientAcademicAuthority({ name: "X", userId: "attacker" }),
      ).toThrow(/userId/);
      expect(() =>
        assertNoClientAcademicAuthority({
          title: "Y",
          completedAt: new Date().toISOString(),
        }),
      ).toThrow(/completedAt/);
    });

    it("binds Class and Task userId to authenticated actor", async () => {
      const user = await createUser(`bind-${Date.now()}`);
      const klass = await createClass({
        actorUserId: user.id,
        userId: user.id,
        input: { name: "Calc I", term: "Fall 2026" },
      });
      expect(klass.userId).toBe(user.id);

      const task = await createTask({
        actorUserId: user.id,
        userId: user.id,
        input: { title: "Problem set 1", classId: klass.id },
      });
      expect(task.userId).toBe(user.id);
      expect(task.classId).toBe(klass.id);
      expect(task.completedAt).toBeNull();
    });

    it("rejects actor/user mismatch (unauthenticated-style IDOR)", async () => {
      const a = await createUser(`a-${Date.now()}`);
      const b = await createUser(`b-${Date.now()}`);
      await expect(
        createClass({
          actorUserId: b.id,
          userId: a.id,
          input: { name: "Stolen", term: "Fall 2026" },
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        createTask({
          actorUserId: b.id,
          userId: a.id,
          input: { title: "Stolen task" },
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("Class CRUD + IDOR", () => {
    it("creates, lists, gets, updates, archives", async () => {
      const user = await createUser(`class-${Date.now()}`);
      const created = await createClass({
        actorUserId: user.id,
        userId: user.id,
        input: {
          name: "Organic Chemistry",
          term: "Spring 2026",
          courseCode: "CHEM-301",
        },
      });
      expect(created.status).toBe("ACTIVE");

      const listed = await listClasses({
        actorUserId: user.id,
        userId: user.id,
        status: "ACTIVE",
      });
      expect(listed.some((c) => c.id === created.id)).toBe(true);

      const got = await getClass({
        actorUserId: user.id,
        userId: user.id,
        classId: created.id,
      });
      expect(got.name).toBe("Organic Chemistry");

      const updated = await updateClass({
        actorUserId: user.id,
        userId: user.id,
        classId: created.id,
        input: { instructorName: "Dr. Lee" },
      });
      expect(updated.instructorName).toBe("Dr. Lee");

      const archived = await archiveClass({
        actorUserId: user.id,
        userId: user.id,
        classId: created.id,
      });
      expect(archived.status).toBe("ARCHIVED");
    });

    it("rejects empty/invalid class names and cross-user access", async () => {
      const a = await createUser(`ca-${Date.now()}`);
      const b = await createUser(`cb-${Date.now()}`);
      const klass = await createClass({
        actorUserId: a.id,
        userId: a.id,
        input: { name: "Mine", term: "Fall 2026" },
      });

      await expect(
        createClass({
          actorUserId: a.id,
          userId: a.id,
          input: { name: "   ", term: "Fall 2026" },
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        getClass({ actorUserId: b.id, userId: b.id, classId: klass.id }),
      ).rejects.toThrow(/Class not found/);
      await expect(
        updateClass({
          actorUserId: b.id,
          userId: b.id,
          classId: klass.id,
          input: { name: "Hijack" },
        }),
      ).rejects.toThrow(/Class not found/);
      await expect(
        deleteClass({ actorUserId: b.id, userId: b.id, classId: klass.id }),
      ).rejects.toThrow(/Class not found/);
    });
  });

  describe("Task CRUD + class attach + IDOR", () => {
    it("creates tasks with and without class; rejects foreign class attach", async () => {
      const a = await createUser(`ta-${Date.now()}`);
      const b = await createUser(`tb-${Date.now()}`);
      const aClass = await createClass({
        actorUserId: a.id,
        userId: a.id,
        input: { name: "A Class", term: "Fall 2026" },
      });
      const bClass = await createClass({
        actorUserId: b.id,
        userId: b.id,
        input: { name: "B Class", term: "Fall 2026" },
      });

      const orphan = await createTask({
        actorUserId: a.id,
        userId: a.id,
        input: { title: "Uncategorized reading" },
      });
      expect(orphan.classId).toBeNull();

      const linked = await createTask({
        actorUserId: a.id,
        userId: a.id,
        input: { title: "Homework", classId: aClass.id, priority: 2 },
      });
      expect(linked.classId).toBe(aClass.id);

      await expect(
        createTask({
          actorUserId: a.id,
          userId: a.id,
          input: { title: "Steal", classId: bClass.id },
        }),
      ).rejects.toThrow(/Class not found/);

      await expect(
        getTask({ actorUserId: b.id, userId: b.id, taskId: linked.id }),
      ).rejects.toThrow(/Task not found/);
      await expect(
        updateTask({
          actorUserId: b.id,
          userId: b.id,
          taskId: linked.id,
          input: { title: "Nope" },
        }),
      ).rejects.toThrow(/Task not found/);
      await expect(
        deleteTask({ actorUserId: b.id, userId: b.id, taskId: linked.id }),
      ).rejects.toThrow(/Task not found/);
    });

    it("rejects invalid titles, enums, priority, estimatedMinutes, dates", async () => {
      const user = await createUser(`val-${Date.now()}`);
      await expect(
        createTask({
          actorUserId: user.id,
          userId: user.id,
          input: { title: "" },
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        createTask({
          actorUserId: user.id,
          userId: user.id,
          input: { title: "X", priority: 99 },
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        createTask({
          actorUserId: user.id,
          userId: user.id,
          input: { title: "X", estimatedMinutes: 0 },
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      const start = new Date("2026-10-10T12:00:00.000Z");
      const due = new Date("2026-10-01T12:00:00.000Z");
      await expect(
        createTask({
          actorUserId: user.id,
          userId: user.id,
          input: {
            title: "Bad range",
            startsAt: start.toISOString(),
            dueAt: due.toISOString(),
          },
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        createTask({
          actorUserId: user.id,
          userId: user.id,
          input: { title: "Bad status", status: "COMPLETED" },
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("Task status / completedAt", () => {
    it("sets completedAt server-side on COMPLETED and clears on reopen", async () => {
      const user = await createUser(`st-${Date.now()}`);
      const task = await createTask({
        actorUserId: user.id,
        userId: user.id,
        input: { title: "Essay draft" },
      });

      const done = await transitionTaskStatus({
        actorUserId: user.id,
        userId: user.id,
        taskId: task.id,
        status: "COMPLETED",
      });
      expect(done.status).toBe("COMPLETED");
      expect(done.completedAt).toBeInstanceOf(Date);

      const reopened = await transitionTaskStatus({
        actorUserId: user.id,
        userId: user.id,
        taskId: task.id,
        status: "TODO",
      });
      expect(reopened.status).toBe("TODO");
      expect(reopened.completedAt).toBeNull();
    });

    it("rejects invalid transitions and client completedAt", async () => {
      const user = await createUser(`tr-${Date.now()}`);
      const task = await createTask({
        actorUserId: user.id,
        userId: user.id,
        input: { title: "Quiz" },
      });
      await transitionTaskStatus({
        actorUserId: user.id,
        userId: user.id,
        taskId: task.id,
        status: "CANCELLED",
      });

      await expect(
        transitionTaskStatus({
          actorUserId: user.id,
          userId: user.id,
          taskId: task.id,
          status: "IN_PROGRESS",
        }),
      ).rejects.toThrow(/Invalid task status transition/);

      await expect(
        updateTask({
          actorUserId: user.id,
          userId: user.id,
          taskId: task.id,
          input: {
            status: "TODO",
            completedAt: new Date().toISOString(),
          } as never,
        }),
      ).rejects.toThrow(/completedAt/);
    });
  });

  describe("TaskConcept", () => {
    it("links SYSTEM and owned USER concepts; rejects foreign USER concepts and duplicates", async () => {
      const a = await createUser(`tca-${Date.now()}`);
      const b = await createUser(`tcb-${Date.now()}`);
      const { concept: systemConcept, topic } = await seedSystemConcept(
        `${Date.now()}`,
      );
      const aConcept = await createUserConcept({
        actor: { type: "user", userId: a.id },
        topicId: topic.id,
        slug: `user-a-${Date.now()}`,
        name: "A private concept",
      });
      const bConcept = await createUserConcept({
        actor: { type: "user", userId: b.id },
        topicId: topic.id,
        slug: `user-b-${Date.now()}`,
        name: "B private concept",
      });

      const task = await createTask({
        actorUserId: a.id,
        userId: a.id,
        input: {
          title: "Study guide",
          conceptIds: [systemConcept.id, aConcept.id],
        },
      });
      expect(task.taskConcepts).toHaveLength(2);

      await expect(
        attachTaskConcepts({
          actorUserId: a.id,
          userId: a.id,
          taskId: task.id,
          conceptIds: [bConcept.id],
        }),
      ).rejects.toThrow(/Concept not found/);

      await expect(
        attachTaskConcepts({
          actorUserId: a.id,
          userId: a.id,
          taskId: task.id,
          conceptIds: [systemConcept.id, systemConcept.id],
        }),
      ).rejects.toThrow(/Duplicate concept/);

      const listed = await listTaskConcepts({
        actorUserId: a.id,
        userId: a.id,
        taskId: task.id,
      });
      expect(listed.length).toBe(2);

      await detachTaskConcepts({
        actorUserId: a.id,
        userId: a.id,
        taskId: task.id,
        conceptIds: [aConcept.id],
      });
      expect(
        (
          await listTaskConcepts({
            actorUserId: a.id,
            userId: a.id,
            taskId: task.id,
          })
        ).map((r) => r.conceptId),
      ).toEqual([systemConcept.id]);

      // Cross-user TaskConcept manipulation
      await expect(
        attachTaskConcepts({
          actorUserId: b.id,
          userId: b.id,
          taskId: task.id,
          conceptIds: [systemConcept.id],
        }),
      ).rejects.toThrow(/Task not found/);
    });
  });

  describe("deletion semantics", () => {
    it("deleting Class preserves Tasks and nulls classId", async () => {
      const user = await createUser(`delc-${Date.now()}`);
      const klass = await createClass({
        actorUserId: user.id,
        userId: user.id,
        input: { name: "Physics", term: "Fall 2026" },
      });
      const task = await createTask({
        actorUserId: user.id,
        userId: user.id,
        input: { title: "Lab report", classId: klass.id },
      });

      const result = await deleteClass({
        actorUserId: user.id,
        userId: user.id,
        classId: klass.id,
      });
      expect(result.tasksDetached).toBe(1);

      const refreshed = await getTask({
        actorUserId: user.id,
        userId: user.id,
        taskId: task.id,
      });
      expect(refreshed.classId).toBeNull();
      expect(await prisma.class.findUnique({ where: { id: klass.id } })).toBeNull();
    });

    it("deleting Task removes TaskConcept rows without SM mutation", async () => {
      const user = await createUser(`delt-${Date.now()}`);
      const { concept } = await seedSystemConcept(`del-${Date.now()}`);
      const task = await createTask({
        actorUserId: user.id,
        userId: user.id,
        input: { title: "Flashcards", conceptIds: [concept.id] },
      });
      const beforeGoals = await prisma.studentGoal.count({
        where: { userId: user.id },
      });

      await deleteTask({
        actorUserId: user.id,
        userId: user.id,
        taskId: task.id,
      });
      expect(
        await prisma.taskConcept.count({ where: { conceptId: concept.id } }),
      ).toBe(0);
      expect(await prisma.concept.findUnique({ where: { id: concept.id } })).not.toBeNull();
      expect(
        await prisma.studentGoal.count({ where: { userId: user.id } }),
      ).toBe(beforeGoals);
    });

    it("deleting User removes Classes and Tasks; SYSTEM concepts survive", async () => {
      const user = await createUser(`delu-${Date.now()}`);
      const { concept } = await seedSystemConcept(`userdel-${Date.now()}`);
      const klass = await createClass({
        actorUserId: user.id,
        userId: user.id,
        input: { name: "History", term: "Fall 2026" },
      });
      await createTask({
        actorUserId: user.id,
        userId: user.id,
        input: {
          title: "Essay",
          classId: klass.id,
          conceptIds: [concept.id],
        },
      });

      await deleteUserAccount({ actorUserId: user.id, userId: user.id });
      expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
      expect(await prisma.class.count({ where: { id: klass.id } })).toBe(0);
      expect(await prisma.concept.findUnique({ where: { id: concept.id } })).not.toBeNull();
    });

    it("educational wipe deletes Classes and Tasks", async () => {
      const user = await createUser(`wipe-${Date.now()}`);
      await createClass({
        actorUserId: user.id,
        userId: user.id,
        input: { name: "Wipe Class", term: "Fall 2026" },
      });
      await createTask({
        actorUserId: user.id,
        userId: user.id,
        input: { title: "Wipe Task" },
      });

      const result = await deleteUserEducationalData({
        actorUserId: user.id,
        userId: user.id,
      });
      expect(result.deleted.classes).toBe(1);
      expect(result.deleted.tasks).toBe(1);
      expect(await prisma.class.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.task.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    });
  });

  describe("calendar query", () => {
    it("filters by date range, class, status; never returns other users' records", async () => {
      const a = await createUser(`cala-${Date.now()}`);
      const b = await createUser(`calb-${Date.now()}`);
      const aClass = await createClass({
        actorUserId: a.id,
        userId: a.id,
        input: {
          name: "Biology",
          term: "Fall 2026",
          startsAt: "2026-09-01T00:00:00.000Z",
          endsAt: "2026-12-15T00:00:00.000Z",
        },
      });
      await createTask({
        actorUserId: a.id,
        userId: a.id,
        input: {
          title: "Midterm",
          classId: aClass.id,
          dueAt: "2026-10-15T16:00:00.000Z",
          priority: 1,
        },
      });
      await createTask({
        actorUserId: a.id,
        userId: a.id,
        input: {
          title: "Far future",
          dueAt: "2027-01-01T00:00:00.000Z",
        },
      });
      await createTask({
        actorUserId: b.id,
        userId: b.id,
        input: {
          title: "B secret",
          dueAt: "2026-10-15T16:00:00.000Z",
        },
      });

      const result = await queryAcademicCalendar({
        actorUserId: a.id,
        userId: a.id,
        query: {
          from: "2026-10-01T00:00:00.000Z",
          to: "2026-10-31T23:59:59.000Z",
        },
      });

      const taskTitles = result.items
        .filter((i) => i.kind === "task")
        .map((i) => i.title);
      expect(taskTitles).toContain("Midterm");
      expect(taskTitles).not.toContain("Far future");
      expect(taskTitles).not.toContain("B secret");

      const classFiltered = await queryAcademicCalendar({
        actorUserId: a.id,
        userId: a.id,
        query: {
          from: "2026-10-01T00:00:00.000Z",
          to: "2026-10-31T23:59:59.000Z",
          classId: aClass.id,
        },
      });
      expect(
        classFiltered.items.filter((i) => i.kind === "task").every((i) => {
          return i.kind === "task" && i.class?.id === aClass.id;
        }),
      ).toBe(true);

      await transitionTaskStatus({
        actorUserId: a.id,
        userId: a.id,
        taskId: (
          await listTasks({ actorUserId: a.id, userId: a.id })
        ).find((t) => t.title === "Midterm")!.id,
        status: "COMPLETED",
      });

      const statusFiltered = await queryAcademicCalendar({
        actorUserId: a.id,
        userId: a.id,
        query: {
          from: "2026-10-01T00:00:00.000Z",
          to: "2026-10-31T23:59:59.000Z",
          status: "COMPLETED",
        },
      });
      expect(
        statusFiltered.items.filter((i) => i.kind === "task"),
      ).toHaveLength(1);

      await expect(
        queryAcademicCalendar({
          actorUserId: a.id,
          userId: a.id,
          query: {
            from: "2026-10-01T00:00:00.000Z",
            to: "2026-09-01T00:00:00.000Z",
          },
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("respects result limit / truncation", async () => {
      const user = await createUser(`lim-${Date.now()}`);
      for (let i = 0; i < 5; i++) {
        await createTask({
          actorUserId: user.id,
          userId: user.id,
          input: {
            title: `T${i}`,
            dueAt: `2026-11-0${i + 1}T12:00:00.000Z`,
          },
        });
      }
      const result = await queryAcademicCalendar({
        actorUserId: user.id,
        userId: user.id,
        query: {
          from: "2026-11-01T00:00:00.000Z",
          to: "2026-11-30T00:00:00.000Z",
          limit: 3,
          status: "TODO",
        },
      });
      expect(result.items.length).toBeLessThanOrEqual(3);
      expect(result.truncated).toBe(true);
    });

    it("applies global limit after merge so early class periods are not dropped", async () => {
      const user = await createUser(`mix-${Date.now()}`);
      // Earliest: class period on day 1
      await createClass({
        actorUserId: user.id,
        userId: user.id,
        input: {
          name: "Early Class",
          term: "Fall 2026",
          startsAt: "2026-12-01T08:00:00.000Z",
          endsAt: "2026-12-20T08:00:00.000Z",
        },
      });
      // Three later tasks
      for (let i = 0; i < 3; i++) {
        await createTask({
          actorUserId: user.id,
          userId: user.id,
          input: {
            title: `Later Task ${i}`,
            dueAt: `2026-12-1${i + 2}T12:00:00.000Z`,
          },
        });
      }
      // Another class period later
      await createClass({
        actorUserId: user.id,
        userId: user.id,
        input: {
          name: "Late Class",
          term: "Fall 2026",
          startsAt: "2026-12-18T08:00:00.000Z",
          endsAt: "2026-12-25T08:00:00.000Z",
        },
      });

      const result = await queryAcademicCalendar({
        actorUserId: user.id,
        userId: user.id,
        query: {
          from: "2026-12-01T00:00:00.000Z",
          to: "2026-12-31T23:59:59.000Z",
          limit: 3,
        },
      });

      expect(result.items).toHaveLength(3);
      expect(result.truncated).toBe(true);
      // First item must be the earliest class period, not a later task.
      expect(result.items[0]!.kind).toBe("class_period");
      expect(result.items[0]!.kind === "class_period" && result.items[0].name).toBe(
        "Early Class",
      );
      expect(result.items[1]!.kind).toBe("task");
      expect(result.items[2]!.kind).toBe("task");

      // Full ordered set without limit for regression comparison
      const full = await queryAcademicCalendar({
        actorUserId: user.id,
        userId: user.id,
        query: {
          from: "2026-12-01T00:00:00.000Z",
          to: "2026-12-31T23:59:59.000Z",
          limit: 50,
        },
      });
      expect(full.truncated).toBe(false);
      expect(full.items.slice(0, 3).map((i) => i.id)).toEqual(
        result.items.map((i) => i.id),
      );
    });

    it("orders equal sortAt with deterministic kind then id tie-breakers", () => {
      const t = new Date("2026-12-10T12:00:00.000Z");
      const a = {
        kind: "task" as const,
        id: "task-b",
        title: "B",
        status: "TODO" as const,
        dueAt: t,
        startsAt: null,
        priority: null,
        estimatedMinutes: null,
        class: null,
        sortAt: t,
      };
      const b = {
        kind: "class_period" as const,
        id: "class-a",
        name: "A",
        term: "Fall",
        status: "ACTIVE" as const,
        courseCode: null,
        startsAt: t,
        endsAt: null,
        sortAt: t,
      };
      const c = {
        kind: "task" as const,
        id: "task-a",
        title: "A",
        status: "TODO" as const,
        dueAt: t,
        startsAt: null,
        priority: null,
        estimatedMinutes: null,
        class: null,
        sortAt: t,
      };
      const sorted = [a, b, c].sort(compareCalendarItems);
      expect(sorted.map((i) => i.id)).toEqual(["class-a", "task-a", "task-b"]);
    });
  });

  describe("class date invariant on partial update", () => {
    it("rejects updating only startsAt into an invalid range", async () => {
      const user = await createUser(`cdate-${Date.now()}`);
      const klass = await createClass({
        actorUserId: user.id,
        userId: user.id,
        input: {
          name: "Date Class",
          term: "Fall 2026",
          startsAt: "2026-01-10T00:00:00.000Z",
          endsAt: "2026-01-20T00:00:00.000Z",
        },
      });

      await expect(
        updateClass({
          actorUserId: user.id,
          userId: user.id,
          classId: klass.id,
          input: { startsAt: "2026-01-30T00:00:00.000Z" },
        }),
      ).rejects.toThrow(/Class start must be on or before end/);

      const still = await getClass({
        actorUserId: user.id,
        userId: user.id,
        classId: klass.id,
      });
      expect(still.startsAt?.toISOString()).toBe("2026-01-10T00:00:00.000Z");
      expect(still.endsAt?.toISOString()).toBe("2026-01-20T00:00:00.000Z");
    });

    it("rejects updating only endsAt into an invalid range", async () => {
      const user = await createUser(`cend-${Date.now()}`);
      const klass = await createClass({
        actorUserId: user.id,
        userId: user.id,
        input: {
          name: "Date Class",
          term: "Fall 2026",
          startsAt: "2026-01-10T00:00:00.000Z",
          endsAt: "2026-01-20T00:00:00.000Z",
        },
      });

      await expect(
        updateClass({
          actorUserId: user.id,
          userId: user.id,
          classId: klass.id,
          input: { endsAt: "2026-01-05T00:00:00.000Z" },
        }),
      ).rejects.toThrow(/Class start must be on or before end/);
    });

    it("accepts updating both dates to a valid range", async () => {
      const user = await createUser(`cboth-${Date.now()}`);
      const klass = await createClass({
        actorUserId: user.id,
        userId: user.id,
        input: {
          name: "Date Class",
          term: "Fall 2026",
          startsAt: "2026-01-10T00:00:00.000Z",
          endsAt: "2026-01-20T00:00:00.000Z",
        },
      });

      const updated = await updateClass({
        actorUserId: user.id,
        userId: user.id,
        classId: klass.id,
        input: {
          startsAt: "2026-02-01T00:00:00.000Z",
          endsAt: "2026-02-28T00:00:00.000Z",
        },
      });
      expect(updated.startsAt?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
      expect(updated.endsAt?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    });

    it("allows clearing nullable date fields", async () => {
      const user = await createUser(`cclear-${Date.now()}`);
      const klass = await createClass({
        actorUserId: user.id,
        userId: user.id,
        input: {
          name: "Date Class",
          term: "Fall 2026",
          startsAt: "2026-01-10T00:00:00.000Z",
          endsAt: "2026-01-20T00:00:00.000Z",
        },
      });

      const clearedStart = await updateClass({
        actorUserId: user.id,
        userId: user.id,
        classId: klass.id,
        input: { startsAt: null },
      });
      expect(clearedStart.startsAt).toBeNull();
      expect(clearedStart.endsAt?.toISOString()).toBe("2026-01-20T00:00:00.000Z");

      const clearedBoth = await updateClass({
        actorUserId: user.id,
        userId: user.id,
        classId: klass.id,
        input: { endsAt: null },
      });
      expect(clearedBoth.startsAt).toBeNull();
      expect(clearedBoth.endsAt).toBeNull();
    });

    it("preserves valid dates when updating unrelated fields", async () => {
      const user = await createUser(`cunrel-${Date.now()}`);
      const klass = await createClass({
        actorUserId: user.id,
        userId: user.id,
        input: {
          name: "Date Class",
          term: "Fall 2026",
          startsAt: "2026-01-10T00:00:00.000Z",
          endsAt: "2026-01-20T00:00:00.000Z",
        },
      });

      const updated = await updateClass({
        actorUserId: user.id,
        userId: user.id,
        classId: klass.id,
        input: { instructorName: "Dr. Preserved" },
      });
      expect(updated.instructorName).toBe("Dr. Preserved");
      expect(updated.startsAt?.toISOString()).toBe("2026-01-10T00:00:00.000Z");
      expect(updated.endsAt?.toISOString()).toBe("2026-01-20T00:00:00.000Z");
    });
  });
});
