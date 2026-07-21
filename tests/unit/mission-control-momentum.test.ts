// WP04 (T-32) — momentum + Grove pure-logic proof (uiux §3, master-spec §12.1 interim formula).

import {
  computeBloomOverride,
  computeGroveBandState,
  computeMomentum,
  computeMomentumCriteria,
  groveCaptionFor,
  type MilestoneLike,
  type MomentumEventLike,
} from '../../src/services/mission-control/momentum';
import { MomentumCriterion, MOMENTUM_CRITERION_LAW } from '../../src/services/gamification/momentum-criteria';

const NOW = new Date('2026-07-15T12:00:00.000Z');

describe('computeMomentum — bands, per-Law independence, decay, sparkline', () => {
  test('no events → score 0, band resting, empty totalEventCount', () => {
    const result = computeMomentum([], NOW);
    expect(result.score).toBe(0);
    expect(result.band).toBe('resting');
    expect(result.totalEventCount).toBe(0);
    expect(result.sparkline).toHaveLength(7);
    expect(result.sparkline.every((v) => v === 0)).toBe(true);
  });

  test('AC-3-1: changing one Law\'s inputs changes ONLY its own channel', () => {
    const base: MomentumEventLike[] = [
      { law: 'grow', points: 50, created_at: NOW },
      { law: 'engage', points: 40, created_at: NOW },
      { law: 'wealth', points: 30, created_at: NOW },
    ];
    const before = computeMomentum(base, NOW);

    const growBoosted: MomentumEventLike[] = [...base, { law: 'grow', points: 20, created_at: NOW }];
    const after = computeMomentum(growBoosted, NOW);

    expect(after.laws.grow).toBeGreaterThan(before.laws.grow);
    expect(after.laws.engage).toBe(before.laws.engage);
    expect(after.laws.wealth).toBe(before.laws.wealth);
  });

  test('cross-law events lift all three Law sums (doctrine: "never celebrates one while another is dark")', () => {
    const events: MomentumEventLike[] = [{ law: 'cross', points: 30, created_at: NOW }];
    const result = computeMomentum(events, NOW);
    expect(result.laws.grow).toBe(30);
    expect(result.laws.engage).toBe(30);
    expect(result.laws.wealth).toBe(30);
  });

  test('bands: 80-100 thriving / 60-79 growing / 40-59 quiet / 0-39 resting', () => {
    const scoreFor = (points: number) =>
      computeMomentum(
        [
          { law: 'grow', points, created_at: NOW },
          { law: 'engage', points, created_at: NOW },
          { law: 'wealth', points, created_at: NOW },
        ],
        NOW
      );
    expect(scoreFor(90).band).toBe('thriving');
    expect(scoreFor(65).band).toBe('growing');
    expect(scoreFor(45).band).toBe('quiet');
    expect(scoreFor(10).band).toBe('resting');
  });

  test('score never exceeds 100 (clamped) and never goes negative from decay', () => {
    const manyEvents: MomentumEventLike[] = Array.from({ length: 50 }, () => ({
      law: 'grow' as const,
      points: 10,
      created_at: NOW,
    }));
    const result = computeMomentum(manyEvents, NOW);
    expect(result.laws.grow).toBeLessThanOrEqual(100);
    expect(result.laws.grow).toBeGreaterThanOrEqual(0);
  });

  test('decays -1/day after 72h inactivity (§12.1)', () => {
    const staleEvents: MomentumEventLike[] = [{ law: 'grow', points: 50, created_at: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000) }];
    const result = computeMomentum(staleEvents, NOW);
    // 10 days idle - 3 day grace = 7 days of -1/day decay = -7
    expect(result.laws.grow).toBe(43);
  });

  test('7-day sparkline has 7 entries, oldest first, each 0-100 and never NaN', () => {
    const events: MomentumEventLike[] = [{ law: 'engage', points: 40, created_at: NOW }];
    const result = computeMomentum(events, NOW);
    expect(result.sparkline).toHaveLength(7);
    for (const v of result.sparkline) {
      expect(Number.isNaN(v)).toBe(false);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    // the event lands on "today" (index 6) — the score should rise there vs. days before it existed.
    expect(result.sparkline[6]).toBeGreaterThan(result.sparkline[0]);
  });
});

