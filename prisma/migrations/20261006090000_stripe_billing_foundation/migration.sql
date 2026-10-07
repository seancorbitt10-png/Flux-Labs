-- Stripe billing foundation.
ALTER TABLE "users" ADD COLUMN "stripeCustomerId" TEXT;
CREATE UNIQUE INDEX "users_stripeCustomerId_key" ON "users"("stripeCustomerId");

CREATE UNIQUE INDEX "entitlements_externalSubscriptionId_key"
  ON "entitlements"("externalSubscriptionId");

CREATE TABLE "billing_webhook_events" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "billing_webhook_events_type_receivedAt_idx"
  ON "billing_webhook_events"("type", "receivedAt");
