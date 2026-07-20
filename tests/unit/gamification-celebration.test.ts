// T-43 (WP07 §12.3, §12.9-3) — the Celebration & Milestone Engine: idempotent detection of the five
// named firsts, and CFE-gated share text (a break-it target per the QC checklist).

import { acknowledgeMilestone, buildMilestoneShareText, checkMilestones, MilestoneKey } from '../../src/services/gamification/celebration.service';
import type { CFEContentEvaluator } from '../../src/services/gamification/cfe-gate';
import type { CFEVerdict } from '../../src/types/compliance';

const USER_CONTEXT = { user_id: 'rep-1', role: 'REP' as const };

function passingCFE(): CFEContentEvaluator {
  return {
    async evaluateContent(): Promise<CFEVerdict> {
      return {
        band: 'clear', score: 0, classifierResults: [], held: false, released: true, reason: 'clean',
        heldReason: null, safeHarbor: { injected: false, disclaimers: [] }, httpStatus: 200,
        ruleVersion: 'test', auditEvent: {} as CFEVerdict['auditEvent'],
      };
    },
  };
}

function blockingCFE(): CFEContentEvaluator {
  return {
    async evaluateContent(): Promise<CFEVerdict> {
      return {
        band: 'blocked', score: 95, classifierResults: [], held: false, released: false, reason: 'income_claim',
        heldReason: null, safeHarbor: { injected: false, disclaimers: [] }, httpStatus: 403,
        ruleVersion: 'test', auditEvent: {} as CFEVerdict['auditEvent'],
      };
    },
  };
}

function makeDb(overrides: Partial<{
  downlines: { id: string }[];
  confirmedAppointment: boolean;
  inboundMessage: boolean;
  licensedDownlineEvent: boolean;
  streakDays: number;
  existingMilestones: Set<string>;
}> = {}) {
  const existing = overrides.existingMilestones ?? new Set<string>();
  const created: string[] = [];
  return {
    db: {
      user: { findMany: async () => overrides.downlines ?? [] },
      appointment: { findFirst: async () => (overrides.confirmedAppointment ? { id: 'appt-1' } : null) },
      message: { findFirst: async () => (overrides.inboundMessage ? { id: 'msg-1' } : null) },
      licensingStateEvent: { findFirst: async () => (overrides.licensedDownlineEvent ? { id: 'lic-1' } : null) },
      streakState: { findUnique: async () => ({ current_streak_days: overrides.streakDays ?? 0 }) },
      milestone: {
        findMany: async () => [],
        findUnique: async ({ where }: { where: { user_id_milestone_key: { milestone_key: string } } }) =>
          existing.has(where.user_id_milestone_key.milestone_key) ? { user_id: 'rep-1', milestone_key: where.user_id_milestone_key.milestone_key, achieved_at: new Date(), celebrated: false, shareable_asset_ref: null } : null,
        create: async ({ data }: { data: { milestone_key: string } }) => {
          created.push(data.milestone_key);
          existing.add(data.milestone_key);
          return { user_id: 'rep-1', milestone_key: data.milestone_key, achieved_at: new Date(), celebrated: false, shareable_asset_ref: null };
        },
        update: async () => ({ user_id: 'rep-1', milestone_key: '', achieved_at: new Date(), celebrated: true, shareable_asset_ref: null }),
      },
    },
    created,
  };
}

describe('checkMilestones — detects each of the five named firsts from real underlying data', () => {
  test('FIRST_APPOINTMENT detected when a CONFIRMED appointment exists', async () => {
    const { db, created } = makeDb({ confirmedAppointment: true });
    const newly = await checkMilestones(db, 'rep-1');
    expect(newly).toContain(MilestoneKey.FIRST_APPOINTMENT);
    expect(created).toContain(MilestoneKey.FIRST_APPOINTMENT);
  });

  test('FIRST_RECRUIT detected when the rep has at least one downline', async () => {
    const { db } = makeDb({ downlines: [{ id: 'downline-1' }] });
    const newly = await checkMilestones(db, 'rep-1');
    expect(newly).toContain(MilestoneKey.FIRST_RECRUIT);
  });

  test('FIRST_LICENSED_TEAM_MEMBER detected when a downline has a LICENSED transition', async () => {
    const { db } = makeDb({ downlines: [{ id: 'downline-1' }], licensedDownlineEvent: true });
    const newly = await checkMilestones(db, 'rep-1');
    expect(newly).toContain(MilestoneKey.FIRST_LICENSED_TEAM_MEMBER);
  });

  test('THIRTY_DAY_STREAK detected at >=30 days', async () => {
    const { db } = makeDb({ streakDays: 30 });
    const newly = await checkMilestones(db, 'rep-1');
    expect(newly).toContain(MilestoneKey.THIRTY_DAY_STREAK);
  });

  test('IDEMPOTENT: a condition that already has a recorded milestone is never re-recorded', async () => {
    const { db, created } = makeDb({ confirmedAppointment: true, existingMilestones: new Set([MilestoneKey.FIRST_APPOINTMENT]) });
    const newly = await checkMilestones(db, 'rep-1');
    expect(newly).not.toContain(MilestoneKey.FIRST_APPOINTMENT);
    expect(created).toHaveLength(0);
  });

  test('no conditions true → nothing recorded', async () => {
    const { db, created } = makeDb({});
    const newly = await checkMilestones(db, 'rep-1');
    expect(newly).toHaveLength(0);
    expect(created).toHaveLength(0);
  });
});

describe('acknowledgeMilestone — flips celebrated without deleting the achievement', () => {
  test('calls update with celebrated: true', async () => {
    const calls: unknown[] = [];
    const db = { milestone: { update: async (args: unknown) => { calls.push(args); return {}; } } };
    await acknowledgeMilestone(db as never, 'rep-1', MilestoneKey.FIRST_RESPONSE);
    expect(calls).toHaveLength(1);
  });
});

describe('buildMilestoneShareText — CFE-gated (§12.9-3 "shares are CFE-filtered")', () => {
  test('a clean share line passes and includes the anchor statement', async () => {
    const result = await buildMilestoneShareText(MilestoneKey.FIRST_APPOINTMENT, 'I do this for my kids.', USER_CONTEXT, passingCFE());
    expect(result.status).toBe('ok');
    expect(result.text).toContain('I do this for my kids.');
  });

  test('a blocked verdict never returns shareable text', async () => {
    const result = await buildMilestoneShareText(MilestoneKey.FIRST_APPOINTMENT, null, USER_CONTEXT, blockingCFE());
    expect(result.status).toBe('held');
    expect(result.text).toBeUndefined();
  });
});