describe('computeGroveBandState — uiux §3.2 the ongoing state ladder', () => {
  test('zero events → seed (onboarding complete, pre-first-action)', () => {
    const m = computeMomentum([], NOW);
    expect(computeGroveBandState(m)).toBe('seed');
  });

  test('exactly one event → sprout (first IPA logged)', () => {
    const m = computeMomentum([{ law: 'grow', points: 2, created_at: NOW }], NOW);
    expect(computeGroveBandState(m)).toBe('sprout');
  });

  test('multiple events → the band-driven state (never brown/wilted language, AC-3-2)', () => {
    const m = computeMomentum(
      [
        { law: 'grow', points: 5, created_at: NOW },
        { law: 'grow', points: 5, created_at: NOW },
      ],
      NOW
    );
    const state = computeGroveBandState(m);
    expect(['thriving', 'growing', 'quiet', 'resting']).toContain(state);
  });
});

describe('groveCaptionFor — AC-3-2 (no state text ever shames the rep)', () => {
  const ALL_STATES = ['seed', 'sprout', 'thriving', 'growing', 'quiet', 'resting', 'bloom', 'stale'] as const;
  const SHAME_WORDS = ['dead', 'failed', 'wilt', 'brown', 'lazy', "you didn't", 'bad'];

  test.each(ALL_STATES)('state "%s" renders a non-empty, non-shaming caption', (state) => {
    const caption = groveCaptionFor(state, 'First Recruit');
    expect(caption.length).toBeGreaterThan(0);
    for (const word of SHAME_WORDS) {
      expect(caption.toLowerCase()).not.toContain(word);
    }
  });

  test('resting never mentions death or brown/wilt imagery in words (AC-3-2)', () => {
    expect(groveCaptionFor('resting').toLowerCase()).not.toMatch(/dead|wilt|brown/);
  });
});

describe('computeBloomOverride — transient milestone overlay', () => {
  test('a fresh, uncelebrated milestone triggers bloom', () => {
    const milestones: MilestoneLike[] = [{ milestone_key: 'first_recruit', achieved_at: new Date(NOW.getTime() - 60 * 1000), celebrated: false }];
    const bloom = computeBloomOverride(milestones, NOW);
    expect(bloom).not.toBeNull();
    expect(bloom?.label).toBe('first recruit');
  });

  // T-52 (WCAG 2.2 AA §17.4 / uiux §6.1 item 5): `key` is ADDITIVE — the raw milestone_key,
  // unchanged by the existing `.label` formatting above — so a caller with access to WP07's
  // celebration engine (mission-control/zones/header.ts) can build the full "Milestone full-bloom"
  // narration script from it. `.label` (asserted above) must keep behaving identically.
  test('the raw `key` is carried through unmodified, alongside the existing `.label`', () => {
    const milestones: MilestoneLike[] = [{ milestone_key: 'FIRST_RECRUIT', achieved_at: new Date(NOW.getTime() - 60 * 1000), celebrated: false }];
    const bloom = computeBloomOverride(milestones, NOW);
    expect(bloom?.key).toBe('FIRST_RECRUIT');
    expect(bloom?.label).toBe('FIRST RECRUIT');
  });

  test('an already-celebrated milestone does not re-trigger bloom', () => {
    const milestones: MilestoneLike[] = [{ milestone_key: 'first_recruit', achieved_at: new Date(NOW.getTime() - 60 * 1000), celebrated: true }];
    expect(computeBloomOverride(milestones, NOW)).toBeNull();
  });

  test('a stale milestone (outside the 10-minute window) does not trigger bloom', () => {
    const milestones: MilestoneLike[] = [{ milestone_key: 'first_recruit', achieved_at: new Date(NOW.getTime() - 60 * 60 * 1000), celebrated: false }];
    expect(computeBloomOverride(milestones, NOW)).toBeNull();
  });

  test('no milestones at all → null', () => {
    expect(computeBloomOverride([], NOW)).toBeNull();
  });
});

