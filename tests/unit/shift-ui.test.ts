// T-34 (uiux §5.3 "The Shift", master-spec §9.7 "the two ratios") — renders the real Shift
// components with react-dom/server (same convention as tests/unit/ritual-ui.test.ts /
// tests/unit/onboarding-ui.test.ts) and scans their output for the load-bearing contracts:
//   (c) INVISIBLE-SCORE CHECK (inverted): the ratio headline number is NEVER rendered alone — every
//       card renders its title + explainer alongside the digits, and the "learning your community"
//       qualifier when the spec's threshold isn't met (§9.9-7 — unlike the Readiness Score
//       elsewhere in this codebase, which IS hidden, §5.4 AC-5.4-4);
//   AC-5.3-1: exactly one Work card renders at a time, with a progress-dots row sized to the stack;
//   AC-5.3-2: the timer's rendered markup (class names) is IDENTICAL at 5s and at 5000s — proving no
//       alarm/overtime styling branch exists anywhere in this component, by construction;
//   AC-5.3-3: the Close/Done flow reaches the exact "You're done for today." string;
//   AC-5.3-5: the reflection controls render as two EQUAL-WEIGHT buttons (identical class), never a
//       primary/ghost pairing that would make "skip" feel like a lesser choice.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import RatioCard from '@/app/shift/components/RatioCard';
import OpenPhase from '@/app/shift/components/OpenPhase';
import WorkPhase, { formatElapsed } from '@/app/shift/components/WorkPhase';
import ClosePhase from '@/app/shift/components/ClosePhase';
import DoneScreen from '@/app/shift/components/DoneScreen';
import type { RatioCardView, ShiftQueueCard } from '@/types/learning-state';

