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
  systemProvenance?: ProvenanceKind,
): ProvenanceKind {
  // Student-authoritative flows only — EXPLICIT is never minted by system.
  if (writer === "onboarding" || writer === "settings") {
    return "EXPLICIT";
  }

  if (writer !== "system") {
    throw new ValidationError("Unknown attribute writer.");
  }

  if (!systemProvenance) {
    throw new ValidationError(
      "System attribute writes require a non-EXPLICIT provenance.",
    );
  }

  if (systemProvenance === "EXPLICIT") {
    throw new ValidationError(
      "System writers cannot mint EXPLICIT provenance.",
    );
  }

  return systemProvenance;
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

export type StudentWriteOptions = {
  /**
   * Optional shared Prisma transaction. When provided, this write joins the
   * caller's transaction instead of opening a nested `$transaction`.
   */
  db?: Prisma.TransactionClient;
};

async function writeStudentAttributeInTx(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    key: string;
    valueJson: Prisma.InputJsonValue;
    provenance: ProvenanceKind;
    confidence: number;
    source: string;
  },
): Promise<SetAttributeResult> {
  // Lock any active row for this (userId, key) to serialize concurrent supersedes.
  await tx.$queryRaw`
    SELECT id FROM student_attributes
    WHERE "userId" = ${args.userId}
      AND key = ${args.key}
      AND "supersededAt" IS NULL
    FOR UPDATE
  `;

  const existing = await tx.studentAttribute.findFirst({
    where: {
      userId: args.userId,
      key: args.key,
      supersededAt: null,
    },
  });

  if (existing) {
    const allowed = mayOverwriteCurrentState({
      existingProvenance: existing.provenance,
      existingConfidence: existing.confidence,
      incomingProvenance: args.provenance,
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
      userId: args.userId,
      key: args.key,
      valueJson: args.valueJson,
      provenance: args.provenance,
      confidence: args.confidence,
      source: args.source,
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
}

/**
 * Atomically set/replace the active StudentAttribute for (userId, key).
 * Enforces registry, ownership, provenance precedence, and partial-unique safety.
 */
export async function setStudentAttribute(
  input: SetAttributeInput,
  options?: StudentWriteOptions,
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

  if (input.writer !== "system" && input.systemProvenance !== undefined) {
    throw new ValidationError("Only system writers may supply systemProvenance.");
  }

  const valueJson = validateAttributeValue(entry, input.value) as Prisma.InputJsonValue;
  const provenance = resolveProvenance(input.writer, input.systemProvenance);
  const confidence = clampConfidence(defaultConfidenceFor(provenance));
  const source = resolveSource(input.writer);
  const writeArgs = {
    userId: input.userId,
    key: input.key,
    valueJson,
    provenance,
    confidence,
    source,
  };

  // Join an outer transaction when provided (e.g. onboarding answer + SM mapping).
  // Do not open a nested interactive transaction — Postgres aborts the outer tx on error.
  if (options?.db) {
    return writeStudentAttributeInTx(options.db, writeArgs);
  }

  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(async (tx) =>
        writeStudentAttributeInTx(tx, writeArgs),
      );
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
