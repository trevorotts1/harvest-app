// T-43 (WP07 §12.2, §12.9-2) — the 48-Hour Countdown / First-48 guided mode.

import {
  buildFirstFortyEightState,
  ensureFirstFortyEightStarted,
  firstFortyEightGoals,
  firstFortyEightPhase,
} from '../../src/services/gamification/first-48.service';

const NOW = new Date('2026-07-15T12:00:00.000Z');

describe('firstFortyEightPhase — on-time / warning / expired thresholds (§12.2)', () => {
  test('under 48h → ON_TIME', () => {
    expect(firstFortyEightPhase(new Date(NOW.getTime() - 10 * 60 * 60 * 1000), NOW)).toBe('ON_TIME');
  });
  test('48h-72h → WARNING', () => {
    expect(firstFortyEightPhase(new Date(NOW.getTime() - 50 * 60 * 60 * 1000), NOW)).toBe('WARNING');
  });
  test('72h+ → EXPIRED, urgency removed but the phase is still reported (goals remain tappable)', () => {
    expect(firstFortyEightPhase(new Date(NOW.getTime() - 100 * 60 * 60 * 1000), NOW)).toBe('EXPIRED');
  });
});

describe('ensureFirstFortyEightStarted — activates ONLY on gated_complete, idempotent', () => {
  test('does nothing for a rep still IN_PROGRESS', async () => {
    const updates: unknown[] = [];
    const db = {
      user: {
        findUnique: async () => ({ onboarding_status: 'IN_PROGRESS', gated_complete_at: null }),
        update: async (args: unknown) => { updates.push(args); return {}; },
      },
    };
    await ensureFirstFortyEightStarted(db, 'rep-1', NOW);
    expect(updates).toHaveLength(0);
  });

  test('stamps gated_complete_at exactly once for a GATED_COMPLETE rep with no stamp yet', async () => {
    const updates: unknown[] = [];
    const db = {
      user: {
        findUnique: async () => ({ onboarding_status: 'GATED_COMPLETE', gated_complete_at: null }),
        update: async (args: unknown) => { updates.push(args); return {}; },
      },
    };
    await ensureFirstFortyEightStarted(db, 'rep-1', NOW);
    expect(updates).toHaveLength(1);
  });

  test('does NOT re-stamp a rep who already has gated_complete_at set', async () => {
    const updates: unknown[] = [];
    const db = {
      user: {
        findUnique: async () => ({ onboarding_status: 'GATED_COMPLETE', gated_complete_at: new Date('2026-07-01') }),
        update: async (args: unknown) => { updates.push(args); return {}; },
      },
    };
    await ensureFirstFortyEightStarted(db, 'rep-1', NOW);
    expect(updates).toHaveLength(0);
  });
});

describe('firstFortyEightGoals — exactly three closest-sphere A-list names, never fabricated (§12.2)', () => {
  test('prefers WP03 readiness_tier A contacts when present', async () => {
    const db = {
      contactMethodProfile: {
        findMany: async () => [{ contact_id: 'c1' }, { contact_id: 'c2' }],
      },
      contact: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          if ('id' in args.where) {
            return [
              { id: 'c1', first_name: 'Maya', last_name: 'Johnson', last_contact_date: null },
              { id: 'c2', first_name: 'Derrick', last_name: 'Miles', last_contact_date: new Date() },
            ];
          }
          return [];
        },
      },
    };
    const goals = await firstFortyEightGoals(db, 'rep-1');
    expect(goals).toHaveLength(2);
    expect(goals[0].displayName).toBe('Maya J.');
    expect(goals[1].contacted).toBe(true);
  });

  test('falls back to Contact.is_a_list when no WP03 profile exists (universal/non-Primerica rep)', async () => {
    const db = {
      contact: {
        findMany: async () => [{ id: 'c3', first_name: 'Tasha', last_name: 'Green', last_contact_date: null }],
      },
    };
    const goals = await firstFortyEightGoals(db, 'rep-1');
    expect(goals).toHaveLength(1);
    expect(goals[0].displayName).toBe('Tasha G.');
  });

  test('caps at three even if more are available', async () => {
    const db = {
      contact: {
        findMany: async () =>
          Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, first_name: `Name${i}`, last_name: 'X', last_contact_date: null })),
      },
    };
    const goals = await firstFortyEightGoals(db, 'rep-1');
    expect(goals).toHaveLength(3);
  });
});

describe('buildFirstFortyEightState — not active pre-gated_complete, never NaN', () => {
  test('inactive state for a rep with no gated_complete_at', async () => {
    const db = { user: { findUnique: async () => ({ onboarding_status: 'IN_PROGRESS', gated_complete_at: null }) }, contact: { findMany: async () => [] } };
    const state = await buildFirstFortyEightState(db as never, 'rep-1', NOW);
    expect(state.active).toBe(false);
    expect(state.phase).toBeNull();
    expect(state.goals).toEqual([]);
  });

  test('active state reports hoursElapsed as a finite number, never NaN', async () => {
    const db = {
      user: { findUnique: async () => ({ onboarding_status: 'GATED_COMPLETE', gated_complete_at: new Date(NOW.getTime() - 5 * 60 * 60 * 1000) }) },
      contact: { findMany: async () => [] },
    };
    const state = await buildFirstFortyEightState(db as never, 'rep-1', NOW);
    expect(state.active).toBe(true);
    expect(state.phase).toBe('ON_TIME');
    expect(Number.isFinite(state.hoursElapsed)).toBe(true);
  });
});
