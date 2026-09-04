import type { Prisma, ProvenanceKind, StudentAttribute } from "@prisma/client";
import { assertResourceOwner } from "@/lib/auth/ownership";
import { prisma } from "@/lib/db/prisma";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import {
  clampConfidence,
  defaultConfidenceFor,
  mayOverwriteCurrentState,
} from "@/lib/provenance/policy";
import {
  assertRegisteredAttributeKey,
  assertWriterAllowed,
  rejectClientAuthorityFields,
  validateAttributeValue,
  type AttributeWriter,
} from "./attribute-registry";

export type SetAttributeInput = {
  /** Authenticated actor — ownership is derived from this, never from client userId. */
  actorUserId: string;
  /** Target student; must equal actorUserId in Phase 2 (owner-only). */
  userId: string;
  key: string;
  value: unknown;
  writer: AttributeWriter;
  /**
   * Optional provenance override for system writers only.
   * Onboarding/settings always write EXPLICIT from the registry.
   */
  systemProvenance?: ProvenanceKind;
};

export type SetAttributeResult =
  | { status: "written"; attribute: StudentAttribute; supersededId: string | null }
  | { status: "rejected_weaker_provenance"; attribute: StudentAttribute };

function resolveProvenance(
  writer: AttributeWriter,
  registryDefault: ProvenanceKind,
  systemProvenance?: ProvenanceKind,
): ProvenanceKind {
  if (writer === "onboarding" || writer === "settings") {
    return "EXPLICIT";
  }
  if (systemProvenance) {
    return systemProvenance;
  }
  return registryDefault;
}

function resolveSource(writer: AttributeWriter): string {
  switch (writer) {
    case "onboarding":
      return "onboarding";
    case "settings":
      return "settings";
    case "system":
      return "system";
  }
}

/**
 * Atomically set/replace the active StudentAttribute for (userId, key).
 * Enforces registry, ownership, provenance precedence, and partial-unique safety.
 */
export async function setStudentAttribute(
  input: SetAttributeInput,
): Promise<SetAttributeResult> {
  assertResourceOwner(input.userId, input.actorUserId);

  // Defense: reject any client bag that smuggles authority fields via value object misuse
  if (
    input.value !== null &&
    typeof input.value === "object" &&
    !Array.isArray(input.value)
  ) {
    rejectClientAuthorityFields(input.value as Record<string, unknown>);
  }

  const entry = assertRegisteredAttributeKey(input.key);
  assertWriterAllowed(entry, input.writer);
  const valueJson = validateAttributeValue(entry, input.value) as Prisma.InputJsonValue;

  const provenance = resolveProvenance(
    input.writer,
    entry.defaultProvenance,
    input.systemProvenance,
  );
  if (input.writer !== "system" && input.systemProvenance) {
    throw new ValidationError("Only system writers may override provenance.");
  }

  const confidence = clampConfidence(defaultConfidenceFor(provenance));
  const source = resolveSource(input.writer);

  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Lock any active row for this (userId, key) to serialize concurrent supersedes.
        await tx.$queryRaw`
          SELECT id FROM student_attributes
          WHERE "userId" = ${input.userId}
            AND key = ${input.key}
            AND "supersededAt" IS NULL
          FOR UPDATE
        `;

        const existing = await tx.studentAttribute.findFirst({
          where: {
            userId: input.userId,
            key: input.key,
            supersededAt: null,
          },
        });

        if (existing) {
          const allowed = mayOverwriteCurrentState({
            existingProvenance: existing.provenance,
            existingConfidence: existing.confidence,
            incomingProvenance: provenance,
          });
          if (!allowed) {
            return {
              status: "rejected_weaker_provenance" as const,
              attribute: existing,
            };
          }

          // Supersede first so the partial unique index allows the new active row.
          await tx.studentAttribute.update({
            where: { id: existing.id },
            data: { supersededAt: new Date() },
          });
        }

        const created = await tx.studentAttribute.create({
          data: {
            userId: input.userId,
            key: input.key,
            valueJson,
            provenance,
            confidence,
            source,
            supersededAt: null,
          },
        });

        if (existing) {
          await tx.studentAttribute.update({
            where: { id: existing.id },
            data: { supersededById: created.id },
          });
        }

        return {
          status: "written" as const,
          attribute: created,
          supersededId: existing?.id ?? null,
        };
      });
    } catch (error) {
      lastError = error;
      // Unique violation from concurrent create — retry.
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ValidationError("Could not update attribute under concurrent writes.");
}

export async function getActiveAttribute(args: {
  actorUserId: string;
  userId: string;
  key: string;
}): Promise<StudentAttribute | null> {
  assertResourceOwner(args.userId, args.actorUserId);
  assertRegisteredAttributeKey(args.key);

  return prisma.studentAttribute.findFirst({
    where: {
      userId: args.userId,
      key: args.key,
      supersededAt: null,
    },
  });
}

export async function listActiveAttributes(args: {
  actorUserId: string;
  userId: string;
}): Promise<StudentAttribute[]> {
  assertResourceOwner(args.userId, args.actorUserId);

  return prisma.studentAttribute.findMany({
    where: {
      userId: args.userId,
      supersededAt: null,
    },
    orderBy: { key: "asc" },
  });
}

export async function getAttributeHistory(args: {
  actorUserId: string;
  userId: string;
  key: string;
}): Promise<StudentAttribute[]> {
  assertResourceOwner(args.userId, args.actorUserId);
  assertRegisteredAttributeKey(args.key);

  return prisma.studentAttribute.findMany({
    where: {
      userId: args.userId,
      key: args.key,
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Reject attempts to create attributes via arbitrary Prisma-like client payloads.
 * Domain API only — no public "insert attribute row" path.
 */
export function assertNoDirectAttributeClientWrite(
  payload: Record<string, unknown>,
): never {
  rejectClientAuthorityFields(payload);
  throw new ForbiddenError("Direct StudentAttribute writes are not allowed.");
}
