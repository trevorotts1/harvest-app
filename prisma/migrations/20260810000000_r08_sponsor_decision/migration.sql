-- R-08 (refinements catalog 2026-07-28) — the sponsor-outcome screen's choices now persist
-- server-side. `sponsor_decision` records the rep's sponsor-step decision on their onboarding
-- session row (a compact JSON: `{ decision, recordedAt }` — decision is one of accept |
-- join_waitlist | start_paid | no_upline_yet; the `accept` case ALSO lands a real Sponsorship +
-- OrgTreeEdge + User.upline_id row, so this column is a decision record, never a source of truth
-- for the sponsorship itself). Additive, nullable — existing rows are unaffected.

ALTER TABLE "OnboardingSession" ADD COLUMN "sponsor_decision" JSONB;
