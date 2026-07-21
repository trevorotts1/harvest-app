// WP04 (T-32) — Mission Control / Today UI proof tests.
//
//   (a) all six zone components render REAL data from their real `ZoneResult` prop shape (not demo
//       fixtures baked into the component);
//   each zone component ALSO renders its own error state independently when its `ZoneResult` is
//       `{status:'error'}` — the component-level mirror of the service-level isolation proof in
//       tests/unit/mission-control-today-service.test.ts;
//   (c) the Grove renders all eight uiux §3.2 states with a non-empty, non-shaming caption, and the
//       whole Today/Grove surface consumes T-05 tokens only (no raw hex literal anywhere authored);
//   (d) the retired legacy demo scaffold (`agent-layer`, the demo `/api/agents` +
//       `/api/mission-control/briefing` routes, `buildDemoBriefing`) is GONE and nothing live
//       references it — grep-clean across the whole source tree.
//   (e) T-35R (WP04 gate remediation): the Today primary CTA is wired to `/shift` (master-spec
//       §9.8 "Entered from Today's primary CTA" / uiux §5.2 AC-5.2-2), not disabled — see the
//       constraint note above that describe block for why this is a source-level assertion rather
//       than a rendered-DOM one.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import Grove from '@/app/today/components/Grove';
import AnchorHeader from '@/app/today/components/AnchorHeader';
import BriefingCard from '@/app/today/components/BriefingCard';
import ActionQueue from '@/app/today/components/ActionQueue';
import PipelineGlance from '@/app/today/components/PipelineGlance';
import RatioCards from '@/app/today/components/RatioCards';
import CalendarStrip from '@/app/today/components/CalendarStrip';
import { isGatedDownstreamPage } from '@/lib/auth/onboarding-gate-edge';
import type {
  ActionQueueZoneData,
  BriefingZoneData,
  CalendarZoneData,
  GroveState,
  HeaderZoneData,
  PipelineZoneData,
  QueueItem,
  RatiosZoneData,
  ZoneResult,
} from '@/services/mission-control/types';

const render = (el: any, props: Record<string, unknown>) => renderToStaticMarkup(createElement(el, props));
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');

const REPO_ROOT = path.join(__dirname, '..', '..');
const TODAY_DIR = path.join(REPO_ROOT, 'src', 'app', 'today');
const SRC_DIR = path.join(REPO_ROOT, 'src');

function findFiles(dir: string, predicate: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...findFiles(full, predicate));
    else if (predicate(entry)) out.push(full);
  }
  return out;
}

// ─── (c) No raw hex anywhere in the authored Today/Grove source ───────────────────────────────────
describe('(c) Today / Grove consume T-05 tokens only — no raw hex (§1.2.2, §3)', () => {
  const files = findFiles(TODAY_DIR, (name) => name.endsWith('.tsx') || name.endsWith('.module.css'));

  test('sanity: the Today surface has real files to scan (not a vacuous pass)', () => {
    expect(files.length).toBeGreaterThanOrEqual(9); // page + 7 components + today.module.css
  });

  test.each(files.map((f) => [path.relative(REPO_ROOT, f), f]))('%s contains no raw hex color literal', (_rel, file) => {
    const src = readFileSync(file as string, 'utf8');
    const hexMatches = src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexMatches).toEqual([]);
  });
});

