// T-43 (WP07 §12.1, §12.3, §12.6) — package-free scheduled-sweep handler logic (the WP07 analog of
// `agent-runtime/scheduled-dispatch.ts` / `messaging/sequence/sequence-scheduled-run.ts`): no
// `inngest` import here, so this file IS reachable from the Jest suite directly. The `inngest`-
// wrapped cron registrations live in `gamification-inngest-functions.ts`, which imports `prisma` and
// these three sweep functions and wraps each in one `step.run`, exactly mirroring the established
// convention elsewhere in this codebase.

import { checkMilestones } from './celebration.service';
import { checkInactivityNudge, dispatchNonCriticalNotification, getOrCreatePreferences } from './notification.service';
import { readAnchorStatement } from './anchor';
import { deliverQuote } from './quote.service';
import { reconcileMomentumForUser } from './momentum-reconciliation.service';
import { recomputeStreak } from './streak.service';
import { DEFAULT_LOCALE, isLocale, LOCALE_BCP47, type Locale } from '@/lib/i18n/locale';

export interface ScheduledSweepDb {
  user: {
    // `locale` (T-R32, §17.5 "locale affects ... quiet-hours logic") is additive/optional — every
    // existing caller (momentum/milestone sweeps) that ignores it keeps compiling unchanged. Real
    // Prisma calls select no explicit column list here, so the live column is always present; this
    // just widens the TYPE so `runNotificationSweep` can read it without a schema/query change.
    findMany(args: { where: Record<string, unknown> }): Promise<{ id: string; org_type: string; locale?: string | null }[]>;
    findUnique(args: { where: { id: string } }): Promise<{ intensity_setting: string } | null>;
  };
}

const ACTIVE_REP_FILTER = { role: { in: ['REP', 'DUAL'] }, onboarding_status: 'GATED_COMPLETE' } as const;

/** Daily — the four "latest"-mode momentum criteria + streak recompute, for every active rep. */
export async function runMomentumReconciliationSweep(db: ScheduledSweepDb & Parameters<typeof reconcileMomentumForUser>[0] & Parameters<typeof recomputeStreak>[0], now: Date = new Date()): Promise<{ processed: number }> {
  const users = await db.user.findMany({ where: ACTIVE_REP_FILTER });
  for (const user of users) {
    try {
      await reconcileMomentumForUser(db, user.id);
      await recomputeStreak(db, user.id, now);
    } catch {
      // one rep's failure never blocks the sweep for the rest (independent-failure posture, §9.5).
    }
  }
  return { processed: users.length };
}

/** Every 5 minutes — milestone detection backstop for reps not currently loading Today (§12.9-3
 *  "detection within 5 minutes" as a genuine worst-case bound). */
export async function runMilestoneSweep(db: ScheduledSweepDb & Parameters<typeof checkMilestones>[0], now: Date = new Date()): Promise<{ processed: number }> {
  const users = await db.user.findMany({ where: ACTIVE_REP_FILTER });
  for (const user of users) {
    try {
      await checkMilestones(db, user.id, now);
    } catch {
      // independent per-rep failure isolation.
    }
  }
  return { processed: users.length };
}

export interface NotificationSweepDb extends ScheduledSweepDb {
  notificationPreference: Parameters<typeof getOrCreatePreferences>[0]['notificationPreference'];
  notificationLog: Parameters<typeof dispatchNonCriticalNotification>[0]['notificationLog'];
  momentumEvent: Parameters<typeof checkInactivityNudge>[0]['momentumEvent'];
  quoteLibrary?: { findMany(args: { where: Record<string, unknown> }): Promise<{ id: string; text: string; attribution: string | null; org_scope: string; cfe_cleared: boolean; tags: string[] }[]> };
  whySession: { findFirst(args: { where: { user_id: string }; orderBy?: Record<string, unknown> }): Promise<{ anchor_statement: string | null } | null> };
}

