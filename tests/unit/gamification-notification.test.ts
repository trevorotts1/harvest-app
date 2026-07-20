// T-43 (WP07 §12.6, §12.9-6) — notification timing/mutability rules: inactivity nudges fire at
// EXACTLY 3/5/7 days; milestone/action/billing notifications are unmutable (no preference check, no
// quiet-hours gate); the rep's own quiet hours gate non-critical sends; every dispatch is idempotent.

import {
  checkInactivityNudge,
  dispatchNonCriticalNotification,
  dispatchUnmutableNotification,
  isUnmutable,
  isWithinOwnQuietHours,
} from '../../src/services/gamification/notification.service';
import type { CFEContentEvaluator } from '../../src/services/gamification/cfe-gate';
import type { CFEVerdict } from '../../src/types/compliance';

const USER_CONTEXT = { user_id: 'rep-1', role: 'REP' as const };

function passingCFE(): CFEContentEvaluator {
  return {
    async evaluateContent(): Promise<CFEVerdict> {
      return { band: 'clear', score: 0, classifierResults: [], held: false, released: true, reason: 'clean', heldReason: null, safeHarbor: { injected: false, disclaimers: [] }, httpStatus: 200, ruleVersion: 't', auditEvent: {} as CFEVerdict['auditEvent'] };
    },
  };
}

function makeLogDb() {
  const sent = new Map<string, boolean>();
  return {
    notificationLog: {
      findUnique: async ({ where }: { where: { user_id_type_dedupe_key: { user_id: string; type: string; dedupe_key: string } } }) => {
        const k = `${where.user_id_type_dedupe_key.user_id}:${where.user_id_type_dedupe_key.type}:${where.user_id_type_dedupe_key.dedupe_key}`;
        return sent.has(k) ? ({ user_id: 'rep-1', type: 'x', unmutable: false, dedupe_key: 'x', deep_link: null, created_at: new Date() }) : null;
      },
      create: async ({ data }: { data: { user_id: string; type: string; dedupe_key: string; unmutable: boolean; deep_link: string | null } }) => {
        sent.set(`${data.user_id}:${data.type}:${data.dedupe_key}`, true);
        return { ...data, created_at: new Date() };
      },
    },
  };
}

describe('isUnmutable — the three critical/unmutable types', () => {
  test.each(['ACTION_ALERT', 'MILESTONE_CELEBRATION', 'BILLING_SECURITY'] as const)('%s is unmutable', (t) => {
    expect(isUnmutable(t)).toBe(true);
  });
  test.each(['MORNING_BRIEFING', 'MIDDAY_MOTIVATION', 'EVENING_RECAP'] as const)('%s is NOT unmutable (rep-controlled)', (t) => {
    expect(isUnmutable(t)).toBe(false);
  });
});

describe('isWithinOwnQuietHours — overnight window handling', () => {
  test('inside an overnight 21:00-07:00 window', () => {
    expect(isWithinOwnQuietHours({ quiet_hours_start: '21:00', quiet_hours_end: '07:00' }, '23:30')).toBe(true);
    expect(isWithinOwnQuietHours({ quiet_hours_start: '21:00', quiet_hours_end: '07:00' }, '03:00')).toBe(true);
  });
  test('outside the quiet window', () => {
    expect(isWithinOwnQuietHours({ quiet_hours_start: '21:00', quiet_hours_end: '07:00' }, '12:00')).toBe(false);
  });
});

describe('dispatchUnmutableNotification — no preference/quiet-hours gate applies', () => {
  test('sends regardless of any preference (unmutable, always on)', async () => {
    const logDb = makeLogDb();
    const result = await dispatchUnmutableNotification(
      logDb,
      { userId: 'rep-1', type: 'MILESTONE_CELEBRATION', body: 'You did it!', dedupeKey: 'first-appt', deepLink: '/today', userContext: USER_CONTEXT },
      passingCFE()
    );
    expect(result.sent).toBe(true);
  });

  test('idempotent: the SAME dedupe key never sends twice', async () => {
    const logDb = makeLogDb();
    const opts = { userId: 'rep-1', type: 'MILESTONE_CELEBRATION' as const, body: 'You did it!', dedupeKey: 'first-appt', deepLink: '/today', userContext: USER_CONTEXT };
    const first = await dispatchUnmutableNotification(logDb, opts, passingCFE());
    const second = await dispatchUnmutableNotification(logDb, opts, passingCFE());
    expect(first.sent).toBe(true);
    expect(second.sent).toBe(false);
    expect(second.reason).toBe('already_sent');
  });
});

