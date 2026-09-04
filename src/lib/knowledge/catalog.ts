import type {
  Concept,
  ConceptRelation,
  ConceptRelationType,
  Subject,
  Topic,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ForbiddenError, UnauthorizedError, ValidationError } from "@/lib/errors";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME_MAX = 120;
const DESC_MAX = 2000;

/**
 * Catalog write actor — never client-invented identity.
 * - system: trusted server seed / admin path for shared catalog
 * - user: authenticated student (USER concepts only)
 */
export type CatalogWriteActor =
  | { type: "system" }
  | { type: "user"; userId: string };

function assertSlug(slug: string, label: string): void {
  if (!slug || !SLUG_RE.test(slug) || slug.length > 80) {
    throw new ValidationError(`Invalid ${label} slug.`);
  }
}

function assertSystemActor(actor: CatalogWriteActor): void {
  if (actor.type !== "system") {
    throw new ForbiddenError(
      "Only system actors may mutate the shared knowledge catalog.",
    );
  }
}

function assertAuthenticatedUserActor(
  actor: CatalogWriteActor | null | undefined,
): asserts actor is { type: "user"; userId: string } {
  if (!actor || actor.type !== "user" || !actor.userId) {
    throw new UnauthorizedError("Authentication required to create USER concepts.");
  }
}

export async function createSubject(input: {
  actor: CatalogWriteActor;
  slug: string;
  name: string;
  description?: string | null;
}): Promise<Subject> {
  assertSystemActor(input.actor);
  assertSlug(input.slug, "subject");
  const name = input.name?.trim();
  if (!name || name.length > NAME_MAX) {
    throw new ValidationError("Invalid subject name.");
  }
  if (input.description && input.description.length > DESC_MAX) {
    throw new ValidationError("Subject description is too long.");
  }

  return prisma.subject.create({
    data: {
      slug: input.slug,
      name,
      description: input.description?.trim() || null,
    },
  });
}

export async function createTopic(input: {
  actor: CatalogWriteActor;
  subjectId: string;
  slug: string;
  name: string;
  description?: string | null;
}): Promise<Topic> {
  assertSystemActor(input.actor);
  assertSlug(input.slug, "topic");
  const subject = await prisma.subject.findUnique({
    where: { id: input.subjectId },
  });
  if (!subject) {
    throw new ValidationError("Subject not found.");
  }
  const name = input.name?.trim();
  if (!name || name.length > NAME_MAX) {
    throw new ValidationError("Invalid topic name.");
  }

  return prisma.topic.create({
    data: {
      subjectId: input.subjectId,
      slug: input.slug,
      name,
      description: input.description?.trim() || null,
    },
  });
}

/**
 * Create a SYSTEM catalog concept. Requires system actor.
 * createdByUserId is always null — never caller-supplied.
 */
export async function createSystemConcept(input: {
  actor: CatalogWriteActor;
  topicId: string;
  slug: string;
  name: string;
  description?: string | null;
}): Promise<Concept> {
  assertSystemActor(input.actor);
  assertSlug(input.slug, "concept");
  const topic = await prisma.topic.findUnique({ where: { id: input.topicId } });
  if (!topic) {
    throw new ValidationError("Topic not found.");
  }
  const name = input.name?.trim();
  if (!name || name.length > NAME_MAX) {
    throw new ValidationError("Invalid concept name.");
  }

  return prisma.concept.create({
    data: {
      topicId: input.topicId,
      slug: input.slug,
      name,
      description: input.description?.trim() || null,
      source: "SYSTEM",
      createdByUserId: null,
    },
  });
}

/**
 * Create a USER-owned concept. Attribution is always the authenticated actor.
 * Caller-supplied createdByUserId is rejected if present on the input bag.
 */
export async function createUserConcept(input: {
  actor: CatalogWriteActor;
  topicId: string;
  slug: string;
  name: string;
  description?: string | null;
}): Promise<Concept> {
  assertAuthenticatedUserActor(input.actor);

  const bag = input as Record<string, unknown>;
  if ("createdByUserId" in bag) {
    throw new ValidationError(
      "createdByUserId cannot be supplied by the caller; ownership is derived from the authenticated actor.",
    );
  }

  assertSlug(input.slug, "concept");
  const topic = await prisma.topic.findUnique({ where: { id: input.topicId } });
  if (!topic) {
    throw new ValidationError("Topic not found.");
  }
  const name = input.name?.trim();
  if (!name || name.length > NAME_MAX) {
    throw new ValidationError("Invalid concept name.");
  }

  return prisma.concept.create({
    data: {
      topicId: input.topicId,
      slug: input.slug,
      name,
      description: input.description?.trim() || null,
      source: "USER",
      createdByUserId: input.actor.userId,
    },
  });
}

/**
 * @deprecated Prefer createSystemConcept / createUserConcept.
 * Kept as a thin router that enforces actor + source pairing.
 */
export async function createConcept(input: {
  actor: CatalogWriteActor;
  topicId: string;
  slug: string;
  name: string;
  description?: string | null;
  source?: "SYSTEM" | "USER";
}): Promise<Concept> {
  const source = input.source ?? "SYSTEM";
  if (source === "SYSTEM") {
    return createSystemConcept(input);
  }
  return createUserConcept(input);
}

export async function createConceptRelation(input: {
  actor: CatalogWriteActor;
  fromConceptId: string;
  toConceptId: string;
  type: ConceptRelationType;
}): Promise<ConceptRelation> {
  assertSystemActor(input.actor);

  if (input.fromConceptId === input.toConceptId) {
    throw new ValidationError("Concept relation cannot be reflexive.");
  }
  if (input.type !== "PREREQUISITE" && input.type !== "RELATED") {
    throw new ValidationError("Invalid concept relation type.");
  }

  const [from, to] = await Promise.all([
    prisma.concept.findUnique({ where: { id: input.fromConceptId } }),
    prisma.concept.findUnique({ where: { id: input.toConceptId } }),
  ]);
  if (!from || !to) {
    throw new ValidationError("Concept not found for relation.");
  }

  return prisma.conceptRelation.create({
    data: {
      fromConceptId: input.fromConceptId,
      toConceptId: input.toConceptId,
      type: input.type,
    },
  });
}

/** SYSTEM catalog is broadly readable; USER concepts are owner-only. */
export async function getReadableConcept(args: {
  conceptId: string;
  actorUserId: string;
}): Promise<Concept> {
  const concept = await prisma.concept.findUnique({
    where: { id: args.conceptId },
  });
  if (!concept) {
    throw new ValidationError("Concept not found.");
  }
  if (
    concept.source === "USER" &&
    concept.createdByUserId !== args.actorUserId
  ) {
    throw new ForbiddenError();
  }
  return concept;
}

export async function listSubjects(): Promise<Subject[]> {
  return prisma.subject.findMany({ orderBy: { name: "asc" } });
}

export async function listTopicsForSubject(subjectId: string): Promise<Topic[]> {
  return prisma.topic.findMany({
    where: { subjectId },
    orderBy: { name: "asc" },
  });
}

export async function listConceptsForTopic(args: {
  topicId: string;
  actorUserId: string;
}): Promise<Concept[]> {
  return prisma.concept.findMany({
    where: {
      topicId: args.topicId,
      OR: [
        { source: "SYSTEM" },
        { source: "USER", createdByUserId: args.actorUserId },
      ],
    },
    orderBy: { name: "asc" },
  });
}
