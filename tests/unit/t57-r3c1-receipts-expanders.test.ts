// T-57 R3c-1 (MAJOR-D4, uiux AC-4-10/AC-5.2-3) — Ratios + the Action Queue minute-total lacked a
// receipts expander. Both now reuse the AnchorHeader/BriefingCard chevron+receipts pattern, but as
// a native `<details>/<summary>` disclosure — required because `ActionQueue` is ALSO called as a
// PLAIN FUNCTION by this file's own pre-existing INTERACTION tests (mission-control-ui.test.ts),
// where a `useState` hook would crash (confirmed by that file's own `locale` prop doc comment).
// `<details>` needs no hook at all and is keyboard/SR-operable by the browser's native semantics.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ActionQueue from '@/app/today/components/ActionQueue';
import RatioCards from '@/app/today/components/RatioCards';
import type { ActionQueueZoneData, RatiosZoneData, ZoneResult } from '@/services/mission-control/types';

describe('T-57 R3c-1 — ActionQueue.tsx: a real receipts expander over the minute total', () => {
  const result: ZoneResult<ActionQueueZoneData> = {
    status: 'ok',
    data: {
      totalMinutes: 22,
      items: [
        { id: 'd1', kind: 'approve_draft', title: 'Approve draft', why: 'because', contactLabel: 'Maya J.', minutes: 12, cfeBand: 'PASS', channel: 'SMS_HANDOFF' },
        { id: 'd2', kind: 'confirm_appointment', title: 'Confirm time', why: 'because', contactLabel: 'Sam R.', minutes: 10, cfeBand: 'PASS', channel: 'SMS_HANDOFF' },
      ],
      totalCount: 2,
    },
  };

  test('RED (pre-fix) would be: no <details> disclosure at all, no per-item breakdown reachable', () => {
    const html = renderToStaticMarkup(createElement(ActionQueue, { result, onAction: () => {} }));
    expect(html).toMatch(/<details/);
  });

  test('the exact minute-total badge text is UNCHANGED — still visible, now inside <summary>', () => {
    const html = renderToStaticMarkup(createElement(ActionQueue, { result, onAction: () => {} }));
    expect(html.replace(/<[^>]*>/g, ' ')).toContain('Today: 22 minutes');
  });

  test('the expander reveals each real item — title, contact, and its own minutes — never fabricated', () => {
    const html = renderToStaticMarkup(createElement(ActionQueue, { result, onAction: () => {} }));
    const text = html.replace(/<[^>]*>/g, ' ');
    expect(text).toContain('Approve draft');
    expect(text).toContain('Maya J.');
    expect(text).toMatch(/12 min/);
    expect(text).toContain('Confirm time');
    expect(text).toMatch(/10 min/);
  });

  test('this component is STILL callable as a plain function (no hook crash) — the raw-call INTERACTION test pattern survives', () => {
    // Mirrors mission-control-ui.test.ts's own INTERACTION tests: a plain function call, not
    // renderToStaticMarkup. If <details>/<summary> had been implemented with useState instead,
    // this would throw "Invalid hook call" immediately.
    expect(() => ActionQueue({ result, onAction: () => {} })).not.toThrow();
  });
});

describe('T-57 R3c-1 — RatioCards.tsx: a real receipts expander over each ratio (dataPoints + breakdown)', () => {
  const result: ZoneResult<RatiosZoneData> = {
    status: 'ok',
    data: {
      agentRatio: { a: 55, b: 20, c: 2, labels: ['Introductions', 'Appointments set', 'Confirmed shows'], learning: false, dataPoints: 37, explainer: 'Your own record.' },
      fieldTrainerRatio: { a: 20, b: 5, c: 1, labels: ['Introductions', 'Appointments', 'Shows'], learning: true, dataPoints: 4, explainer: "Learning your trainer's rate." },
    },
  };

  test('RED (pre-fix) would be: the explainer alone, no <details> receipts disclosure anywhere', () => {
    const html = renderToStaticMarkup(createElement(RatioCards, { result }));
    expect(html).toMatch(/<details/);
  });

  test('the mandatory "what this means" explainer STAYS always-visible (TEETH: mission-control-ui.test.ts asserts this unconditionally)', () => {
    const html = renderToStaticMarkup(createElement(RatioCards, { result }));
    const text = html.replace(/&#x27;/g, "'");
    expect(text).toContain('Your own record.');
    expect(text).toContain("Learning your trainer's rate.");
  });

  test('the expander reveals the REAL a/b/c breakdown against its own labels', () => {
    const html = renderToStaticMarkup(createElement(RatioCards, { result }));
    const text = html.replace(/<[^>]*>/g, ' ');
    expect(text).toMatch(/Introductions:\s*55/);
    expect(text).toMatch(/Appointments set:\s*20/);
    expect(text).toMatch(/Confirmed shows:\s*2/);
  });

  test('the expander reveals the REAL dataPoints count, never previously rendered anywhere', () => {
    const html = renderToStaticMarkup(createElement(RatioCards, { result }));
    expect(html).toMatch(/37/);
    expect(html).toMatch(/4/);
  });

  test('the error state is unaffected (still renders its own independent error text)', () => {
    const html = renderToStaticMarkup(createElement(RatioCards, { result: { status: 'error', message: 'ratios failed safely' } }));
    expect(html).toContain('ratios failed safely');
    expect(html).not.toMatch(/<details/);
  });
});