const render = (el: any, props: Record<string, unknown>) => renderToStaticMarkup(createElement(el, props));
/** Visible text only (tags/attrs stripped) — digit checks must reflect what the rep actually SEES. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&[a-z]+;/g, ' ');
const noop = () => {};

// ─── (c) Ratio cards: never a naked number ─────────────────────────────────────────────────────────

describe('(c) RatioCard — the headline is never rendered alone', () => {
  test('LEARNING (below threshold): baseline headline + explainer + "learning your community" label all present together', () => {
    const view: RatioCardView = {
      headline: [20, 5, 1],
      isBaseline: true,
      learningLabel: 'learning your community',
      explainer: "Your Agent's Ratio measures how effective your AI agents are.",
      status: 'LEARNING',
      dataPointCount: 3,
    };
    const html = render(RatioCard, { title: "Agent's Ratio", view });
    const text = textOf(html);
    expect(text).toMatch(/20 : 5 : 1/);
    expect(text).toMatch(/learning your community/);
    expect(text).toMatch(/measures how effective your AI agents are/);
  });

  test('SHIFTED (established): no learning label, but the explainer is STILL present — the number is never bare', () => {
    const view: RatioCardView = {
      headline: [11, 3, 2],
      isBaseline: false,
      learningLabel: null,
      explainer: 'Your own record: 55 introductions.',
      status: 'SHIFTED',
      dataPointCount: 55,
    };
    const html = render(RatioCard, { title: "Agent's Ratio", view });
    const text = textOf(html);
    expect(text).not.toMatch(/learning your community/);
    expect(text).toMatch(/11 : 3 : 2/);
    expect(text).toMatch(/Your own record/); // explainer always renders, headline never stands alone
  });

  test('the OpenPhase screen renders BOTH ratio cards together', () => {
    const view: RatioCardView = {
      headline: [20, 5, 1],
      isBaseline: true,
      learningLabel: 'learning your community',
      explainer: 'explainer text',
      status: 'LEARNING',
      dataPointCount: 0,
    };
    const html = render(OpenPhase, {
      briefingLines: ['Line one.', 'Line two.', 'Line three.', 'Line four (should be capped)'],
      motivationalLine: 'Show up today.',
      streakCount: 3,
      graceDayOffer: false,
      mode: 'STANDARD',
      learningState: { agentRatio: view, fieldTrainerRatio: view, computedAt: 'x' },
      onBegin: noop,
    });
    const text = textOf(html);
    expect(text).toMatch(/Agent.{1,2}s Ratio/);
    expect(text).toMatch(/Field Trainer.{1,2}s Ratio/);
    // Briefing recap is capped at 3 lines (uiux §5.3 "3 lines max").
    expect(text).toMatch(/Line one/);
    expect(text).toMatch(/Line three/);
    expect(text).not.toMatch(/Line four/);
  });

  test('the grace-day banner surfaces automatically when offered, with no "ask" wording', () => {
    const view: RatioCardView = {
      headline: [20, 5, 1],
      isBaseline: true,
      learningLabel: 'learning your community',
      explainer: 'x',
      status: 'LEARNING',
      dataPointCount: 0,
    };
    const html = render(OpenPhase, {
      briefingLines: [],
      motivationalLine: 'x',
      streakCount: 4,
      graceDayOffer: true,
      mode: 'STANDARD',
      learningState: { agentRatio: view, fieldTrainerRatio: view, computedAt: 'x' },
      onBegin: noop,
    });
    expect(textOf(html)).toMatch(/grace day used/i);
  });
});

// ─── AC-5.3-1: exactly one card at a time ───────────────────────────────────────────────────────────

describe('AC-5.3-1: WorkPhase renders exactly ONE card at a time', () => {
  const stack: ShiftQueueCard[] = [
    { id: 'card-1', type: 'APPROVE_DRAFT', title: 'FIRST CARD TITLE', detail: 'first', estimateMinutes: 1 },
    { id: 'card-2', type: 'APPROVE_DRAFT', title: 'SECOND CARD TITLE', detail: 'second', estimateMinutes: 1 },
    { id: 'card-3', type: 'CONFIRM_APPOINTMENT', title: 'THIRD CARD TITLE', detail: 'third', estimateMinutes: 1 },
  ];

  test('only the top-of-stack card title/detail renders; the rest exist only as progress dots', () => {
    const html = render(WorkPhase, { stack, elapsedSeconds: 90, onAction: noop, onSaveAndLeave: noop });
    const text = textOf(html);
    expect(text).toMatch(/FIRST CARD TITLE/);
    expect(text).not.toMatch(/SECOND CARD TITLE/);
    expect(text).not.toMatch(/THIRD CARD TITLE/);
    expect((html.match(/role="listitem"/g) ?? []).length).toBe(3); // one dot per stack item
  });

  test('an empty stack renders no card at all', () => {
    const html = render(WorkPhase, { stack: [], elapsedSeconds: 0, onAction: noop, onSaveAndLeave: noop });
    expect((html.match(/role="listitem"/g) ?? []).length).toBe(0);
  });
});

// ─── AC-5.3-2: the timer counts up, tabular, and NEVER alarms/reds out — proven structurally ───────

describe('AC-5.3-2: the shift timer never renders an alarm/overtime state', () => {
  const stack: ShiftQueueCard[] = [{ id: 'c1', type: 'APPROVE_DRAFT', title: 't', detail: 'd', estimateMinutes: 1 }];

  test('formatElapsed always renders mm:ss, including past 30 minutes (1800s) and beyond', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65)).toBe('1:05');
    expect(formatElapsed(1800)).toBe('30:00'); // passing 30 minutes changes nothing about the FORMAT
    expect(formatElapsed(7325)).toBe('122:05');
  });

  test('TEETH: the timer\'s rendered class attribute is IDENTICAL at 5 seconds and at 5000 seconds — no time-keyed styling branch exists', () => {
    const htmlEarly = render(WorkPhase, { stack, elapsedSeconds: 5, onAction: noop, onSaveAndLeave: noop });
    const htmlLate = render(WorkPhase, { stack, elapsedSeconds: 5000, onAction: noop, onSaveAndLeave: noop });
    const classOf = (html: string) => html.match(/data-testid="shift-timer"[^>]*class="([^"]*)"/)?.[1] ?? html.match(/class="([^"]*)"[^>]*data-testid="shift-timer"/)?.[1];
    expect(classOf(htmlEarly)).toBeTruthy();
    expect(classOf(htmlEarly)).toBe(classOf(htmlLate));
  });
});

// ─── AC-5.3-3: the explicit "You're done for today" state ──────────────────────────────────────────

describe('AC-5.3-3: the Close/Done flow reaches the explicit end state', () => {
  test('DoneScreen renders the exact "You\'re done for today." string', () => {
    const html = render(DoneScreen, { streakCount: 7, onBackToToday: noop });
    expect(textOf(html)).toMatch(/You.{1,2}re done for today\./);
    expect(textOf(html)).toMatch(/7-day streak/);
  });

  test('ClosePhase celebrates an early finish, and says nothing at all about overtime', () => {
    const html = render(ClosePhase, {
      recap: { approvals: 4, confirmations: 1, logs: 0 },
      elapsedSeconds: 22 * 60,
      targetSeconds: 30 * 60,
      onFinish: noop,
    });
    const text = textOf(html);
    expect(text).toMatch(/approved 4 introductions/);
    expect(text).toMatch(/beat your own plan/);
  });

  test('ClosePhase over target: no celebration line, and — critically — no guilt/overtime wording either', () => {
    const html = render(ClosePhase, {
      recap: { approvals: 1, confirmations: 0, logs: 0 },
      elapsedSeconds: 45 * 60,
      targetSeconds: 30 * 60,
      onFinish: noop,
    });
    const text = textOf(html);
    expect(text).not.toMatch(/beat your own plan/);
    expect(text).not.toMatch(/over.?time/i);
    expect(text).not.toMatch(/late/i);
  });

  test('an empty-queue day recaps honestly ("your field is working"), still reachable from Close', () => {
    const html = render(ClosePhase, { recap: null, elapsedSeconds: 0, targetSeconds: 1800, onFinish: noop });
    expect(textOf(html)).toMatch(/your field is working/);
  });
});

// ─── AC-5.3-5: reflection is optional, EQUAL weight ────────────────────────────────────────────────

describe('AC-5.3-5: the reflection input is optional with an equal-weight skip', () => {
  test('"Save & finish" and "Skip" render as two buttons with the IDENTICAL class (equal visual weight)', () => {
    const html = render(ClosePhase, { recap: null, elapsedSeconds: 0, targetSeconds: 1800, onFinish: noop });
    const buttonClasses = Array.from(html.matchAll(/<button[^>]*class="([^"]*)"[^>]*>/g)).map((m) => m[1]);
    expect(buttonClasses.length).toBe(2);
    expect(buttonClasses[0]).toBe(buttonClasses[1]);
  });
});
