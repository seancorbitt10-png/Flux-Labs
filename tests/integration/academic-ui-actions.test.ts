import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PrismaClient } from "@prisma/client";

const authState = vi.hoisted(() => ({
  userId: null as string | null,
}));

vi.mock("@/lib/auth/session", () => ({
  requireUserId: async () => {
    if (!authState.userId) {
      const { UnauthorizedError } = await import("@/lib/errors");
      throw new UnauthorizedError();
    }
    return authState.userId;
  },
  requireSession: async () => {
    if (!authState.userId) {
      const { UnauthorizedError } = await import("@/lib/errors");
      throw new UnauthorizedError();
    }
    return { user: { id: authState.userId } };
  },
}));

vi.mock("@/lib/security/rate-limit", () => ({
  assertRateLimit: () => undefined,
}));

import {
  createClassAction,
  createTaskAction,
  deleteClassAction,
  deleteTaskAction,
  getClassAction,
  getTaskAction,
  loadClassesWorkspaceAction,
  loadTasksWorkspaceAction,
  setClassStatusAction,
  setTaskStatusAction,
  updateClassAction,
  updateTaskAction,
} from "@/lib/academic/actions";
import {
  getClassesWorkspaceBootstrap,
  getTasksWorkspaceBootstrap,
} from "@/lib/academic/workspace";

const prisma = new PrismaClient();

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
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.studentProfile.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where });
  }
}

async function createUser(suffix: string) {
  return prisma.user.create({
    data: {
      email: `acad-ui.${suffix}@fluxlabs.test`,
      name: "Academic UI",
      passwordHash: "x",
      studentProfile: {
        create: {
          displayName: "Academic UI",
          timezone: "America/New_York",
        },
      },
    },
  });
}

