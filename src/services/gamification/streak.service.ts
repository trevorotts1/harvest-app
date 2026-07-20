// T-43 (WP07 §12.5, §12.9-5) — the Weekly streak tracker. Rolling 7-day window; a day qualifies with
// >=1 IPA, OR Mission Control reviewed 5+ min, OR >=1 community introduction; one grace day/week
// (Low intensity) preserves a streak on a missed day (compassionate repair); after a genuine break
// the streak restarts with NO partial credit.
//
// RELATIONSHIP TO THE EXISTING SHIFT-RITUAL STREAK (read before assuming this duplicates work):
// `src/services/learning-state/shift.service.ts` (WP04, T-34) already persists its OWN
// `ShiftSession.streak_count`/`grace_day_used` — a correct, already-shipped streak specifically tied
// to COMPLETING the daily Shift ritual (uiux §5.3's own close-screen animation/copy). This module
// does NOT touch or replace that file (avoiding any risk to its own tests/behavior) — it is WP07's
// broader, §12.5-complete superset: a day qualifies via ANY of the three named paths (an IPA logged
// directly from Today's action queue with the Shift never opened counts too, per §12.5's literal "OR
// ... OR" — the Shift-only implementation only covers the "Mission Control reviewed" path). A day
// that satisfies the Shift ritual's own DONE state always also satisfies THIS tracker (one of its
// three OR-conditions is exactly that), so the two are consistent in the common case where a rep
// always uses the Shift; this tracker additionally credits the day when a rep instead engaged
// directly with the Vault/Today. This service, not the Shift's own field, is what feeds the §12.5
// Streak Bar / §12.6 notification cadence data — the Shift's own field is left untouched for its
// existing UI.

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetweenDateStrings(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00.000Z`).getTime();
  const db = new Date(`${b}T00:00:00.000Z`).getTime();
  return Math.round((da - db) / (1000 * 60 * 60 * 24));
}

/** ISO 8601 week key, e.g. "2026-W29" — ONE grace day per key, matching shift.service.ts's own
 *  `GRACE_DAYS_PER_WEEK = 1` convention (independently derived here, not imported, since that
 *  module's helper is private — see file header). */
export function isoWeekKey(dateString: string): string {
  const d = new Date(`${dateString}T00:00:00.000Z`);
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() - dayNum + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export interface StreakDb {
  momentumEvent: { findMany(args: { where: { user_id: string; created_at: { gte: Date; lt: Date } } }): Promise<{ id?: string }[]> };
  shiftSession?: { findUnique(args: { where: { user_id_session_date: { user_id: string; session_date: string } } }): Promise<{ phase: string } | null> };
  user: { findUnique(args: { where: { id: string } }): Promise<{ intensity_setting: string } | null> };
  streakState: {
    findUnique(args: { where: { user_id: string } }): Promise<{
      current_streak_days: number;
      longest_streak_days: number;
      last_qualifying_date: string | null;
      grace_day_used_for_week: string | null;
    } | null>;
    upsert(args: { where: { user_id: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>;
  };
}

async function dayQualifies(db: StreakDb, userId: string, dayKey: string): Promise<boolean> {
  const start = new Date(`${dayKey}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const events = await db.momentumEvent.findMany({ where: { user_id: userId, created_at: { gte: start, lt: end } } });
  if (events.length > 0) return true; // >=1 IPA OR >=1 community introduction (both recorded as MomentumEvent)

  if (db.shiftSession) {
    const shift = await db.shiftSession.findUnique({ where: { user_id_session_date: { user_id: userId, session_date: dayKey } } });
    if (shift && (shift.phase === 'DONE' || shift.phase === 'CLOSE')) return true; // Mission Control reviewed
  }
  return false;
}

export interface StreakSummary {
  currentStreakDays: number;
  longestStreakDays: number;
  graceDayAvailableThisWeek: boolean;
  graceDayUsedThisWeek: boolean;
  last7Days: { date: string; qualified: boolean; wasGraceDay: boolean }[];
}

/** Recomputes and persists today's streak state given whether today qualifies. Idempotent per day —
 *  calling this twice for the same `dayKey` is a no-op the second time (`last_qualifying_date`
 *  already equals `dayKey`). */
export async function recomputeStreak(db: StreakDb, userId: string, now: Date = new Date()): Promise<StreakSummary> {
  const dayKey = utcDateString(now);
  const qualifies = await dayQualifies(db, userId, dayKey);
  const existing = await db.streakState.findUnique({ where: { user_id: userId } });

  let current = existing?.current_streak_days ?? 0;
  let longest = existing?.longest_streak_days ?? 0;
  let graceUsedForWeek = existing?.grace_day_used_for_week ?? null;
  const lastQualifying = existing?.last_qualifying_date ?? null;

  if (qualifies) {
    if (lastQualifying === dayKey) {
      // Already recorded today — idempotent no-op.
    } else if (lastQualifying === null) {
      current = 1;
    } else {
      const gap = daysBetweenDateStrings(dayKey, lastQualifying);
      if (gap === 1) {
        current += 1; // consecutive day
      } else if (gap === 2) {
        // Exactly one missed day in between — eligible for the one weekly grace day (Low intensity).
        const user = await db.user.findUnique({ where: { id: userId } });
        const missedDayKey = new Date(new Date(`${dayKey}T00:00:00.000Z`).getTime() - 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        const missedWeek = isoWeekKey(missedDayKey);
        const graceAvailable = user?.intensity_setting === 'LOW' && graceUsedForWeek !== missedWeek;
        if (graceAvailable) {
          current += 1; // compassionate repair — no partial credit lost
          graceUsedForWeek = missedWeek;
        } else {
          current = 1; // genuine break — restart, no partial credit (§12.9-5)
        }
      } else {
        current = 1; // genuine break (>1 day missed) — restart, no partial credit
      }
    }
    longest = Math.max(longest, current);
  }

  await db.streakState.upsert({
    where: { user_id: userId },
    create: {
      user_id: userId,
      current_streak_days: current,
      longest_streak_days: longest,
      last_qualifying_date: qualifies ? dayKey : lastQualifying,
      grace_day_used_for_week: graceUsedForWeek,
    },
    update: {
      current_streak_days: current,
      longest_streak_days: longest,
      last_qualifying_date: qualifies ? dayKey : lastQualifying,
      grace_day_used_for_week: graceUsedForWeek,
    },
  });

  const thisWeek = isoWeekKey(dayKey);
  const last7: { date: string; qualified: boolean; wasGraceDay: boolean }[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = utcDateString(d);
    last7.push({ date: key, qualified: key === dayKey ? qualifies : key === lastQualifying, wasGraceDay: graceUsedForWeek === isoWeekKey(key) });
  }

  return {
    currentStreakDays: current,
    longestStreakDays: longest,
    graceDayAvailableThisWeek: graceUsedForWeek !== thisWeek,
    graceDayUsedThisWeek: graceUsedForWeek === thisWeek,
    last7Days: last7,
  };
}
