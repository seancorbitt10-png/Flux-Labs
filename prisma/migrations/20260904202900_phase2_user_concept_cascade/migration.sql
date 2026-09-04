-- USER concepts must not orphan when their owning User is deleted.
-- SYSTEM concepts keep createdByUserId NULL and are unaffected by this FK.
-- Narrow change: only Concept.createdByUserId delete behavior SetNull → Cascade.

ALTER TABLE "concepts" DROP CONSTRAINT "concepts_createdByUserId_fkey";

ALTER TABLE "concepts" ADD CONSTRAINT "concepts_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