// T-43 (WP07 §12.1) — the ten-criteria breakdown layered on top of the unchanged score above.
describe('computeMomentumCriteria — the ten §12.1 criteria + five-level Downline-Maxxer name', () => {
  test('no events → every criterion 0, level "Seed That Never Sprouted"', () => {
    const result = computeMomentumCriteria([], NOW);
    expect(result.levelName).toBe('Seed That Never Sprouted');
    for (const v of Object.values(result.criteria)) {
      expect(v).toBe(0);
    }
  });

  test('an unrecognized event_type contributes to the Law total (via computeMomentum) but to NO named criterion', () => {
    const events: MomentumEventLike[] = [{ law: 'grow', points: 50, created_at: NOW, event_type: 'some_unmapped_type' }];
    const result = computeMomentumCriteria(events, NOW);
    expect(Object.values(result.criteria).every((v) => v === 0)).toBe(true);
  });

  test('introduction_sent credits ONLY Outreach Consistency, capped at 10 (§12.1 "10 pts each")', () => {
    const events: MomentumEventLike[] = [
      { law: 'grow', points: 3, created_at: NOW, event_type: 'introduction_sent' },
      { law: 'grow', points: 3, created_at: NOW, event_type: 'introduction_sent' },
      { law: 'grow', points: 3, created_at: NOW, event_type: 'introduction_sent' },
      { law: 'grow', points: 3, created_at: NOW, event_type: 'introduction_sent' },
      { law: 'grow', points: 3, created_at: NOW, event_type: 'introduction_sent' },
    ];
    const result = computeMomentumCriteria(events, NOW);
    expect(result.criteria[MomentumCriterion.OUTREACH_CONSISTENCY]).toBe(10); // 15 raw, clamped to 10
    expect(result.criteria[MomentumCriterion.DOWNLINE_MULTIPLIER]).toBe(0);
  });

  test('recruit_joined credits ONLY Downline Multiplier', () => {
    const events: MomentumEventLike[] = [{ law: 'grow', points: 9, created_at: NOW, event_type: 'recruit_joined' }];
    const result = computeMomentumCriteria(events, NOW);
    expect(result.criteria[MomentumCriterion.DOWNLINE_MULTIPLIER]).toBe(9);
    expect(result.criteria[MomentumCriterion.OUTREACH_CONSISTENCY]).toBe(0);
  });

  test('"latest"-mode criteria (e.g. Belief Metric) use the MOST RECENT reading, not a sum of daily snapshots', () => {
    const events: MomentumEventLike[] = [
      { law: 'cross', points: 4, created_at: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000), event_type: 'belief_sentiment_reviewed' },
      { law: 'cross', points: 7, created_at: NOW, event_type: 'belief_sentiment_reviewed' },
    ];
    const result = computeMomentumCriteria(events, NOW);
    // If this were summed like a count-based criterion it would clamp at 10 (4+7=11); the correct
    // "latest reading" behavior returns today's 7, not the sum.
    expect(result.criteria[MomentumCriterion.BELIEF_METRIC]).toBe(7);
  });

  test('a cross-law criterion (Belief Metric) decays with the same 72h-grace rule as a Law total', () => {
    const stale: MomentumEventLike[] = [
      { law: 'cross', points: 10, created_at: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000), event_type: 'belief_sentiment_reviewed' },
    ];
    const result = computeMomentumCriteria(stale, NOW);
    // 10 days idle - 3 day grace = 7 days of -1/day decay = 10 - 7 = 3
    expect(result.criteria[MomentumCriterion.BELIEF_METRIC]).toBe(3);
  });

  test('level name maps the SAME overall score computeMomentum returns (one authoritative score)', () => {
    const events: MomentumEventLike[] = [
      { law: 'grow', points: 90, created_at: NOW },
      { law: 'engage', points: 90, created_at: NOW },
      { law: 'wealth', points: 90, created_at: NOW },
    ];
    const overall = computeMomentum(events, NOW);
    const withCriteria = computeMomentumCriteria(events, NOW);
    expect(overall.score).toBeGreaterThanOrEqual(80);
    expect(withCriteria.levelName).toBe('Full Harvest Maxxer');
  });

  test('weakestCriterion always names a criterion belonging to the current weakest (or cross) Law', () => {
    const events: MomentumEventLike[] = [
      { law: 'grow', points: 80, created_at: NOW, event_type: 'introduction_sent' },
      { law: 'wealth', points: 5, created_at: NOW, event_type: 'appointment_held' },
    ];
    const result = computeMomentumCriteria(events, NOW);
    // grow=80, engage=0 (untouched), wealth=5 → engage is the weakest Law.
    const law = MOMENTUM_CRITERION_LAW[result.weakestCriterion];
    expect(['engage', 'cross']).toContain(law);
  });
});