describe('checkInactivityNudge — fires at EXACTLY 3/5/7 days, never a range, never a repeat', () => {
  // FIXED reference instant — `created_at` and `now` are both derived from THIS single value, never
  // two independent `Date.now()` calls (which flaked: any scheduling delay between capturing `now`
  // and the fixture's own `Date.now()` could shave the elapsed time to just under N days, causing
  // `Math.floor` to round down to N-1 and intermittently fail this exact test).
  const NOW = new Date('2026-07-15T12:00:00.000Z');

  function makeInactivityDb(daysAgo: number) {
    const logDb = makeLogDb();
    return {
      ...logDb,
      momentumEvent: {
        findMany: async () => [{ created_at: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000) }],
      },
      user: { findUnique: async () => ({ intensity_setting: 'MEDIUM' }) },
    };
  }

  test.each([3, 5, 7])('fires at exactly day %i', async (days) => {
    const db = makeInactivityDb(days);
    const result = await checkInactivityNudge(db, 'rep-1', null, USER_CONTEXT, NOW, passingCFE());
    expect(result.sent).toBe(true);
    expect(result.daysInactive).toBe(days);
  });

  test.each([1, 2, 4, 6, 8, 10])('does NOT fire on day %i', async (days) => {
    const db = makeInactivityDb(days);
    const result = await checkInactivityNudge(db, 'rep-1', null, USER_CONTEXT, NOW, passingCFE());
    expect(result.sent).toBe(false);
  });

  test('a second check on the SAME day-3 threshold does not re-send', async () => {
    const db = makeInactivityDb(3);
    const first = await checkInactivityNudge(db, 'rep-1', null, USER_CONTEXT, NOW, passingCFE());
    const second = await checkInactivityNudge(db, 'rep-1', null, USER_CONTEXT, NOW, passingCFE());
    expect(first.sent).toBe(true);
    expect(second.sent).toBe(false);
  });

  test('no activity history at all → never fires (nothing to measure)', async () => {
    const logDb = makeLogDb();
    const db = { ...logDb, momentumEvent: { findMany: async () => [] }, user: { findUnique: async () => ({ intensity_setting: 'MEDIUM' }) } };
    const result = await checkInactivityNudge(db, 'rep-1', null, USER_CONTEXT, new Date(), passingCFE());
    expect(result.sent).toBe(false);
  });
});

describe('dispatchNonCriticalNotification — rep controls timing/frequency', () => {
  test('disabled preference blocks the send', async () => {
    const logDb = makeLogDb();
    const db = {
      ...logDb,
      notificationPreference: {
        findUnique: async () => ({ user_id: 'rep-1', morning_briefing_enabled: false, morning_briefing_time: '07:00', midday_motivation_enabled: true, evening_recap_enabled: true, quiet_hours_start: '21:00', quiet_hours_end: '07:00', timezone: 'UTC' }),
        upsert: async () => ({} as never),
      },
    };
    const result = await dispatchNonCriticalNotification(
      db,
      { userId: 'rep-1', type: 'MORNING_BRIEFING', body: 'Good morning', dedupeKey: '2026-07-15', deepLink: '/today/briefing', nowLocalHHMM: '07:00', userContext: USER_CONTEXT },
      passingCFE()
    );
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  test('within the rep\'s own quiet hours blocks the send even if enabled', async () => {
    const logDb = makeLogDb();
    const db = {
      ...logDb,
      notificationPreference: {
        findUnique: async () => ({ user_id: 'rep-1', morning_briefing_enabled: true, morning_briefing_time: '07:00', midday_motivation_enabled: true, evening_recap_enabled: true, quiet_hours_start: '21:00', quiet_hours_end: '07:00', timezone: 'UTC' }),
        upsert: async () => ({} as never),
      },
    };
    const result = await dispatchNonCriticalNotification(
      db,
      { userId: 'rep-1', type: 'MORNING_BRIEFING', body: 'Good morning', dedupeKey: '2026-07-15', deepLink: '/today/briefing', nowLocalHHMM: '23:00', userContext: USER_CONTEXT },
      passingCFE()
    );
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('quiet_hours');
  });
});