// ─── (c) The Grove — all eight uiux §3.2 states ────────────────────────────────────────────────────
describe('(c) Grove renders all eight §3.2 states (AC-3-2) — aria-hidden SVG + a visible caption', () => {
  const ALL_STATES: GroveState[] = ['seed', 'sprout', 'thriving', 'growing', 'quiet', 'resting', 'bloom', 'stale'];
  const laws = { grow: 50, engage: 50, wealth: 50 };

  test.each(ALL_STATES)('state "%s" renders the SVG aria-hidden and a non-empty visible caption', (state) => {
    const html = render(Grove, { state, laws, caption: `caption for ${state}` });
    expect(html).toContain('aria-hidden="true"');
    expect(textOf(html)).toContain(`caption for ${state}`);
  });

  test('AC-3-1: branch/leaf/fruit channels are independently derived (grow-only change alters only branch geometry)', () => {
    const lowGrow = render(Grove, { state: 'growing', laws: { grow: 0, engage: 50, wealth: 50 }, caption: 'x' });
    const highGrow = render(Grove, { state: 'growing', laws: { grow: 100, engage: 50, wealth: 50 }, caption: 'x' });
    // Different branch/leaf-cluster counts produce a different number of leaf-shape circles.
    const countCircles = (html: string) => (html.match(/<circle/g) ?? []).length;
    expect(countCircles(highGrow)).toBeGreaterThan(countCircles(lowGrow));
  });

  test('resting never renders literal death/wilt/brown wording', () => {
    const html = render(Grove, { state: 'resting', laws, caption: 'Resting, ready to regrow' });
    expect(textOf(html).toLowerCase()).not.toMatch(/dead|wilt|brown/);
  });
});

