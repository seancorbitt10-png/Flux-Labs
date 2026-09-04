import type { StudentProfile } from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/errors";

export async function getStudentProfile(args: {
  actorUserId: string;
  userId: string;
}): Promise<StudentProfile | null> {
  assertResourceOwner(args.userId, args.actorUserId);
  return prisma.studentProfile.findUnique({ where: { userId: args.userId } });
}

export async function ensureStudentProfile(args: {
  actorUserId: string;
  userId: string;
}): Promise<StudentProfile> {
  assertResourceOwner(args.userId, args.actorUserId);
  const existing = await prisma.studentProfile.findUnique({
    where: { userId: args.userId },
  });
  if (existing) return existing;
  return prisma.studentProfile.create({
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

export async function updateStudentProfile(args: {
  actorUserId: string;
  userId: string;
  data: UpdateProfileFields;
}): Promise<StudentProfile> {
  assertResourceOwner(args.userId, args.actorUserId);

  if (args.data.displayName && args.data.displayName.length > 80) {
    throw new ValidationError("Display name is too long.");
  }
  if (args.data.goalsSummary && args.data.goalsSummary.length > 2000) {
    throw new ValidationError("Goals summary is too long.");
  }

  await ensureStudentProfile(args);

  return prisma.studentProfile.update({
    where: { userId: args.userId },
    data: args.data,
  });
}
