// T-57 R3c-1 (BLOCKER-E1, uiux §5.4 "Entry: /ritual/warm-market from Grow, from the phased
// timeline ... or from a Today queue suggestion"). `/ritual/warm-market` had ZERO inbound nav
// anywhere before this fix. This proves all three entry points are real and reachable.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import PhasedTimelinePanel from '@/app/grow/components/PhasedTimelinePanel';
import ActionQueue from '@/app/today/components/ActionQueue';
import type { PhasedTimelineResult } from '@/types/taprooting';
import type { ActionQueueZoneData, ZoneResult } from '@/services/mission-control/types';

const REPO_ROOT = path.join(__dirname, '..', '..');

function src(...parts: string[]): string {
  return readFileSync(path.join(REPO_ROOT, ...parts), 'utf8');
}

// ─── Entry point 1: Grow (grow/page.tsx) — source-level (the page fetches via useEffect; its
// ready state, where the entry card renders, is unreachable from a synchronous static render). ──
describe('T-57 R3c-1 — entry point 1: Grow (grow/page.tsx) links to /ritual/warm-market', () => {
  test('an unconditional (not branch-gated) link to /ritual/warm-market exists in grow/page.tsx', () => {
    const page = src('src', 'app', 'grow', 'page.tsx');
    expect(page).toMatch(/href="\/ritual\/warm-market"/);
  });
});

// ─── Entry point 2: the phased timeline (PhasedTimelinePanel.tsx) — rendered, real props. ────────
describe('T-57 R3c-1 — entry point 2: the phased timeline links to /ritual/warm-market while days 1-7 are incomplete', () => {
  const onMarkAttested = async () => true;
  const onPreviewInsuranceBlock = async () => ({ released: true, hardBlockActive: false, licensingState: 'LICENSED' });

  function timeline(launchComplete: boolean): PhasedTimelineResult {
    return {
      branch: 'primerica',
      phases: [
        {
          key: 'launch',
          label: 'Launch (Days 1-7)',
          complete: launchComplete,
          unlocked: true,
          items: [{ key: 'item-1', label: 'Do the thing', done: launchComplete, detectionMode: 'auto', achievedAt: null }],
        },
      ],
      insuranceHardBlockActive: false,
      licensingState: 'LICENSED',
    } as unknown as PhasedTimelineResult;
  }

  test('renders a real /ritual/warm-market link while the launch phase (days 1-7) is incomplete', () => {
    const html = renderToStaticMarkup(
      createElement(PhasedTimelinePanel, { timeline: timeline(false), onMarkAttested, onPreviewInsuranceBlock })
    );
    expect(html).toMatch(/href="\/ritual\/warm-market"/);
  });

  test('the entry point is hidden once the launch phase is complete (its purpose is served)', () => {
    const html = renderToStaticMarkup(
      createElement(PhasedTimelinePanel, { timeline: timeline(true), onMarkAttested, onPreviewInsuranceBlock })
    );
    expect(html).not.toMatch(/href="\/ritual\/warm-market"/);
  });

  test('the universal (non-Primerica) branch — an empty phases array — renders nothing at all, unaffected', () => {
    const universalTimeline: PhasedTimelineResult = {
      branch: 'universal',
      phases: [],
      insuranceHardBlockActive: false,
      licensingState: 'LICENSED',
    } as unknown as PhasedTimelineResult;
    const html = renderToStaticMarkup(
      createElement(PhasedTimelinePanel, { timeline: universalTimeline, onMarkAttested, onPreviewInsuranceBlock })
    );
    expect(html).toBe('');
  });
});

// ─── Entry point 3: a Today queue suggestion (ActionQueue.tsx empty state). §8.3 "the queue
// populates once the 3 ritual layers complete" — the empty state is the single most common reason
// to nudge toward the ritual that fills it. Also carries M3's own Memory Jogger suggestion. ──────
describe('T-57 R3c-1 — entry point 3: Today\'s empty Action Queue suggests the Warm-Market ritual', () => {
  test('an empty queue renders a real link to /ritual/warm-market (not just the earned-calm narrative)', () => {
    const result: ZoneResult<ActionQueueZoneData> = { status: 'ok', data: { totalMinutes: 0, items: [], totalCount: 0 } };
    const html = renderToStaticMarkup(createElement(ActionQueue, { result, onAction: () => {} }));
    expect(html).toMatch(/href="\/ritual\/warm-market"/);
    // AC-5.2 "earned-calm done-state" narrative is unchanged, additive only.
    expect(html).toMatch(/Nothing needs you/);
  });

  test('MAJOR-M3: the same empty state also links to the new Memory Jogger (/community/jogger)', () => {
    const result: ZoneResult<ActionQueueZoneData> = { status: 'ok', data: { totalMinutes: 0, items: [], totalCount: 0 } };
    const html = renderToStaticMarkup(createElement(ActionQueue, { result, onAction: () => {} }));
    expect(html).toMatch(/href="\/community\/jogger"/);
  });

  test('a non-empty queue does NOT render the ritual/jogger suggestions (they are the zero-state\'s own affordance)', () => {
    const result: ZoneResult<ActionQueueZoneData> = {
      status: 'ok',
      data: {
        totalMinutes: 5,
        items: [{ id: 'd1', kind: 'approve_draft', title: 'x', why: 'y', contactLabel: 'A B.', minutes: 5, cfeBand: 'PASS', channel: 'SMS_HANDOFF' }],
        totalCount: 1,
      },
    };
    const html = renderToStaticMarkup(createElement(ActionQueue, { result, onAction: () => {} }));
    expect(html).not.toMatch(/href="\/ritual\/warm-market"/);
    expect(html).not.toMatch(/href="\/community\/jogger"/);
  });
});