describe("Phase 3 Classes + Tasks UI integration", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    authState.userId = null;
    await cleanup();
  });

  describe("workspace bootstrap", () => {
    it("returns empty lists for a new student", async () => {
      const user = await createUser(`empty-${Date.now()}`);
      const classes = await getClassesWorkspaceBootstrap({
        actorUserId: user.id,
        userId: user.id,
      });
      const tasks = await getTasksWorkspaceBootstrap({
        actorUserId: user.id,
        userId: user.id,
      });
      expect(classes.classes).toEqual([]);
      expect(classes.timezone).toBe("America/New_York");
      expect(tasks.tasks).toEqual([]);
      expect(tasks.classOptions).toEqual([]);
    });

    it("rejects actor/user mismatch", async () => {
      const a = await createUser(`boot-a-${Date.now()}`);
      const b = await createUser(`boot-b-${Date.now()}`);
      await expect(
        getClassesWorkspaceBootstrap({
          actorUserId: a.id,
          userId: b.id,
        }),
      ).rejects.toThrow(/Forbidden|access/i);
    });
  });

  describe("authenticated class actions", () => {
    it("creates, lists, edits, archives, unarchives, and deletes", async () => {
      const user = await createUser(`cls-${Date.now()}`);
      authState.userId = user.id;

      const empty = await loadClassesWorkspaceAction();
      expect(empty.ok).toBe(true);
      if (empty.ok) expect(empty.data.classes).toHaveLength(0);

      const created = await createClassAction({
        name: "Biology",
        term: "Fall 2026",
        courseCode: "BIO-101",
        instructorName: "Dr. Lee",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.data.class.name).toBe("Biology");
      expect(
        Object.prototype.hasOwnProperty.call(created.data.class, "userId"),
      ).toBe(false);

      const listed = await loadClassesWorkspaceAction();
      expect(listed.ok).toBe(true);
      if (listed.ok) expect(listed.data.classes).toHaveLength(1);

      const updated = await updateClassAction({
        classId: created.data.class.id,
        input: { instructorName: "Dr. Park" },
      });
      expect(updated.ok).toBe(true);
      if (updated.ok) {
        expect(updated.data.class.instructorName).toBe("Dr. Park");
      }

      const archived = await setClassStatusAction({
        classId: created.data.class.id,
        status: "ARCHIVED",
      });
      expect(archived.ok).toBe(true);
      if (archived.ok) expect(archived.data.class.status).toBe("ARCHIVED");

      const restored = await setClassStatusAction({
        classId: created.data.class.id,
        status: "ACTIVE",
      });
      expect(restored.ok).toBe(true);
      if (restored.ok) expect(restored.data.class.status).toBe("ACTIVE");

      const deleted = await deleteClassAction({
        classId: created.data.class.id,
      });
      expect(deleted.ok).toBe(true);
      if (deleted.ok) {
        expect(deleted.data.deletedClassId).toBe(created.data.class.id);
      }

      const after = await loadClassesWorkspaceAction();
      expect(after.ok).toBe(true);
      if (after.ok) expect(after.data.classes).toHaveLength(0);
    });

    it("rejects client userId authority and invalid names", async () => {
      const user = await createUser(`cls-bad-${Date.now()}`);
      authState.userId = user.id;

      const forbidden = await createClassAction({
        name: "Chem",
        term: "Fall 2026",
        userId: "someone-else",
      });
      expect(forbidden.ok).toBe(false);
      if (!forbidden.ok) {
        expect(forbidden.message).toMatch(/cannot supply userId/i);
      }

      const invalid = await createClassAction({
        name: "",
        term: "Fall 2026",
      });
      expect(invalid.ok).toBe(false);
    });

    it("blocks cross-user class read/update/delete (IDOR)", async () => {
      const owner = await createUser(`cls-own-${Date.now()}`);
      const attacker = await createUser(`cls-atk-${Date.now()}`);
      authState.userId = owner.id;
      const created = await createClassAction({
        name: "Secret",
        term: "Fall 2026",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      authState.userId = attacker.id;
      const got = await getClassAction({ classId: created.data.class.id });
      expect(got.ok).toBe(false);
      if (!got.ok) expect(got.message).toMatch(/not found/i);

      const updated = await updateClassAction({
        classId: created.data.class.id,
        input: { name: "Hijacked" },
      });
      expect(updated.ok).toBe(false);

      const deleted = await deleteClassAction({
        classId: created.data.class.id,
      });
      expect(deleted.ok).toBe(false);

      authState.userId = owner.id;
      const still = await getClassAction({ classId: created.data.class.id });
      expect(still.ok).toBe(true);
      if (still.ok) expect(still.data.class.name).toBe("Secret");
    });
  });

  describe("authenticated task actions", () => {
    it("creates, edits class link, transitions status, and deletes", async () => {
      const user = await createUser(`tsk-${Date.now()}`);
      authState.userId = user.id;

      const klass = await createClassAction({
        name: "Physics",
        term: "Fall 2026",
      });
      expect(klass.ok).toBe(true);
      if (!klass.ok) return;

      const empty = await loadTasksWorkspaceAction();
      expect(empty.ok).toBe(true);
      if (empty.ok) {
        expect(empty.data.tasks).toHaveLength(0);
        expect(empty.data.classOptions.some((c) => c.id === klass.data.class.id)).toBe(
          true,
        );
      }

      const created = await createTaskAction({
        title: "Problem set 1",
        classId: klass.data.class.id,
        dueAt: "2026-11-01T17:00:00.000Z",
        priority: 2,
        status: "TODO",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.data.task.className).toBe("Physics");
      expect(created.data.task.completedAt).toBeNull();

      const unlinked = await updateTaskAction({
        taskId: created.data.task.id,
        input: { classId: null },
      });
      expect(unlinked.ok).toBe(true);
      if (unlinked.ok) {
        expect(unlinked.data.task.classId).toBeNull();
        expect(unlinked.data.task.className).toBeNull();
      }

      const relinked = await updateTaskAction({
        taskId: created.data.task.id,
        input: { classId: klass.data.class.id, priority: 1 },
      });
      expect(relinked.ok).toBe(true);
      if (relinked.ok) {
        expect(relinked.data.task.classId).toBe(klass.data.class.id);
        expect(relinked.data.task.priority).toBe(1);
      }

      const started = await setTaskStatusAction({
        taskId: created.data.task.id,
        status: "IN_PROGRESS",
      });
      expect(started.ok).toBe(true);

      const completed = await setTaskStatusAction({
        taskId: created.data.task.id,
        status: "COMPLETED",
      });
      expect(completed.ok).toBe(true);
      if (completed.ok) {
        expect(completed.data.task.status).toBe("COMPLETED");
        expect(completed.data.task.completedAt).toBeTruthy();
      }

      const reopened = await setTaskStatusAction({
        taskId: created.data.task.id,
        status: "TODO",
      });
      expect(reopened.ok).toBe(true);
      if (reopened.ok) {
        expect(reopened.data.task.completedAt).toBeNull();
      }

      const cancelled = await setTaskStatusAction({
        taskId: created.data.task.id,
        status: "CANCELLED",
      });
      expect(cancelled.ok).toBe(true);

      const deleted = await deleteTaskAction({
        taskId: created.data.task.id,
      });
      expect(deleted.ok).toBe(true);

      const after = await loadTasksWorkspaceAction();
      expect(after.ok).toBe(true);
      if (after.ok) expect(after.data.tasks).toHaveLength(0);
    });

    it("rejects foreign class attachment and client completedAt", async () => {
      const owner = await createUser(`tsk-own-${Date.now()}`);
      const other = await createUser(`tsk-oth-${Date.now()}`);
      authState.userId = other.id;
      const foreignClass = await createClassAction({
        name: "Other Class",
        term: "Fall 2026",
      });
      expect(foreignClass.ok).toBe(true);
      if (!foreignClass.ok) return;

      authState.userId = owner.id;
      const badAttach = await createTaskAction({
        title: "Steal class",
        classId: foreignClass.data.class.id,
      });
      expect(badAttach.ok).toBe(false);
      if (!badAttach.ok) expect(badAttach.message).toMatch(/not found/i);

      const withCompletedAt = await createTaskAction({
        title: "Forge completion",
        completedAt: "2026-01-01T00:00:00.000Z",
      });
      expect(withCompletedAt.ok).toBe(false);
      if (!withCompletedAt.ok) {
        expect(withCompletedAt.message).toMatch(/cannot supply completedAt/i);
      }
    });

    it("blocks cross-user task mutation (IDOR)", async () => {
      const owner = await createUser(`tsk-idor-o-${Date.now()}`);
      const attacker = await createUser(`tsk-idor-a-${Date.now()}`);
      authState.userId = owner.id;
      const created = await createTaskAction({ title: "Private task" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      authState.userId = attacker.id;
      const got = await getTaskAction({ taskId: created.data.task.id });
      expect(got.ok).toBe(false);

      const updated = await updateTaskAction({
        taskId: created.data.task.id,
        input: { title: "Hacked" },
      });
      expect(updated.ok).toBe(false);

      const status = await setTaskStatusAction({
        taskId: created.data.task.id,
        status: "COMPLETED",
      });
      expect(status.ok).toBe(false);

      const deleted = await deleteTaskAction({
        taskId: created.data.task.id,
      });
      expect(deleted.ok).toBe(false);

      authState.userId = owner.id;
      const still = await getTaskAction({ taskId: created.data.task.id });
      expect(still.ok).toBe(true);
      if (still.ok) expect(still.data.task.title).toBe("Private task");
    });

    it("requires authentication for actions", async () => {
      authState.userId = null;
      const result = await loadTasksWorkspaceAction();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/sign in/i);
    });

    it("preserves tasks when class is deleted via UI action", async () => {
      const user = await createUser(`tsk-detach-${Date.now()}`);
      authState.userId = user.id;
      const klass = await createClassAction({
        name: "Chem",
        term: "Fall 2026",
      });
      expect(klass.ok).toBe(true);
      if (!klass.ok) return;
      const task = await createTaskAction({
        title: "Lab report",
        classId: klass.data.class.id,
      });
      expect(task.ok).toBe(true);
      if (!task.ok) return;

      const deleted = await deleteClassAction({
        classId: klass.data.class.id,
      });
      expect(deleted.ok).toBe(true);
      if (deleted.ok) expect(deleted.data.tasksDetached).toBe(1);

      const listed = await loadTasksWorkspaceAction();
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.data.tasks).toHaveLength(1);
        expect(listed.data.tasks[0]?.classId).toBeNull();
        expect(listed.data.tasks[0]?.title).toBe("Lab report");
      }
    });
  });
});
