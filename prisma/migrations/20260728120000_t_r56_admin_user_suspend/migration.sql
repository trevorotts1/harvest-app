-- T-R56 (admin console — user_profile.manage): additive account-hold columns. Existing rows get
-- is_suspended = false / suspended_at = NULL / suspended_reason = NULL (the safe, non-suspended
-- default) — no backfill needed. Pure ADD COLUMN, no DROP — safe against a running application
-- during a rolling deploy.
ALTER TABLE "User" ADD COLUMN "is_suspended" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "suspended_at" TIMESTAMPTZ(6);
ALTER TABLE "User" ADD COLUMN "suspended_reason" TEXT;
