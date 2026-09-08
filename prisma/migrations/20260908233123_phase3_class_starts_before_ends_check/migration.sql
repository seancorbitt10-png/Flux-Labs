-- Enforce Class temporal invariant at the database level so concurrent
-- partial updates cannot persist startsAt > endsAt.
-- Application-level validation remains for clear user-facing errors.
-- Nullable dates are allowed (either side may be null).

ALTER TABLE "classes"
ADD CONSTRAINT "classes_starts_before_ends_check"
CHECK (
  "startsAt" IS NULL
  OR "endsAt" IS NULL
  OR "startsAt" <= "endsAt"
);
