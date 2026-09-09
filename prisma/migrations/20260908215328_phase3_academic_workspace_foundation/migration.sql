-- CreateEnum
CREATE TYPE "ClassStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "classes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "status" "ClassStatus" NOT NULL DEFAULT 'ACTIVE',
    "courseCode" TEXT,
    "instructorName" TEXT,
    "description" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "classId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "dueAt" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "priority" INTEGER,
    "estimatedMinutes" INTEGER,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_concepts" (
    "taskId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_concepts_pkey" PRIMARY KEY ("taskId","conceptId")
);

-- CreateIndex
CREATE INDEX "classes_userId_status_idx" ON "classes"("userId", "status");

-- CreateIndex
CREATE INDEX "classes_userId_term_idx" ON "classes"("userId", "term");

-- CreateIndex
CREATE INDEX "tasks_userId_status_idx" ON "tasks"("userId", "status");

-- CreateIndex
CREATE INDEX "tasks_userId_dueAt_idx" ON "tasks"("userId", "dueAt");

-- CreateIndex
CREATE INDEX "tasks_userId_classId_dueAt_idx" ON "tasks"("userId", "classId", "dueAt");

-- CreateIndex
CREATE INDEX "task_concepts_conceptId_idx" ON "task_concepts"("conceptId");

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_concepts" ADD CONSTRAINT "task_concepts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_concepts" ADD CONSTRAINT "task_concepts_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
