-- Phase 4 Implementation #2 remediation:
-- immutable reservation-time plan/trial source + uncapped settle estimate

ALTER TABLE "ai_usage_operations" ADD COLUMN "reservationPlan" "PlanTier";
ALTER TABLE "ai_usage_operations" ADD COLUMN "consumedTrialCapacity" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_usage_operations" ADD COLUMN "uncappedEstimateMicros" INTEGER;

-- Backfill from the entitlement linked at reservation time (best available
-- historical signal for already-open rows). New reservations set these
-- immutably inside the reserve transaction.
UPDATE "ai_usage_operations" AS o
SET
  "reservationPlan" = e."plan",
  "consumedTrialCapacity" = (e."plan" = 'FREE_TRIAL')
FROM "entitlements" AS e
WHERE o."entitlementId" = e."id"
  AND o."reservationPlan" IS NULL;
