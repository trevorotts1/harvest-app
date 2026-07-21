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

import { createElement, type ElementType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import RatioCard from '@/app/shift/components/RatioCard';
import OpenPhase from '@/app/shift/components/OpenPhase';
import WorkPhase, { formatElapsed } from '@/app/shift/components/WorkPhase';
import ClosePhase, { recapLine } from '@/app/shift/components/ClosePhase';
import DoneScreen from '@/app/shift/components/DoneScreen';
import type { RatioCardView, ShiftQueueCard } from '@/types/learning-state';

const render = (el: ElementType, props: Record<string, unknown>) => renderToStaticMarkup(createElement(el, props));
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
  // Non-draft card types here (title/detail render generically) — the draft-backed
  // APPROVE_DRAFT/RESPOND_FLAGGED rendering path is covered on its own below (T-R13).
  const stack: ShiftQueueCard[] = [
    { id: 'card-1', type: 'CONFIRM_APPOINTMENT', title: 'FIRST CARD TITLE', detail: 'first', estimateMinutes: 1 },
    { id: 'card-2', type: 'MARK_ATTENDANCE', title: 'SECOND CARD TITLE', detail: 'second', estimateMinutes: 1 },
    { id: 'card-3', type: 'LOG_INTRODUCTION', title: 'THIRD CARD TITLE', detail: 'third', estimateMinutes: 1 },
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

// ─── T-R13: APPROVE_DRAFT / RESPOND_FLAGGED cards embed T-33's real ApprovalInboxItem ─────────────
// Replaces the old deep-link-to-`/inbox` stopgap (T-34 QC fix D2) with the actual approve-with-
// inline-edit component (uiux §5.3 "embedded full-width") — see WorkPhase.tsx / DraftApprovalCard.tsx
// and ShiftApprovalRequiresReviewError's doc comment in shift.service.ts for the full rationale.
// The fail-closed authority these tests prove against is now `ApprovalInboxItem`'s OWN render rule
// (no Approve while `approval_state === 'HELD'`) plus `ShiftService.actionCard`'s unchanged
// server-side check — NOT a WorkPhase-local `cfeOutcome !== 'PASS'` gate, which no longer exists.

function draftCard(
  id: string,
  overrides: Partial<Omit<ShiftQueueCard, 'draft'>> & { approvalState?: string } = {}
): ShiftQueueCard {
  const { approvalState, ...cardOverrides } = overrides;
  return {
    id,
    type: 'APPROVE_DRAFT',
    title: 'Approve a draft',
    detail: 'body',
    estimateMinutes: 1,
    cfeOutcome: 'PASS',
    draft: {
      contactId: 'contact-1',
      contact: { firstName: 'Maya', lastName: 'Jordan' },
      channel: 'SMS_HANDOFF',
      cfeRiskScore: 3,
      approvalState: approvalState ?? 'PENDING',
      createdAt: '2026-07-18T08:00:00.000Z',
    },
    ...cardOverrides,
  };
}

describe('T-R13: draft cards embed the real ApprovalInboxItem — the old /inbox deep-link stopgap is gone', () => {
  test('the deep-link stopgap no longer exists anywhere in WorkPhase\'s output, for any draft card', () => {
    const stack: ShiftQueueCard[] = [draftCard('any-1', { cfeOutcome: 'FLAG' })];
    const html = render(WorkPhase, { stack, elapsedSeconds: 10, onAction: noop, onSaveAndLeave: noop });
    expect(html).not.toMatch(/href="\/inbox"/);
    expect(textOf(html)).not.toMatch(/Review in Approval Inbox/);
  });

  test('a FLAG (still-PENDING) draft embeds the real item — CFE chip visible, and Approve/Edit/Decline all present (uiux "approve-with-inline-edit")', () => {
    const stack: ShiftQueueCard[] = [
      draftCard('flag-1', { type: 'RESPOND_FLAGGED', title: 'Respond to a flagged draft', cfeOutcome: 'FLAG' }),
    ];
    const html = render(WorkPhase, { stack, elapsedSeconds: 10, onAction: noop, onSaveAndLeave: noop });
    const text = textOf(html);

    expect(text).toMatch(/Flagged/); // ApprovalInboxItem's own CFE chip label
    expect(text).toMatch(/\bApprove\b/);
    expect(text).toMatch(/\bEdit\b/);
    expect(text).toMatch(/\bDecline\b/);
    expect(text).toMatch(/Later today/); // skip is still offered alongside the embedded card
  });

  test('TEETH: a HELD draft (blocked verdict) — the ONE state with no recovery path — never renders an Approve button; only the compliant-rewrite/discard affordances', () => {
    const stack: ShiftQueueCard[] = [
      draftCard('held-1', {
        type: 'RESPOND_FLAGGED',
        title: 'Respond to a flagged draft',
        cfeOutcome: 'BLOCK',
        approvalState: 'HELD',
      }),
    ];
    const html = render(WorkPhase, { stack, elapsedSeconds: 10, onAction: noop, onSaveAndLeave: noop });
    const text = textOf(html);

    expect(html).not.toMatch(/<button[^>]*>\s*Approve\s*<\/button>/);
    expect(text).toMatch(/cannot be approved as-is/i); // ApprovalInboxItem's held banner
    expect(text).toMatch(/Discard/);
  });

  test('a clean PASS draft still gets the normal one-tap Approve — the common case renders exactly as before', () => {
    const stack: ShiftQueueCard[] = [draftCard('clean-1', { cfeOutcome: 'PASS' })];
    const html = render(WorkPhase, { stack, elapsedSeconds: 10, onAction: noop, onSaveAndLeave: noop });
    const text = textOf(html);

    expect(text).toMatch(/\bApprove\b/);
    expect(html).not.toMatch(/href="\/inbox"/);
  });

  test('Later today (skip) still renders alongside the embedded card — skip is not gated', () => {
    const stack: ShiftQueueCard[] = [draftCard('c1')];
    const html = render(WorkPhase, { stack, elapsedSeconds: 10, onAction: noop, onSaveAndLeave: noop });
    expect(textOf(html)).toMatch(/Later today/);
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

  // T-52 (WCAG 2.2 AA §17.4 / uiux §6.1 item 5) — "The Shift close" narration script, verbatim:
  // "You're done for today. {recap line}. Your agents take it from here." Previously split across
  // TWO separate screens (ClosePhase showed the recap, then DoneScreen showed only "You're done for
  // today." + streak) and never combined into one announced utterance.
  test('DoneScreen carries the combined "Shift close" narration script when a recap is supplied', () => {
    const recap = { approvals: 2, confirmations: 1, logs: 0 };
    const html = render(DoneScreen, { streakCount: 7, recap, onBackToToday: noop });
    const text = textOf(html);
    expect(text).toContain(`You’re done for today. ${recapLine(recap)}`);
    expect(text).toMatch(/Your agents take it from here\./);
  });

  test('DoneScreen falls back to the honest "nothing needed you" recap when no recap is supplied', () => {
    const html = render(DoneScreen, { streakCount: 1, onBackToToday: noop });
    expect(textOf(html)).toContain('Nothing needed you today — your field is working.');
  });

  test('DoneScreen keeps "Back to your day" independently focusable/operable (not nested inside the aria-hidden visual group)', () => {
    const html = render(DoneScreen, { streakCount: 7, recap: { approvals: 1, confirmations: 0, logs: 0 }, onBackToToday: noop });
    // the button markup must not sit inside the `aria-hidden="true"` wrapper — a naive
    // implementation could accidentally hide the one interactive control on this screen.
    const ariaHiddenBlock = html.match(/<div aria-hidden="true">[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(ariaHiddenBlock).not.toContain('Back to your day');
    expect(html).toContain('Back to your day');
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
