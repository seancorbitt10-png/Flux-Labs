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
  loadCalendarWorkspaceAction,
  navigateCalendarAction,
} from "@/lib/academic/actions";
import { getCalendarWorkspaceBootstrap } from "@/lib/academic/workspace";
import { createClass } from "@/lib/academic/classes";
import { createTask } from "@/lib/academic/tasks";

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
      email: `cal-ui.${suffix}@fluxlabs.test`,
      name: "Calendar UI",
      passwordHash: "x",
      studentProfile: {
        create: {
          displayName: "Calendar UI",
          timezone: "UTC",
        },
      },
    },
  });
}

describe("Phase 3 Calendar UI integration", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    authState.userId = null;
    await cleanup();
  });

  it("returns empty days for a week with no dated records", async () => {
    const user = await createUser(`empty-${Date.now()}`);
    const boot = await getCalendarWorkspaceBootstrap({
      actorUserId: user.id,
      userId: user.id,
      anchorDate: "2030-01-06",
    });
    expect(boot.days).toEqual([]);
    expect(boot.items).toEqual([]);
    expect(boot.anchorDate).toBe("2030-01-06");
    expect(boot.timezone).toBe("UTC");
  });

  it("loads mixed task and class_period items ordered into day groups", async () => {
    const user = await createUser(`mix-${Date.now()}`);
    await createClass({
      actorUserId: user.id,
      userId: user.id,
      input: {
        name: "Biology",
        term: "Fall 2030",
        courseCode: "BIO-101",
        startsAt: "2030-02-03T15:00:00.000Z",
        endsAt: "2030-02-03T16:00:00.000Z",
      },
    });
    await createTask({
      actorUserId: user.id,
      userId: user.id,
      input: {
        title: "Problem set",
        dueAt: "2030-02-05T18:00:00.000Z",
        priority: 2,
        status: "TODO",
      },
    });
    await createTask({
      actorUserId: user.id,
      userId: user.id,
      input: {
        title: "Done essay",
        dueAt: "2030-02-04T12:00:00.000Z",
        status: "TODO",
      },
    });
    const listed = await prisma.task.findFirst({
      where: { userId: user.id, title: "Done essay" },
    });
    expect(listed).toBeTruthy();
    await prisma.task.update({
      where: { id: listed!.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    authState.userId = user.id;
    const result = await loadCalendarWorkspaceAction({
      anchorDate: "2030-02-03",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.items.length).toBeGreaterThanOrEqual(3);
    const kinds = result.data.items.map((i) => i.kind);
    expect(kinds).toContain("task");
    expect(kinds).toContain("class_period");

    const dayKeys = result.data.days.map((d) => d.dateKey);
    expect(dayKeys).toContain("2030-02-03");
    expect(dayKeys).toContain("2030-02-05");

    const completed = result.data.items.find(
      (i) => i.kind === "task" && i.title === "Done essay",
    );
    expect(completed && completed.kind === "task" && completed.status).toBe(
      "COMPLETED",
    );
  });

  it("navigates prev/next/today and keeps ownership scope", async () => {
    const owner = await createUser(`own-${Date.now()}`);
    const other = await createUser(`oth-${Date.now()}`);
    await createTask({
      actorUserId: other.id,
      userId: other.id,
      input: {
        title: "Secret",
        dueAt: "2030-03-10T12:00:00.000Z",
      },
    });
    await createTask({
      actorUserId: owner.id,
      userId: owner.id,
      input: {
        title: "Mine",
        dueAt: "2030-03-10T12:00:00.000Z",
      },
    });

    authState.userId = owner.id;
    const start = await loadCalendarWorkspaceAction({
      anchorDate: "2030-03-10",
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.data.items.every((i) => i.kind !== "task" || i.title !== "Secret")).toBe(
      true,
    );
    expect(start.data.items.some((i) => i.kind === "task" && i.title === "Mine")).toBe(
      true,
    );

    const next = await navigateCalendarAction({
      direction: "next",
      anchorDate: start.data.anchorDate,
    });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.data.anchorDate).toBe("2030-03-17");

    const prev = await navigateCalendarAction({
      direction: "prev",
      anchorDate: next.ok ? next.data.anchorDate : "2030-03-17",
    });
    expect(prev.ok).toBe(true);
    if (prev.ok) expect(prev.data.anchorDate).toBe("2030-03-10");

    const today = await navigateCalendarAction({ direction: "today" });
    expect(today.ok).toBe(true);
  });

  it("filters by class and rejects foreign classId", async () => {
    const user = await createUser(`filt-${Date.now()}`);
    const other = await createUser(`filt-o-${Date.now()}`);
    const klass = await createClass({
      actorUserId: user.id,
      userId: user.id,
      input: {
        name: "Physics",
        term: "Fall 2030",
        startsAt: "2030-04-01T10:00:00.000Z",
        endsAt: "2030-04-01T11:00:00.000Z",
      },
    });
    const foreign = await createClass({
      actorUserId: other.id,
      userId: other.id,
      input: {
        name: "Foreign",
        term: "Fall 2030",
        startsAt: "2030-04-01T10:00:00.000Z",
        endsAt: "2030-04-01T11:00:00.000Z",
      },
    });
    await createTask({
      actorUserId: user.id,
      userId: user.id,
      input: {
        title: "Linked",
        classId: klass.id,
        dueAt: "2030-04-02T12:00:00.000Z",
      },
    });
    await createTask({
      actorUserId: user.id,
      userId: user.id,
      input: {
        title: "Unlinked",
        dueAt: "2030-04-02T13:00:00.000Z",
      },
    });

    authState.userId = user.id;
    const filtered = await loadCalendarWorkspaceAction({
      anchorDate: "2030-04-01",
      classId: klass.id,
    });
    expect(filtered.ok).toBe(true);
    if (!filtered.ok) return;
    expect(
      filtered.data.items.every(
        (i) =>
          (i.kind === "task" && i.classId === klass.id) ||
          (i.kind === "class_period" && i.id === klass.id),
      ),
    ).toBe(true);
    expect(
      filtered.data.items.some((i) => i.kind === "task" && i.title === "Unlinked"),
    ).toBe(false);

    const bad = await loadCalendarWorkspaceAction({
      anchorDate: "2030-04-01",
      classId: foreign.id,
    });
    expect(bad.ok).toBe(false);
  });

  it("status filter returns only matching tasks (no class periods)", async () => {
    const user = await createUser(`status-${Date.now()}`);
    await createClass({
      actorUserId: user.id,
      userId: user.id,
      input: {
        name: "Chem",
        term: "Fall 2030",
        startsAt: "2030-05-01T10:00:00.000Z",
        endsAt: "2030-05-01T11:00:00.000Z",
      },
    });
    await createTask({
      actorUserId: user.id,
      userId: user.id,
      input: {
        title: "Active work",
        dueAt: "2030-05-02T12:00:00.000Z",
        status: "TODO",
      },
    });
    authState.userId = user.id;
    const result = await loadCalendarWorkspaceAction({
      anchorDate: "2030-05-01",
      status: "TODO",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items.every((i) => i.kind === "task")).toBe(true);
    expect(result.data.items.every((i) => i.kind === "task" && i.status === "TODO")).toBe(
      true,
    );
  });

  it("requires authentication", async () => {
    authState.userId = null;
    const result = await loadCalendarWorkspaceAction({
      anchorDate: "2030-01-01",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/sign in/i);
  });

  it("rejects actor/user mismatch on bootstrap", async () => {
    const a = await createUser(`a-${Date.now()}`);
    const b = await createUser(`b-${Date.now()}`);
    await expect(
      getCalendarWorkspaceBootstrap({
        actorUserId: a.id,
        userId: b.id,
        anchorDate: "2030-01-01",
      }),
    ).rejects.toThrow(/Forbidden|access/i);
  });
});
