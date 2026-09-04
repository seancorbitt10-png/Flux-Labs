-- CreateEnum
CREATE TYPE "ProvenanceKind" AS ENUM ('EXPLICIT', 'IMPORTED', 'OBSERVED', 'INFERRED', 'HYPOTHESIS');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "OnboardingSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ConceptSource" AS ENUM ('SYSTEM', 'USER');

-- CreateEnum
CREATE TYPE "ConceptRelationType" AS ENUM ('PREREQUISITE', 'RELATED');

-- CreateEnum
CREATE TYPE "MasteryLevel" AS ENUM ('UNKNOWN', 'INTRODUCED', 'DEVELOPING', 'PROFICIENT', 'MASTERED');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('SELF_REPORT', 'PRACTICE_SUCCESS', 'PRACTICE_FAILURE', 'TUTOR_SIGNAL', 'QUIZ_ITEM', 'REVIEW');

-- CreateEnum
CREATE TYPE "EvidencePolarity" AS ENUM ('SUPPORTS_HIGHER', 'SUPPORTS_LOWER', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "MisconceptionStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'DISMISSED');

-- DropIndex
DROP INDEX "trials_userId_idx";

-- AlterTable
ALTER TABLE "student_profiles" ADD COLUMN     "onboardingSkippedAt" TIMESTAMP(3),
ADD COLUMN     "onboardingVersion" TEXT;

-- CreateTable
CREATE TABLE "student_attributes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "provenance" "ProvenanceKind" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_goals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER,
    "provenance" "ProvenanceKind" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "OnboardingSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_answers" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answerJson" JSONB,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_observations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "provenance" "ProvenanceKind" NOT NULL DEFAULT 'OBSERVED',
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_evidence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conceptId" TEXT,
    "observationId" TEXT,
    "kind" "EvidenceKind" NOT NULL,
    "polarity" "EvidencePolarity" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_concept_states" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "mastery" "MasteryLevel" NOT NULL DEFAULT 'UNKNOWN',
    "confidence" DOUBLE PRECISION NOT NULL,
    "provenance" "ProvenanceKind" NOT NULL,
    "source" TEXT NOT NULL,
    "lastEvidenceAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_concept_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_misconceptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conceptId" TEXT,
    "statement" TEXT NOT NULL,
    "status" "MisconceptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "provenance" "ProvenanceKind" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_misconceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concepts" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" "ConceptSource" NOT NULL DEFAULT 'SYSTEM',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "concepts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concept_relations" (
    "id" TEXT NOT NULL,
    "fromConceptId" TEXT NOT NULL,
    "toConceptId" TEXT NOT NULL,
    "type" "ConceptRelationType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concept_relations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_attributes_userId_key_idx" ON "student_attributes"("userId", "key");

-- CreateIndex
CREATE INDEX "student_attributes_userId_supersededAt_idx" ON "student_attributes"("userId", "supersededAt");

-- CreateIndex
CREATE INDEX "student_goals_userId_status_idx" ON "student_goals"("userId", "status");

-- CreateIndex
CREATE INDEX "onboarding_sessions_userId_status_idx" ON "onboarding_sessions"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_answers_sessionId_questionId_key" ON "onboarding_answers"("sessionId", "questionId");

-- CreateIndex
CREATE INDEX "student_observations_userId_createdAt_idx" ON "student_observations"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "student_observations_userId_category_createdAt_idx" ON "student_observations"("userId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "learning_evidence_userId_createdAt_idx" ON "learning_evidence"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "learning_evidence_userId_conceptId_createdAt_idx" ON "learning_evidence"("userId", "conceptId", "createdAt");

-- CreateIndex
CREATE INDEX "student_concept_states_userId_mastery_idx" ON "student_concept_states"("userId", "mastery");

-- CreateIndex
CREATE UNIQUE INDEX "student_concept_states_userId_conceptId_key" ON "student_concept_states"("userId", "conceptId");

-- CreateIndex
CREATE INDEX "student_misconceptions_userId_status_idx" ON "student_misconceptions"("userId", "status");

-- CreateIndex
CREATE INDEX "student_misconceptions_userId_conceptId_idx" ON "student_misconceptions"("userId", "conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_slug_key" ON "subjects"("slug");

-- CreateIndex
CREATE INDEX "topics_subjectId_idx" ON "topics"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "topics_subjectId_slug_key" ON "topics"("subjectId", "slug");

-- CreateIndex
CREATE INDEX "concepts_topicId_idx" ON "concepts"("topicId");

-- CreateIndex
CREATE INDEX "concepts_createdByUserId_idx" ON "concepts"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "concepts_topicId_slug_key" ON "concepts"("topicId", "slug");

-- CreateIndex
CREATE INDEX "concept_relations_fromConceptId_idx" ON "concept_relations"("fromConceptId");

-- CreateIndex
CREATE INDEX "concept_relations_toConceptId_idx" ON "concept_relations"("toConceptId");

-- CreateIndex
CREATE UNIQUE INDEX "concept_relations_fromConceptId_toConceptId_type_key" ON "concept_relations"("fromConceptId", "toConceptId", "type");

-- AddForeignKey
ALTER TABLE "student_attributes" ADD CONSTRAINT "student_attributes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_goals" ADD CONSTRAINT "student_goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_answers" ADD CONSTRAINT "onboarding_answers_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "onboarding_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_observations" ADD CONSTRAINT "student_observations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_evidence" ADD CONSTRAINT "learning_evidence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_evidence" ADD CONSTRAINT "learning_evidence_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_evidence" ADD CONSTRAINT "learning_evidence_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "student_observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_concept_states" ADD CONSTRAINT "student_concept_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_concept_states" ADD CONSTRAINT "student_concept_states_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_misconceptions" ADD CONSTRAINT "student_misconceptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_misconceptions" ADD CONSTRAINT "student_misconceptions_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_relations" ADD CONSTRAINT "concept_relations_fromConceptId_fkey" FOREIGN KEY ("fromConceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_relations" ADD CONSTRAINT "concept_relations_toConceptId_fkey" FOREIGN KEY ("toConceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Partial unique: at most one active StudentAttribute per (userId, key)
-- Prisma cannot express WHERE supersededAt IS NULL in @@unique.
CREATE UNIQUE INDEX IF NOT EXISTS "student_attribute_one_active_per_key"
ON "student_attributes"("userId", "key")
WHERE "supersededAt" IS NULL;
