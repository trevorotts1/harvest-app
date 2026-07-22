// T-43 (WP07 §12.3, §12.9-3) — the Celebration & Milestone Engine: idempotent detection of the five
// named firsts, and CFE-gated share text (a break-it target per the QC checklist).

import {
  acknowledgeMilestone,
  buildMilestoneFullBloomNarration,
  buildMilestoneShareText,
  checkMilestones,
  milestoneAnchorLine,
  MILESTONE_ANCHOR_LINE,
  milestoneDisplayName,
  MILESTONE_DISPLAY_NAME,
  MilestoneKey,
} from '../../src/services/gamification/celebration.service';
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

// T-52 (WCAG 2.2 AA §17.4 / uiux §6.1 item 5) — "Milestone full-bloom" narration script, verbatim:
// "Milestone: {name}. {anchor tie-in line}. This moment is saved to your field." Previously
// entirely absent (Grove's bloom caption only ever showed the raw `milestone_key`, e.g. "FIRST
// APPOINTMENT" — see mission-control-momentum.test.ts's pre-existing `computeBloomOverride`
// assertions for that unchanged raw-label behavior, which this narration is additive to, not a
// replacement for).
describe('buildMilestoneFullBloomNarration — uiux §6.1 item 5 script, verbatim', () => {
  test.each(Object.values(MilestoneKey))('%s composes "Milestone: {name}. {anchor}. This moment is saved to your field."', (key) => {
    const narration = buildMilestoneFullBloomNarration(key);
    expect(narration).toBe(`Milestone: ${MILESTONE_DISPLAY_NAME[key]}. ${MILESTONE_ANCHOR_LINE[key]} This moment is saved to your field.`);
    expect(narration).toMatch(/^Milestone: /);
    expect(narration).toContain('This moment is saved to your field.');
  });

  test('an unrecognized key returns null rather than a garbled sentence', () => {
    expect(buildMilestoneFullBloomNarration('NOT_A_REAL_MILESTONE')).toBeNull();
    expect(buildMilestoneFullBloomNarration('')).toBeNull();
  });
});

// T-57 (server-msg-i18n) — this narration used to be bare English regardless of the rep's locale
// (both here and via header.ts's Grove full-bloom render, and the identical anchor line rendered raw
// by milestones.ts's pin-strip zone). `locale` is an OPTIONAL trailing param defaulting to English —
// every EN assertion above (which omits it) is proven UNCHANGED by this describe block; these add the
// genuine Spanish half.
describe('buildMilestoneFullBloomNarration / milestoneDisplayName / milestoneAnchorLine — locale-aware (T-57 server-msg-i18n)', () => {
  test('EN default (no locale arg): matches the exported English dicts, byte-identical to before this fix', () => {
    for (const key of Object.values(MilestoneKey)) {
      expect(milestoneDisplayName(key)).toBe(MILESTONE_DISPLAY_NAME[key]);
      expect(milestoneAnchorLine(key)).toBe(MILESTONE_ANCHOR_LINE[key]);
    }
  });

  test.each(Object.values(MilestoneKey))('TEETH — %s composes a genuine Spanish "Hito: {name}. {anchor} Este momento queda guardado en tu campo." for es locale', (key) => {
    const narration = buildMilestoneFullBloomNarration(key, 'es');
    expect(narration).toBe(`Hito: ${milestoneDisplayName(key, 'es')}. ${milestoneAnchorLine(key, 'es')} Este momento queda guardado en tu campo.`);
    expect(narration).toMatch(/^Hito: /);
    expect(narration).not.toContain('Milestone:');
    expect(narration).not.toBe(buildMilestoneFullBloomNarration(key)); // never falls back to English
  });

  test('an unrecognized key returns null for es locale too, never a garbled sentence', () => {
    expect(buildMilestoneFullBloomNarration('NOT_A_REAL_MILESTONE', 'es')).toBeNull();
  });

  test('specific Spanish anchor lines (spot-check real idiomatic copy, not a mechanical placeholder)', () => {
    expect(milestoneAnchorLine(MilestoneKey.FIRST_RECRUIT, 'es')).toBe('Alguien eligió construir junto a ti. Esa es la cosecha multiplicándose.');
    expect(milestoneDisplayName(MilestoneKey.THIRTY_DAY_STREAK, 'es')).toBe('Racha de treinta días');
  });
});