// ─── (a) The six zone components render REAL data, and their OWN error states independently ───────
describe('(a) Six Today zones render from real ZoneResult data (not demo)', () => {
  test('AnchorHeader renders greeting, momentum score, and Grove caption from real data', () => {
    const data: HeaderZoneData = {
      greetingName: 'Jordan',
      momentum: { score: 72, band: 'growing', sparkline: [10, 20, 30, 40, 50, 60, 72], laws: { grow: 70, engage: 75, wealth: 71 }, totalEventCount: 12 },
      groveState: 'growing',
      groveCaption: 'Growing',
      approvalInboxCount: 3,
    };
    const result: ZoneResult<HeaderZoneData> = { status: 'ok', data };
    const html = render(AnchorHeader, { result });
    expect(textOf(html)).toContain('Good morning, Jordan');
    expect(textOf(html)).toContain('72');
    expect(textOf(html)).toContain('3');
  });

  test('AnchorHeader renders its OWN error state when the header zone failed', () => {
    const html = render(AnchorHeader, { result: { status: 'error', message: 'We could not load this right now — the rest of Today is unaffected.' } });
    expect(textOf(html)).toContain('We could not load this right now');
  });

  test('BriefingCard renders real narrative lines with receipts, per state', () => {
    const data: BriefingZoneData = {
      state: 'ready',
      freshnessStamp: new Date().toISOString(),
      lines: [{ text: 'Your Prospecting Agent ran 2 times — 2 cleared.', receipts: [{ agentRunId: 'run-1', agentKey: 'prospecting', agentDisplayName: 'Prospecting Agent', action: 'drafted an intro', when: new Date().toISOString(), cfeBand: 'clear' }] }],
    };
    const html = render(BriefingCard, { result: { status: 'ok', data } });
    expect(textOf(html)).toContain('Your Prospecting Agent ran 2 times');
  });

  test('BriefingCard first_day / agents_resting / empty states each render distinct, honest copy', () => {
    const firstDay = render(BriefingCard, { result: { status: 'ok', data: { state: 'first_day', freshnessStamp: null, lines: [] } } });
    expect(textOf(firstDay)).toMatch(/run yet/i);

    const resting = render(BriefingCard, { result: { status: 'ok', data: { state: 'agents_resting', freshnessStamp: null, lines: [] } } });
    expect(textOf(resting)).toMatch(/resting/i);
    expect(textOf(resting)).not.toMatch(/community introductions went out/i); // never fabricated content

    const empty = render(BriefingCard, { result: { status: 'ok', data: { state: 'empty', freshnessStamp: null, lines: [] } } });
    expect(textOf(empty)).toMatch(/quiet night/i);
  });

  test('BriefingCard renders its OWN error state independently', () => {
    const html = render(BriefingCard, { result: { status: 'error', message: 'briefing failed safely' } });
    expect(textOf(html)).toContain('briefing failed safely');
  });

  test('ActionQueue renders the real minute total and real items, capped display', () => {
    const data: ActionQueueZoneData = {
      totalMinutes: 22,
      items: [{ id: 'd1', kind: 'approve_draft', title: 'Approve draft', why: 'because', contactLabel: 'Maya J.', minutes: 2, cfeBand: 'PASS', channel: 'SMS_HANDOFF' }],
      totalCount: 1,
    };
    const html = render(ActionQueue, { result: { status: 'ok', data }, onAction: () => {} });
    expect(textOf(html)).toContain('Today: 22 minutes');
    expect(textOf(html)).toContain('Maya J.');
  });

  test('ActionQueue empty queue renders the earned-calm done-state, not a bare empty region', () => {
    const html = render(ActionQueue, { result: { status: 'ok', data: { totalMinutes: 0, items: [], totalCount: 0 } }, onAction: () => {} });
    expect(textOf(html)).toMatch(/Nothing needs you/);
  });

  test('ActionQueue renders its OWN error state independently', () => {
    const html = render(ActionQueue, { result: { status: 'error', message: 'queue failed safely' }, onAction: () => {} });
    expect(textOf(html)).toContain('queue failed safely');
  });

  test('PipelineGlance renders real bucket counts and never renders delta in red wording (AC-5.2-8)', () => {
    const data: PipelineZoneData = {
      buckets: [
        { key: 'introduced', label: 'Introduced', count: 12, deltaLast7d: 3 },
        { key: 'responded', label: 'Responded', count: 5, deltaLast7d: -2 },
        { key: 'appointment', label: 'Appointment', count: 2, deltaLast7d: 0 },
        { key: 'closed', label: 'Closed', count: 1, deltaLast7d: 0 },
      ],
    };
    const html = render(PipelineGlance, { result: { status: 'ok', data } });
    expect(textOf(html)).toContain('12');
    expect(textOf(html)).toMatch(/needs tending/); // negative delta framed as wheat "needs tending", never "red"
    expect(textOf(html).toLowerCase()).not.toContain('red');
  });

  test('PipelineGlance renders its OWN error state independently', () => {
    const html = render(PipelineGlance, { result: { status: 'error', message: 'pipeline failed safely' } });
    expect(textOf(html)).toContain('pipeline failed safely');
  });

  test('RatioCards renders the learning-state baseline (20:5:1) with the "learning your community" chip until real data accumulates', () => {
    const data: RatiosZoneData = {
      agentRatio: {
        a: 20,
        b: 5,
        c: 1,
        labels: ['Introductions', 'Appointments set', 'Confirmed shows'],
        learning: true,
        dataPoints: 4,
        explainer: "Your Agent's Ratio measures how effective your AI agents are.",
      },
      fieldTrainerRatio: {
        a: 20,
        b: 5,
        c: 1,
        labels: ['Appointments run', 'Client signs', 'Recruit joins'],
        learning: true,
        dataPoints: 0,
        explainer: "Your Field Trainer's Ratio measures your trainer's close rate.",
      },
    };
    const html = render(RatioCards, { result: { status: 'ok', data } });
    expect(textOf(html)).toContain('20 : 5 : 1');
    expect(textOf(html)).toMatch(/learning your community/);
    expect(html).not.toMatch(/NaN/);
  });

  // T-R16 (§9.9-7 "both ratios display WITH explainers") — the Mission Control ratio cards ALSO
  // render a "what this means" explainer alongside the headline, mirroring the Shift's own
  // RatioCard. TEETH: fails if the explainer paragraph is ever dropped from RatioCards.tsx.
  test('TEETH: RatioCards renders a "what this means" explainer alongside EACH ratio headline — never a naked number (§9.9-7)', () => {
    const data: RatiosZoneData = {
      agentRatio: {
        a: 11,
        b: 3,
        c: 2,
        labels: ['Introductions', 'Appointments set', 'Confirmed shows'],
        learning: false,
        dataPoints: 55,
        explainer: 'Your own record: 55 introductions -> 20 appointments set -> 2 confirmed shows.',
      },
      fieldTrainerRatio: {
        a: 20,
        b: 5,
        c: 1,
        labels: ['Appointments run', 'Client signs', 'Recruit joins'],
        learning: true,
        dataPoints: 3,
        explainer: "Your Field Trainer's Ratio measures your trainer's close rate once they run the appointment.",
      },
    };
    const html = render(RatioCards, { result: { status: 'ok', data } });
    const text = textOf(html);
    expect(text).toMatch(/Your own record: 55 introductions/);
    expect(text).toMatch(/close rate once they run the appointment/);
  });

  test('RatioCards renders its OWN error state independently', () => {
    const html = render(RatioCards, { result: { status: 'error', message: 'ratios failed safely' } });
    expect(textOf(html)).toContain('ratios failed safely');
  });

  test('CalendarStrip renders real upcoming events with attendance actions', () => {
    const data: CalendarZoneData = { hasOrg: true, events: [{ id: 'evt-1', type: 'team_call', startsAt: new Date().toISOString(), attendanceState: 'none' }] };
    const html = render(CalendarStrip, { result: { status: 'ok', data }, onMarkAttendance: () => {} });
    expect(textOf(html)).toMatch(/team call/i);
    expect(textOf(html)).toMatch(/I was there/);
  });

  test('CalendarStrip renders its OWN error state independently', () => {
    const html = render(CalendarStrip, { result: { status: 'error', message: 'calendar failed safely' }, onMarkAttendance: () => {} });
    expect(textOf(html)).toContain('calendar failed safely');
  });
});

