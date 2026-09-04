-- One trial record per user (Phase 1)
CREATE UNIQUE INDEX IF NOT EXISTS "trials_userId_key" ON "trials"("userId");

-- At most one ACTIVE entitlement per user
CREATE UNIQUE INDEX IF NOT EXISTS "entitlements_one_active_per_user"
ON "entitlements"("userId")
WHERE "status" = 'ACTIVE';
