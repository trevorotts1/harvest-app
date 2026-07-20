// WP08 §13.1/§13.4 — node health tint (Three-Law triad) + stagnation, reusing WP04's
// `computeMomentum` as the sole scoring engine.

import { computeNodeHealth, emptyNodeHealth, STAGNATION_THRESHOLD_DAYS } from '../../src/services/taprooting/health';
import type { MomentumEventLike } from '../../src/services/mission-control/momentum';

const NOW = new Date('2026-07-20T12:00:00.000Z');

function eventsAt(daysAgo: number, points: number, law: 'grow' | 'engage' | 'wealth' = 'grow'): MomentumEventLike[] {
  return [{ law, points, created_at: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000) }];
}

describe('computeNodeHealth (§13.1 tint mapping)', () => {
  it('a fresh, highly active node is green (active/growth)', () => {
    // computeMomentum bands: >=80 thriving, >=60 growing (both -> green), >=40 quiet (yellow),
    // else resting (red). 70/70/70 averages to 70 -> 'growing' -> green.
    const events: MomentumEventLike[] = [
      { law: 'grow', points: 70, created_at: NOW },
      { law: 'engage', points: 70, created_at: NOW },
      { law: 'wealth', points: 70, created_at: NOW },
    ];
    const health = computeNodeHealth(events, NOW);
    expect(health.tint).toBe('green');
  });

  it('a quiet (mid-band) node is yellow (stagnant/retention-risk)', () => {
    // 45/45/45 averages to 45 -> 'quiet' -> yellow.
    const events: MomentumEventLike[] = [
      { law: 'grow', points: 45, created_at: NOW },
      { law: 'engage', points: 45, created_at: NOW },
      { law: 'wealth', points: 45, created_at: NOW },
    ];
    const health = computeNodeHealth(events, NOW);
    expect(health.tint).toBe('yellow');
  });

  it('a node with no activity at all is red (reverse-maxxing)', () => {
    const health = computeNodeHealth([], NOW);
    expect(health.tint).toBe('red');
    expect(health.score).toBe(0);
  });

  it('flags stagnant only past the 30-day threshold (§13.4)', () => {
    expect(STAGNATION_THRESHOLD_DAYS).toBe(30);
    const justUnder = computeNodeHealth(eventsAt(29, 50), NOW);
    expect(justUnder.stagnant).toBe(false);

    const over = computeNodeHealth(eventsAt(31, 50), NOW);
    expect(over.stagnant).toBe(true);
    expect(over.daysSinceLastActivity).toBe(31);
  });

  it('emptyNodeHealth is an honest zero default, not a fabricated score', () => {
    const health = emptyNodeHealth();
    expect(health.score).toBe(0);
    expect(health.laws).toEqual({ grow: 0, engage: 0, wealth: 0 });
    expect(health.stagnant).toBe(false);
  });
});
