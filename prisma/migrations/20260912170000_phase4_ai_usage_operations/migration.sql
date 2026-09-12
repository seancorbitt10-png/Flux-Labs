-- Phase 4 Implementation #2: AI usage reservation / settlement ledger

CREATE TYPE "AiUsageOperationStatus" AS ENUM ('RESERVED', 'SETTLED', 'RELEASED');

CREATE TABLE "ai_usage_operations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entitlementId" TEXT,
    "capability" "UsageCapability" NOT NULL,
    "feature" TEXT NOT NULL,
    "status" "AiUsageOperationStatus" NOT NULL DEFAULT 'RESERVED',
    "estimatedCostMicros" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "modelKey" TEXT,
    "errorCode" TEXT,
    "releaseReason" TEXT,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "usageRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_usage_operations_usageRecordId_key" ON "ai_usage_operations"("usageRecordId");
CREATE INDEX "ai_usage_operations_userId_status_capability_idx" ON "ai_usage_operations"("userId", "status", "capability");
CREATE INDEX "ai_usage_operations_userId_createdAt_idx" ON "ai_usage_operations"("userId", "createdAt");
CREATE INDEX "ai_usage_operations_status_reservedAt_idx" ON "ai_usage_operations"("status", "reservedAt");

ALTER TABLE "ai_usage_operations" ADD CONSTRAINT "ai_usage_operations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_usage_operations" ADD CONSTRAINT "ai_usage_operations_usageRecordId_fkey" FOREIGN KEY ("usageRecordId") REFERENCES "usage_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
