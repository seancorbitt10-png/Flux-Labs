import type { Prisma, StudentProfile } from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";

export type StudentProfileWriteOptions = {
  /** Optional shared Prisma transaction for callers that need atomic multi-writes. */
  db?: Prisma.TransactionClient;
};

export async function getStudentProfile(args: {
  actorUserId: string;
  userId: string;
}): Promise<StudentProfile | null> {
  assertResourceOwner(args.userId, args.actorUserId);
  return prisma.studentProfile.findUnique({ where: { userId: args.userId } });
}

export async function ensureStudentProfile(
  args: {
    actorUserId: string;
    userId: string;
  },
  options?: StudentProfileWriteOptions,
): Promise<StudentProfile> {
  assertResourceOwner(args.userId, args.actorUserId);
  const db = options?.db ?? prisma;
  const existing = await db.studentProfile.findUnique({
    where: { userId: args.userId },
  });
  if (existing) return existing;
  return db.studentProfile.create({
    data: { userId: args.userId },
  });
}

export type UpdateProfileFields = {
  displayName?: string | null;
  academicLevel?: string | null;
  timezone?: string | null;
  preferredAssistanceStyle?: string | null;
  goalsSummary?: string | null;
  onboardingCompletedAt?: Date | null;
  onboardingVersion?: string | null;
  onboardingSkippedAt?: Date | null;
};

export async function updateStudentProfile(
  args: {
    actorUserId: string;
    userId: string;
    data: UpdateProfileFields;
  },
  options?: StudentProfileWriteOptions,
): Promise<StudentProfile> {
  assertResourceOwner(args.userId, args.actorUserId);

  if (args.data.displayName && args.data.displayName.length > 80) {
    throw new ValidationError("Display name is too long.");
  }
  if (args.data.goalsSummary && args.data.goalsSummary.length > 2000) {
    throw new ValidationError("Goals summary is too long.");
  }

  const db = options?.db ?? prisma;
  await ensureStudentProfile(args, options);

  return db.studentProfile.update({
    where: { userId: args.userId },
    data: args.data,
  });
}
