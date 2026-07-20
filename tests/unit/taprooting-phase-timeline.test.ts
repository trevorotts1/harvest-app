// WP08 §13.3/§13.6-3, §5.5 — the phased timeline: activity-gated (never calendar-gated) unlock, and
// the insurance-recommendation hard-block flag for every non-LICENSED state.

import {
  buildPhasedTimeline,
  buildPhasedTimelineResult,
  milestoneKeyFor,
  LAUNCH_PHASE_ITEMS,
  LICENSING_PHASE_ITEMS,
} from '../../src/services/taprooting/phase-timeline';

function allLaunchKeysAchieved(): Set<string> {
  return new Set(LAUNCH_PHASE_ITEMS.map((i) => milestoneKeyFor('launch', i.key)));
}

describe('buildPhasedTimeline (§13.3)', () => {
  it('phase 2 (licensing) starts locked when phase 1 is incomplete — never unlocked by elapsed time', () => {
    const { phases } = buildPhasedTimeline(new Set(), new Map(), 'UNLICENSED');
    const launch = phases.find((p) => p.key === 'launch')!;
    const licensing = phases.find((p) => p.key === 'licensing')!;
    expect(launch.unlocked).toBe(true);
    expect(launch.complete).toBe(false);
    expect(licensing.unlocked).toBe(false);
  });

  it('phase 2 unlocks ONLY once every phase-1 item is achieved — no partial unlock', () => {
    const allButOne = allLaunchKeysAchieved();
    const missing = milestoneKeyFor('launch', LAUNCH_PHASE_ITEMS[0].key);
    allButOne.delete(missing);
    const { phases: stillLocked } = buildPhasedTimeline(allButOne, new Map(), 'UNLICENSED');
    expect(stillLocked.find((p) => p.key === 'licensing')!.unlocked).toBe(false);

    const { phases: unlocked } = buildPhasedTimeline(allLaunchKeysAchieved(), new Map(), 'UNLICENSED');
    const launch = unlocked.find((p) => p.key === 'launch')!;
    const licensing = unlocked.find((p) => p.key === 'licensing')!;
    expect(launch.complete).toBe(true);
    expect(licensing.unlocked).toBe(true);
  });

  it('insurance hard-block is active for EVERY non-LICENSED state, not merely during phase 2 (§0.4 rule 2 — conservative)', () => {
    const unlicensed = buildPhasedTimeline(new Set(), new Map(), 'UNLICENSED');
    const preLicensing = buildPhasedTimeline(new Set(), new Map(), 'PRE_LICENSING');
    const expired = buildPhasedTimeline(new Set(), new Map(), 'LICENSE_EXPIRED');
    expect(unlicensed.insuranceHardBlockActive).toBe(true);
    expect(preLicensing.insuranceHardBlockActive).toBe(true);
    expect(expired.insuranceHardBlockActive).toBe(true);
  });

  it('insurance hard-block clears once the rep is fully LICENSED', () => {
    const licensed = buildPhasedTimeline(new Set(), new Map(), 'LICENSED');
    expect(licensed.insuranceHardBlockActive).toBe(false);
  });

  it('every licensing-phase item has a stable, namespaced milestone key', () => {
    for (const item of LICENSING_PHASE_ITEMS) {
      expect(milestoneKeyFor('licensing', item.key)).toBe(`wp08_timeline_licensing_${item.key}`);
    }
  });
});

describe('buildPhasedTimelineResult (§17.1 org-gating)', () => {
  it('the universal branch gets ZERO phases — the Primerica phased timeline is fully invisible', () => {
    const result = buildPhasedTimelineResult('universal', allLaunchKeysAchieved(), new Map(), 'LICENSED');
    expect(result.phases).toEqual([]);
    expect(result.insuranceHardBlockActive).toBe(false);
  });

  it('the Primerica branch renders both phases', () => {
    const result = buildPhasedTimelineResult('primerica', new Set(), new Map(), 'UNLICENSED');
    expect(result.phases).toHaveLength(2);
  });
});