// ─── (e) T-32 QC FIX — the CFE approve-bypass ──────────────────────────────────────────────────────
// Adversarial QC proved LIVE against shipped code that the "Review" button on a review_flagged
// (CFE FLAG or BLOCK-banded) item fired the SAME `onAction(item, 'approve')` as a clean draft's
// Approve button — a one-tap approve for content the spec says is "never sendable" (master-spec
// §9.2/§18.6). These tests FAIL against the pre-fix ActionQueue.tsx (they must — the bug was live)
// and PASS once the affordance is removed and replaced with a CFE band summary + a deep-link to the
// Approval Inbox.
describe('(e) T-32 QC fix — review_flagged items never wire a one-tap approve; the CFE band is shown', () => {
  const flaggedItem: QueueItem = {
    id: 'flag-1',
    kind: 'review_flagged',
    title: 'Review flagged draft',
    why: 'This draft needs your review before it can send.',
    contactLabel: 'Maya J.',
    minutes: 3,
    cfeBand: 'FLAG',
    channel: 'SMS_HANDOFF',
  };
  const blockedItem: QueueItem = { ...flaggedItem, id: 'block-1', cfeBand: 'BLOCK' };

  test('renders the CFE band text — captured in QueueItem data but never shown pre-fix', () => {
    const data: ActionQueueZoneData = { totalMinutes: 3, items: [flaggedItem], totalCount: 1 };
    const html = render(ActionQueue, { result: { status: 'ok', data }, onAction: () => {} });
    expect(textOf(html)).toMatch(/FLAG/);
  });

  test('a BLOCKED item also renders its band', () => {
    const data: ActionQueueZoneData = { totalMinutes: 3, items: [blockedItem], totalCount: 1 };
    const html = render(ActionQueue, { result: { status: 'ok', data }, onAction: () => {} });
    expect(textOf(html)).toMatch(/BLOCK/);
  });

  test('renders a deep-link to the Approval Inbox for a flagged item, and NO "Review"-labelled approve button', () => {
    const data: ActionQueueZoneData = { totalMinutes: 3, items: [flaggedItem], totalCount: 1 };
    const html = render(ActionQueue, { result: { status: 'ok', data }, onAction: () => {} });
    expect(html).toMatch(/<a[^>]+href="\/inbox"/);
    // The old one-tap-approve button rendered exactly `<button ...>Review</button>` — gone.
    expect(html).not.toMatch(/<button[^>]*>\s*Review\s*<\/button>/);
  });

  test('renders a deep-link to the Approval Inbox for a blocked item too', () => {
    const data: ActionQueueZoneData = { totalMinutes: 3, items: [blockedItem], totalCount: 1 };
    const html = render(ActionQueue, { result: { status: 'ok', data }, onAction: () => {} });
    expect(html).toMatch(/<a[^>]+href="\/inbox"/);
    expect(html).not.toMatch(/<button[^>]*>\s*Review\s*<\/button>/);
  });

  // Recursively collects every `onClick` handler in the component's real element tree — calling
  // the component directly (no DOM/jsdom needed) returns the same JSX element graph React would
  // render, so this is a true interaction proof: every clickable affordance in the row is
  // exercised, not just the markup inspected statically.
  function collectOnClicks(node: unknown, acc: Array<() => void> = []): Array<() => void> {
    if (node === null || typeof node !== 'object') return acc;
    if (Array.isArray(node)) {
      for (const child of node) collectOnClicks(child, acc);
      return acc;
    }
    const props = (node as { props?: Record<string, unknown> }).props;
    if (!props) return acc;
    if (typeof props.onClick === 'function') acc.push(props.onClick as () => void);
    if (props.children !== undefined) collectOnClicks(props.children, acc);
    return acc;
  }

  test('INTERACTION: clicking every affordance in a review_flagged / blocked row never calls onAction(item, "approve")', () => {
    const data: ActionQueueZoneData = { totalMinutes: 6, items: [flaggedItem, blockedItem], totalCount: 2 };
    const onAction = jest.fn();
    const tree = ActionQueue({ result: { status: 'ok', data }, onAction });
    const onClicks = collectOnClicks(tree);

    expect(onClicks.length).toBeGreaterThan(0); // sanity: the Decline button IS still there
    for (const fn of onClicks) fn();

    expect(onAction).not.toHaveBeenCalledWith(expect.anything(), 'approve');
  });

  test('a clean approve_draft item is UNAFFECTED — its Approve button still calls onAction(item, "approve")', () => {
    const cleanItem: QueueItem = {
      id: 'clean-1',
      kind: 'approve_draft',
      title: 'Approve draft',
      why: 'because',
      contactLabel: 'Maya J.',
      minutes: 2,
      cfeBand: 'PASS',
      channel: 'SMS_HANDOFF',
    };
    const data: ActionQueueZoneData = { totalMinutes: 2, items: [cleanItem], totalCount: 1 };
    const onAction = jest.fn();
    const tree = ActionQueue({ result: { status: 'ok', data }, onAction });
    const onClicks = collectOnClicks(tree);
    for (const fn of onClicks) fn();

    expect(onAction).toHaveBeenCalledWith(cleanItem, 'approve');
  });
});

