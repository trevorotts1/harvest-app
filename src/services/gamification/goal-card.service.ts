// T-43 (WP07 §12.8) — the Goal Commitment Card: income target, promotion timeline, top-three dreams
// and financial goals, the weekly-activity math, all tied to the anchor statement; lives at the top
// of Mission Control. Durable via the `GoalCommitmentCard` Prisma model (replaces this file's earlier
// in-memory-Map scaffold, which did not survive a serverless instance restart — see the platform
// invariant against non-durable state for anything real reps rely on).

import type { GoalCommitmentCardRow } from './prisma-types';

interface GoalCardDb {
  goalCommitmentCard: {
    findUnique(args: { where: { user_id: string } }): Promise<GoalCommitmentCardRow | null>;
    upsert(args: { where: { user_id: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<GoalCommitmentCardRow>;
  };
}

export interface GoalCommitmentCardView {
  incomeTarget: string | null;
  promotionTimeline: string | null;
  topThreeDreams: string[];
  financialGoals: string[];
  weeklyActivityMath: { introductions: number; appointments: number; closes: number } | null;
  updatedAt: string;
}

function toView(row: GoalCommitmentCardRow): GoalCommitmentCardView {
  return {
    incomeTarget: row.income_target,
    promotionTimeline: row.promotion_timeline,
    topThreeDreams: Array.isArray(row.top_three_dreams) ? (row.top_three_dreams as string[]) : [],
    financialGoals: Array.isArray(row.financial_goals) ? (row.financial_goals as string[]) : [],
    weeklyActivityMath: (row.weekly_activity_math as GoalCommitmentCardView['weeklyActivityMath']) ?? null,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getGoalCard(db: GoalCardDb, userId: string): Promise<GoalCommitmentCardView | null> {
  const row = await db.goalCommitmentCard.findUnique({ where: { user_id: userId } });
  return row ? toView(row) : null;
}

export interface GoalCardPatch {
  incomeTarget?: string;
  promotionTimeline?: string;
  topThreeDreams?: string[]; // capped at 3
  financialGoals?: string[];
  weeklyActivityMath?: { introductions: number; appointments: number; closes: number };
}

export async function upsertGoalCard(db: GoalCardDb, userId: string, patch: GoalCardPatch): Promise<GoalCommitmentCardView> {
  const data: Record<string, unknown> = {};
  if (patch.incomeTarget !== undefined) data.income_target = patch.incomeTarget;
  if (patch.promotionTimeline !== undefined) data.promotion_timeline = patch.promotionTimeline;
  if (patch.topThreeDreams !== undefined) data.top_three_dreams = patch.topThreeDreams.slice(0, 3);
  if (patch.financialGoals !== undefined) data.financial_goals = patch.financialGoals;
  if (patch.weeklyActivityMath !== undefined) data.weekly_activity_math = patch.weeklyActivityMath;

  const row = await db.goalCommitmentCard.upsert({
    where: { user_id: userId },
    create: { user_id: userId, ...data },
    update: data,
  });
  return toView(row);
}

/** §12.8 "the weekly-activity math" — a simple, honest derivation from an income target using the
 *  same conservative multipliers `hidden-earnings.ts` (WP02, §8) already establishes for the
 *  universal path (never re-deriving a different, inconsistent set of ratios). Purely advisory
 *  math shown to the rep, always paired with the platform's safe-harbor framing elsewhere — this
 *  function itself returns only integers, never currency claims. */
export function deriveWeeklyActivityMath(desiredClosesPerWeek: number): { introductions: number; appointments: number; closes: number } {
  const closes = Math.max(0, Math.round(desiredClosesPerWeek));
  // Baseline 20:5:1 ratio (master-spec §9.7) — introductions : appointments : closes.
  const appointments = closes * 5;
  const introductions = closes * 20;
  return { introductions, appointments, closes };
}
