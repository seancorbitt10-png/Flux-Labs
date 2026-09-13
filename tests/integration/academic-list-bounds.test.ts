import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ValidationError } from "@/lib/errors";
import {
  createClass,
  createTask,
  listClasses,
  listTasks,
  MAX_LIST_CLASSES,
  MAX_LIST_TASKS,
  DEFAULT_LIST_CLASSES,
  DEFAULT_LIST_TASKS,
} from "@/lib/academic";
import {
  ACADEMIC_WORKSPACE_BUDGETS,
  AI_CLASS_QUERY_LIMIT,
  AI_TASK_QUERY_LIMIT,
  assembleAcademicWorkspaceContext,
} from "@/lib/ai/academic-workspace-context";
import { getStudyBootstrap } from "@/lib/study/bootstrap";

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
    await prisma.usageRecord.deleteMany({ where: { userId: { in: ids } } });
    await prisma.aIInteraction.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.trial.deleteMany({ where: { userId: { in: ids } } });
    await prisma.entitlement.deleteMany({ where: { userId: { in: ids } } });
    await prisma.studentProfile.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

async function createEntitledUser(suffix: string) {
  const endsAt = new Date(Date.now() + 7 * 86_400_000);
  return prisma.user.create({
    data: {
      email: `bounds.${suffix}@fluxlabs.test`,
      name: "Bounds Student",
      passwordHash: "x",
      studentProfile: {
        create: {
          displayName: "Bounds Student",
          academicLevel: "undergrad",
        },
      },
      entitlements: {
        create: {
          plan: "FREE_TRIAL",
          status: "ACTIVE",
          endsAt,
        },
      },
      trials: {
        create: {
          endsAt,
          aiSessionsUsed: 0,
          documentAnalysesUsed: 0,
          advancedTutoringUsed: 0,
          estimatedCostMicros: 0,
        },
      },
    },
  });
}

