-- Phase 4 Implementation #2 remediation: reserved cost ceiling on AI usage ops

ALTER TABLE "ai_usage_operations" ADD COLUMN "reservedCostMicros" INTEGER NOT NULL DEFAULT 0;