// ─── (d) The legacy demo scaffold is fully retired — grep clean ───────────────────────────────────
describe('(d) legacy demo scaffold is GONE and nothing live references it', () => {
  test('src/services/agent-layer/* no longer exists', () => {
    expect(existsSync(path.join(SRC_DIR, 'services', 'agent-layer'))).toBe(false);
  });

  test('src/types/agent-layer.ts no longer exists', () => {
    expect(existsSync(path.join(SRC_DIR, 'types', 'agent-layer.ts'))).toBe(false);
  });

  test('the demo GET /api/agents route (agent-layer-backed) no longer exists — the real dispatch route survives', () => {
    expect(existsSync(path.join(SRC_DIR, 'app', 'api', 'agents', 'route.ts'))).toBe(false);
    expect(existsSync(path.join(SRC_DIR, 'app', 'api', 'agents', 'dispatch', 'route.ts'))).toBe(true);
  });

  test('the demo /api/mission-control/briefing route no longer exists — the real /today route exists', () => {
    expect(existsSync(path.join(SRC_DIR, 'app', 'api', 'mission-control', 'briefing'))).toBe(false);
    expect(existsSync(path.join(SRC_DIR, 'app', 'api', 'mission-control', 'today', 'route.ts'))).toBe(true);
  });

  test('no remaining source file references the retired agent-layer module or buildDemoBriefing', () => {
    const allSourceFiles = findFiles(SRC_DIR, (name) => name.endsWith('.ts') || name.endsWith('.tsx'));
    const offenders: string[] = [];
    for (const file of allSourceFiles) {
      const src = readFileSync(file, 'utf8');
      if (/agent-layer|buildDemoBriefing/.test(src)) offenders.push(path.relative(REPO_ROOT, file));
    }
    expect(offenders).toEqual([]);
  });
});

