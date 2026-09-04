import type {
  Concept,
  ConceptRelation,
  ConceptRelationType,
  ConceptSource,
  Subject,
  Topic,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ForbiddenError, ValidationError } from "@/lib/errors";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME_MAX = 120;
const DESC_MAX = 2000;

function assertSlug(slug: string, label: string): void {
  if (!slug || !SLUG_RE.test(slug) || slug.length > 80) {
    throw new ValidationError(`Invalid ${label} slug.`);
  }
}

export async function createSubject(input: {
  slug: string;
  name: string;
  description?: string | null;
}): Promise<Subject> {
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
  subjectId: string;
  slug: string;
  name: string;
  description?: string | null;
}): Promise<Topic> {
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

export async function createConcept(input: {
  topicId: string;
  slug: string;
  name: string;
  description?: string | null;
  source?: ConceptSource;
  createdByUserId?: string | null;
}): Promise<Concept> {
  assertSlug(input.slug, "concept");
  const topic = await prisma.topic.findUnique({ where: { id: input.topicId } });
  if (!topic) {
    throw new ValidationError("Topic not found.");
  }
  const name = input.name?.trim();
  if (!name || name.length > NAME_MAX) {
    throw new ValidationError("Invalid concept name.");
  }

  const source = input.source ?? "SYSTEM";
  if (source === "USER" && !input.createdByUserId) {
    throw new ValidationError("USER concepts require createdByUserId.");
  }
  if (source === "SYSTEM" && input.createdByUserId) {
    throw new ValidationError("SYSTEM concepts must not set createdByUserId.");
  }

  return prisma.concept.create({
    data: {
      topicId: input.topicId,
      slug: input.slug,
      name,
      description: input.description?.trim() || null,
      source,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
}

export async function createConceptRelation(input: {
  fromConceptId: string;
  toConceptId: string;
  type: ConceptRelationType;
}): Promise<ConceptRelation> {
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
