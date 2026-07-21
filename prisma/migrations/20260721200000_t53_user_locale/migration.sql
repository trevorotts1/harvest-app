-- T-53 (master-spec §17.5 / uiux §6.2 i18n): additive, nullable per-user language preference.
-- Existing rows get NULL (no migration/backfill needed — NULL means "not set", the app falls back
-- to Accept-Language detection then the platform default 'en'). Pure ADD COLUMN, no data movement,
-- no DROP — safe against the running application during a rolling deploy.
ALTER TABLE "User" ADD COLUMN "locale" TEXT;