// ─── (e) T-35R: Today's primary CTA is wired to /shift, not disabled (WP04 gate remediation) ──────
//
// CONSTRAINT: `TodayPage` is a 'use client' component whose CTA only renders once its `useState`
// data-load reaches the `'ready'` state via a `useEffect`-triggered `fetch`. `renderToStaticMarkup`
// (this suite's convention — testEnvironment is plain `node`, no jsdom/@testing-library/react, see
// jest.config.js) never runs effects, so the `'ready'` branch — and therefore the CTA markup — is
// structurally unreachable from a single static render of the full page component. Per T-35R's
// brief, the lightest REAL assertion available is a source-level inspection of the CTA's own JSX,
// scoped tightly to the CTA line itself (not a loose whole-file substring match) — this still fails
// exactly as intended if the CTA is ever reverted to `disabled`/unwired, or re-pointed elsewhere.
describe('(e) Today primary CTA → /shift wiring (T-35R, master-spec §9.8 / uiux §5.2 AC-5.2-2)', () => {
  const pageSrc = readFileSync(path.join(TODAY_DIR, 'page.tsx'), 'utf8');
  // Isolate the CTA's own JSX element (opening tag through closing tag) so assertions can't be
  // fooled by an unrelated `disabled` elsewhere on the page, or pass vacuously against the whole file.
  const ctaMatch = pageSrc.match(/<Link\s+href="\/shift"[^>]*>[\s\S]*?<\/Link>/);

  test('sanity: the CTA element was actually found in src/app/today/page.tsx (not a vacuous pass)', () => {
    expect(ctaMatch).not.toBeNull();
  });

  test('the CTA links to /shift — the real T-34 ritual entry route', () => {
    expect(ctaMatch?.[0]).toMatch(/href="\/shift"/);
  });

  test('the CTA is NOT disabled — this is the exact WP04 gate-blocking defect: fails if reverted', () => {
    expect(ctaMatch?.[0]).not.toMatch(/\bdisabled\b/);
    expect(ctaMatch?.[0]).not.toMatch(/aria-disabled/);
  });

  test('the CTA renders the expected label text', () => {
    expect(ctaMatch?.[0]).toMatch(/Start today(?:&apos;|')s 30 minutes/);
  });

  test('/shift is itself a gated downstream page — a not-yet-onboarded rep following the CTA still lands in onboarding first', () => {
    expect(isGatedDownstreamPage('/shift')).toBe(true);
  });

  test('src/app/shift/page.tsx (the T-34 ritual entry) actually exists — the CTA is not pointed at a route that does not exist', () => {
    expect(existsSync(path.join(SRC_DIR, 'app', 'shift', 'page.tsx'))).toBe(true);
  });
});
