-- R-10 (refinements catalog 2026-07-28; master-spec §6 O-4 Flow A (4)) — the O-4 goals/intensity
-- step's three goal fields (income goal, weekly time commitment, promotion target) now persist.
-- `goal_fields` records them on the onboarding session row (compact JSON:
-- { monthlyIncomeGoal?, weeklyTimeCommitment?, promotionTarget? } — all optional). This mirrors
-- `sponsor_decision`'s "audit record, never a source of truth" posture: the LIVE source the
-- completion/provisioning paths read is the existing `intensity_data` JSON (which carries the
-- same three fields from the INTENSITY step payload); this column is the durable copy that
-- survives any future re-submission. Additive, nullable — existing rows are unaffected.

ALTER TABLE "OnboardingSession" ADD COLUMN "goal_fields" JSONB;