// T-R32 (§17.5 "locale affects date/number/timezone formatting and quiet-hours logic") — this
// DECIDES the quiet-hours/send-timing outcome for the rep (which hour they're in, hour is fed into
// `isWithinOwnQuietHours` downstream), so it now resolves through the rep's own locale
// (`LOCALE_BCP47[locale]`) instead of a hardcoded `'en-US'`. Functionally the numeral extraction is
// identical for both supported locales today (en-US/es-US both use Latin digits for `hour12: false`
// 2-digit output), so EN behavior is byte-identical to before; the point is routing through the
// platform's real i18n layer rather than a hardcoded literal, so a future locale with a different
// numbering system doesn't silently mis-decide a rep's quiet hours.
// Exported (was module-private) so `tests/unit/gamification-scheduled.test.ts` can prove the
// locale-threading fix directly — the full `runNotificationSweep` pipeline routes every dispatch
// through the REAL `ComplianceFilterEngine` (§0.4 rule 2's fail-closed posture: a bare test double
// with no DB-backed context legitimately holds content it cannot fully evaluate), so asserting on
// `notificationLog.create` calls there would test CFE fail-closed behavior, not this function.
export function localHour(timezone: string, now: Date, locale: Locale = DEFAULT_LOCALE): number {
  try {
    const formatted = new Intl.DateTimeFormat(LOCALE_BCP47[locale], { timeZone: timezone, hour: '2-digit', hour12: false }).format(now);
    return Number.parseInt(formatted, 10) % 24;
  } catch {
    return now.getUTCHours(); // unknown/invalid timezone — fail toward UTC, never throw
  }
}

/** Hourly — dispatches Morning Briefing / Midday Motivation / Evening Recap at each rep's own local
 *  hour, plus the inactivity-nudge check. Every send is idempotent per (user, type, day) via
 *  `NotificationLog`'s unique constraint, so an hourly tick never double-sends. */
export async function runNotificationSweep(db: NotificationSweepDb, now: Date = new Date()): Promise<{ processed: number }> {
  const users = await db.user.findMany({ where: ACTIVE_REP_FILTER });
  const dayKey = now.toISOString().slice(0, 10);

  for (const user of users) {
    try {
      const prefs = await getOrCreatePreferences(db, user.id);
      // T-R32 (§17.5 locale-aware quiet-hours logic) — the rep's OWN catalog locale (never trusted
      // verbatim; validated through `isLocale`, defaulting sensibly — same posture as every other
      // `User.locale` read in this codebase, see `src/lib/i18n/locale.ts`'s header).
      const locale: Locale = isLocale(user.locale) ? user.locale : DEFAULT_LOCALE;
      const hour = localHour(prefs.timezone, now, locale);
      const anchor = await readAnchorStatement(db, user.id);
      const userContext = { user_id: user.id, role: 'REP' as const };

      const morningHour = Number.parseInt(prefs.morning_briefing_time.split(':')[0] ?? '7', 10);
      if (hour === morningHour) {
        await dispatchNonCriticalNotification(
          db,
          {
            userId: user.id,
            type: 'MORNING_BRIEFING',
            body: anchor ? `While you slept, your field kept working. ${anchor}` : 'While you slept, your field kept working — see your Today for the full report.',
            dedupeKey: dayKey,
            deepLink: '/today/briefing',
            nowLocalHHMM: `${String(hour).padStart(2, '0')}:00`,
            userContext,
          }
        );
      }

      if (hour === 12) {
        const quote = await deliverQuote({
          userId: user.id,
          isPrimerica: user.org_type === 'PRIMERICA',
          timeSlot: 'midday',
          anchorStatement: anchor,
          userContext,
          now,
        }, { db: db.quoteLibrary ? { quoteLibrary: db.quoteLibrary } : undefined });
        if (quote.status === 'ok') {
          await dispatchNonCriticalNotification(db, {
            userId: user.id,
            type: 'MIDDAY_MOTIVATION',
            body: quote.text,
            dedupeKey: dayKey,
            deepLink: '/today',
            nowLocalHHMM: `${String(hour).padStart(2, '0')}:00`,
            userContext,
          });
        }
      }

      if (hour === 18) {
        await dispatchNonCriticalNotification(db, {
          userId: user.id,
          type: 'EVENING_RECAP',
          body: anchor ? `Another day of consistency. Tomorrow, keep going. ${anchor}` : 'Another day of consistency. Tomorrow, keep going.',
          dedupeKey: dayKey,
          deepLink: '/today',
          nowLocalHHMM: `${String(hour).padStart(2, '0')}:00`,
          userContext,
        });
      }

      await checkInactivityNudge(db, user.id, anchor, userContext, now);
    } catch {
      // independent per-rep failure isolation.
    }
  }
  return { processed: users.length };
}