describe("Slice 6 — bounded Class/Task retrieval", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanup();
  });

  describe("domain list limits", () => {
    it("clamps class list to the requested limit at the query layer", async () => {
      const user = await createEntitledUser(`cls-${Date.now()}`);
      for (let i = 0; i < 12; i += 1) {
        await createClass({
          actorUserId: user.id,
          userId: user.id,
          input: {
            name: `Class ${String(i).padStart(2, "0")}`,
            term: "Fall 2026",
          },
        });
      }

      const limited = await listClasses({
        actorUserId: user.id,
        userId: user.id,
        status: "ACTIVE",
        limit: 5,
      });
      expect(limited).toHaveLength(5);

      const capped = await listClasses({
        actorUserId: user.id,
        userId: user.id,
        status: "ACTIVE",
        limit: MAX_LIST_CLASSES + 500,
      });
      expect(capped.length).toBeLessThanOrEqual(MAX_LIST_CLASSES);
      expect(capped.length).toBe(12);
    });

    it("clamps task list to the requested limit at the query layer", async () => {
      const user = await createEntitledUser(`tsk-${Date.now()}`);
      for (let i = 0; i < 15; i += 1) {
        await createTask({
          actorUserId: user.id,
          userId: user.id,
          input: {
            title: `Task ${String(i).padStart(2, "0")}`,
            status: "TODO",
            dueAt: new Date(Date.now() + i * 86_400_000).toISOString(),
          },
        });
      }

      const limited = await listTasks({
        actorUserId: user.id,
        userId: user.id,
        limit: 7,
      });
      expect(limited).toHaveLength(7);

      const capped = await listTasks({
        actorUserId: user.id,
        userId: user.id,
        limit: MAX_LIST_TASKS + 1000,
      });
      expect(capped.length).toBeLessThanOrEqual(MAX_LIST_TASKS);
      expect(capped.length).toBe(15);
    });

    it("defaults to server page sizes when limit is omitted (never unbounded)", async () => {
      expect(DEFAULT_LIST_CLASSES).toBeGreaterThan(0);
      expect(DEFAULT_LIST_TASKS).toBeGreaterThan(0);
      expect(DEFAULT_LIST_CLASSES).toBeLessThanOrEqual(MAX_LIST_CLASSES);
      expect(DEFAULT_LIST_TASKS).toBeLessThanOrEqual(MAX_LIST_TASKS);
    });

    it("rejects non-positive limits", async () => {
      const user = await createEntitledUser(`badlim-${Date.now()}`);
      await expect(
        listClasses({
          actorUserId: user.id,
          userId: user.id,
          limit: 0,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        listTasks({
          actorUserId: user.id,
          userId: user.id,
          limit: -3,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("does not leak another user's classes or tasks", async () => {
      const alice = await createEntitledUser(`idor-a-${Date.now()}`);
      const bob = await createEntitledUser(`idor-b-${Date.now()}`);
      await createClass({
        actorUserId: bob.id,
        userId: bob.id,
        input: { name: "Bob Only", term: "Fall 2026" },
      });
      await createTask({
        actorUserId: bob.id,
        userId: bob.id,
        input: { title: "Bob Task", status: "TODO" },
      });

      const classes = await listClasses({
        actorUserId: alice.id,
        userId: alice.id,
        limit: 50,
      });
      const tasks = await listTasks({
        actorUserId: alice.id,
        userId: alice.id,
        limit: 50,
      });
      expect(classes).toEqual([]);
      expect(tasks).toEqual([]);
    });
  });

  describe("AI academicWorkspace assembly", () => {
    it("keeps class/task result sets within workspace budgets", async () => {
      const user = await createEntitledUser(`ai-budget-${Date.now()}`);
      const classCount = ACADEMIC_WORKSPACE_BUDGETS.maxClasses + 6;
      const taskCount = AI_TASK_QUERY_LIMIT + 8;

      for (let i = 0; i < classCount; i += 1) {
        await createClass({
          actorUserId: user.id,
          userId: user.id,
          input: {
            name: `Budget Class ${String(i).padStart(2, "0")}`,
            term: "Fall 2026",
          },
        });
      }
      for (let i = 0; i < taskCount; i += 1) {
        await createTask({
          actorUserId: user.id,
          userId: user.id,
          input: {
            title: `Budget Task ${String(i).padStart(2, "0")}`,
            status: "TODO",
            dueAt: new Date(Date.now() + i * 3_600_000).toISOString(),
          },
        });
      }

      const ctx = await assembleAcademicWorkspaceContext({
        actorUserId: user.id,
        userId: user.id,
      });

      expect(ctx.classes.length).toBeLessThanOrEqual(
        ACADEMIC_WORKSPACE_BUDGETS.maxClasses,
      );
      expect(ctx.tasks.length).toBeLessThanOrEqual(
        ACADEMIC_WORKSPACE_BUDGETS.maxTasks,
      );
      expect(AI_CLASS_QUERY_LIMIT).toBe(ACADEMIC_WORKSPACE_BUDGETS.maxClasses);
      expect(AI_TASK_QUERY_LIMIT).toBe(
        ACADEMIC_WORKSPACE_BUDGETS.maxTasks * 3,
      );
    });

    it("preserves focused class even when it would fall outside the ambient query page", async () => {
      const user = await createEntitledUser(`focus-cls-${Date.now()}`);
      // Names sort ascending within the same term; Zzz is last.
      for (let i = 0; i < ACADEMIC_WORKSPACE_BUDGETS.maxClasses + 4; i += 1) {
        await createClass({
          actorUserId: user.id,
          userId: user.id,
          input: {
            name: `AAA Class ${String(i).padStart(2, "0")}`,
            term: "Fall 2026",
          },
        });
      }
      const focus = await createClass({
        actorUserId: user.id,
        userId: user.id,
        input: {
          name: "Zzz Focus Seminar",
          term: "Fall 2026",
        },
      });

      const ctx = await assembleAcademicWorkspaceContext({
        actorUserId: user.id,
        userId: user.id,
        classId: focus.id,
      });

      expect(ctx.focus.classId).toBe(focus.id);
      expect(ctx.classes.some((c) => c.id === focus.id)).toBe(true);
      expect(ctx.classes.length).toBeLessThanOrEqual(
        ACADEMIC_WORKSPACE_BUDGETS.maxClasses,
      );
    });

    it("preserves focused task even when many earlier-due open tasks exist", async () => {
      const user = await createEntitledUser(`focus-tsk-${Date.now()}`);
      for (let i = 0; i < AI_TASK_QUERY_LIMIT + 5; i += 1) {
        await createTask({
          actorUserId: user.id,
          userId: user.id,
          input: {
            title: `Early Task ${String(i).padStart(2, "0")}`,
            status: "TODO",
            dueAt: new Date(Date.now() + i * 60_000).toISOString(),
          },
        });
      }
      const focus = await createTask({
        actorUserId: user.id,
        userId: user.id,
        input: {
          title: "Far Future Focus Task",
          status: "TODO",
          dueAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
        },
      });

      const ctx = await assembleAcademicWorkspaceContext({
        actorUserId: user.id,
        userId: user.id,
        taskId: focus.id,
      });

      expect(ctx.focus.taskId).toBe(focus.id);
      expect(ctx.tasks.some((t) => t.id === focus.id)).toBe(true);
      expect(ctx.tasks.length).toBeLessThanOrEqual(
        ACADEMIC_WORKSPACE_BUDGETS.maxTasks,
      );
    });

    it("rejects cross-user focus IDs (IDOR)", async () => {
      const alice = await createEntitledUser(`ai-idor-a-${Date.now()}`);
      const bob = await createEntitledUser(`ai-idor-b-${Date.now()}`);
      const bobClass = await createClass({
        actorUserId: bob.id,
        userId: bob.id,
        input: { name: "Secret", term: "Fall 2026" },
      });
      const bobTask = await createTask({
        actorUserId: bob.id,
        userId: bob.id,
        input: { title: "Secret Task", status: "TODO" },
      });

      await expect(
        assembleAcademicWorkspaceContext({
          actorUserId: alice.id,
          userId: alice.id,
          classId: bobClass.id,
        }),
      ).rejects.toThrow(/not found|Class/i);

      await expect(
        assembleAcademicWorkspaceContext({
          actorUserId: alice.id,
          userId: alice.id,
          taskId: bobTask.id,
        }),
      ).rejects.toThrow(/not found|Task/i);
    });
  });

  describe("Study bootstrap regression", () => {
    it("returns bounded owned class/task options", async () => {
      const user = await createEntitledUser(`study-boot-${Date.now()}`);
      const klass = await createClass({
        actorUserId: user.id,
        userId: user.id,
        input: { name: "Biology", term: "Fall 2026" },
      });
      const task = await createTask({
        actorUserId: user.id,
        userId: user.id,
        input: {
          title: "Lab write-up",
          classId: klass.id,
          status: "TODO",
        },
      });

      const boot = await getStudyBootstrap({
        actorUserId: user.id,
        userId: user.id,
      });
      expect(boot.classOptions.some((c) => c.classId === klass.id)).toBe(true);
      expect(boot.taskOptions.some((t) => t.taskId === task.id)).toBe(true);
      expect(boot.classOptions.length).toBeLessThanOrEqual(24);
      expect(boot.taskOptions.length).toBeLessThanOrEqual(40);
    });
  });
});
