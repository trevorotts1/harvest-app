-- T-57 R3c-2 (master-spec §9.4; findings m4): the third per-contact agent control, "manual mode",
-- alongside the existing agents_paused/do_not_contact columns. Additive, NOT NULL with a default —
-- existing rows get `false` (unaffected), no backfill/data-movement needed. Pure ADD COLUMN, safe
-- against the running application during a rolling deploy.
ALTER TABLE "Contact" ADD COLUMN "manual_mode" BOOLEAN NOT NULL DEFAULT false;
