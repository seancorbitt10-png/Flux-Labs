-- Phase 2 Implementation #5: controlled AI proposal / write-back pipeline.
-- Justification: confirmation integrity requires server-owned proposal rows so
-- clients cannot rewrite proposal content, spoof ownership, or replay confirms.
-- Stores minimum metadata only (type/target/status/timestamps/outcome) — not
-- raw AI context or full Student Model snapshots.

CREATE TYPE "AIProposalStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'DEFERRED');

CREATE TABLE "ai_proposals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT 'ai-proposal.v1',
    "type" TEXT NOT NULL,
    "status" "AIProposalStatus" NOT NULL DEFAULT 'PENDING',
    "targetJson" JSONB NOT NULL,
    "proposedValueJson" JSONB NOT NULL,
    "rationale" TEXT,
    "evidenceReference" TEXT,
    "validationOutcome" TEXT NOT NULL,
    "validationReason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "aiInteractionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_proposals_userId_status_createdAt_idx" ON "ai_proposals"("userId", "status", "createdAt");

CREATE INDEX "ai_proposals_userId_createdAt_idx" ON "ai_proposals"("userId", "createdAt");

ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
