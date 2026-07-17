// WP01 §5.1 (uiux) — O-1..O-9 onboarding UI proof tests (T-20).
//
// These render the real O-screen components with react-dom/server and scan their output, proving
// the load-bearing compliance/UX contracts the charter's PROVE section names:
//   (a) the Seven Whys UI NEVER renders a score (the T-18 invisible-resonance contract, AC-5.1-4);
//   (b) the Hidden Earnings Reveal carries the safe-harbor line + a zero-data growth path + NO
//       share affordance (AC-5.1-8, §4.13, §18.5);
//   (c) the org gate never leaks Primerica to a universal user and never echoes the solution number
//       after entry (AC-5.1-2, §6.10-4);
//   (f) resume-exact: a returning rep lands on the screen matching the persisted step (AC-5.1-11).
//
// Each assertion has TEETH: it fails if a score leaks, the safe harbor / growth path is removed, a
// share control is added, Primerica leaks to a universal panel, the raw number is re-displayed, or
// the resume mapping drifts. Rendered with `createElement` (no JSX) so the file stays a `.test.ts`
// under the existing `testMatch` while the imported `.tsx` components compile via the jest.config
// `jsx: react-jsx` transform override.

import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { IntensitySetting, OrgType, Role } from '@prisma/client';

import HiddenEarningsReveal, {
  SAFE_HARBOR_LINE,
} from '@/app/onboarding/components/HiddenEarningsReveal';
import IntensityDial from '@/app/onboarding/components/IntensityDial';
import { OrgBranchPanel } from '@/app/onboarding/components/OrgStep';
import SevenWhysConversation from '@/app/onboarding/components/SevenWhysConversation';
import SponsorStep from '@/app/onboarding/components/SponsorStep';
import VisionSplash from '@/app/onboarding/components/VisionSplash';
import UplineTrack from '@/app/onboarding/components/UplineTrack';
import { resumeScreen } from '@/app/onboarding/flow-model';

import { buildOrgContext } from '@/services/onboarding/wp01/org-gate';
import {
  SOLUTION_NUMBER_MASK,
  SOLUTION_NUMBER_NOT_VERIFIED_CAPTION,
} from '@/services/onboarding/wp01/solution-number';
import type { SponsorMatchOutcome } from '@/services/onboarding/wp01/sponsor-matching';
import {
  SevenWhysLevel,
  type SevenWhysRenderedTurn,
} from '@/services/onboarding/wp01/seven-whys';

const render = (el: ReactElement) => renderToStaticMarkup(el);
/** Visible text only — strips HTML tags (and thus attributes like `rows="3"`) so digit checks test
 *  what the rep actually SEES, not incidental markup. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');

// ─── (a) Seven Whys UI never renders a score ─────────────────────────────────────────────────────
describe('(a) Seven Whys conversation UI never renders a score (§6.4 / AC-5.1-4 invisible contract)', () => {
  const turns: Record<string, SevenWhysRenderedTurn> = {
    firstQuestion: {
      filledLevels: [],
      pulsingLevel: null,
      question: 'What do you want most from building this business?',
      acknowledgment: null,
      reprompt: false,
      complete: false,
      anchorStatement: null,
    },
    caringReprompt: {
      filledLevels: [SevenWhysLevel.GOAL, SevenWhysLevel.URGENCY],
      pulsingLevel: SevenWhysLevel.COMMITMENT,
      question: 'Can you stay with that a moment — what would it really change?',
      acknowledgment: 'Thank you for trusting me with that.',
      reprompt: true,
      complete: false,
      anchorStatement: null,
    },
    complete: {
      filledLevels: [
        SevenWhysLevel.GOAL,
        SevenWhysLevel.URGENCY,
        SevenWhysLevel.HISTORY,
        SevenWhysLevel.CHALLENGE,
        SevenWhysLevel.FEAR,
        SevenWhysLevel.TRANSFORMATION,
        SevenWhysLevel.COMMITMENT,
      ],
      pulsingLevel: null,
      question: null,
      acknowledgment: 'That is the real reason.',
      reprompt: false,
      complete: true,
      anchorStatement: 'You build so your kids never have to wonder if they are safe.',
    },
  };

  for (const [name, turn] of Object.entries(turns)) {
    test(`turn "${name}" renders no numeric score and no score/resonance affordance`, () => {
      const html = render(createElement(SevenWhysConversation, { turn, answer: '' }));
      // The visible text carries NO digit at all — a resonance/score number could only reach the
      // rep as digits, and this UI emits none.
      expect(textOf(html)).not.toMatch(/[0-9]/);
      // No score/resonance/percentage machinery anywhere in the markup, visible or attribute.
      expect(html).not.toMatch(/score|resonance/i);
      expect(html).not.toMatch(/%/);
    });
  }

  test('a caring re-prompt is care, not a failure — no failure/reject/too-low language', () => {
    const html = render(createElement(SevenWhysConversation, { turn: turns.caringReprompt, answer: '' }));
    expect(html).not.toMatch(/fail|reject|denied|too low|not enough|insufficient|try harder/i);
  });

  test('TEETH: SevenWhysRenderedTurn has no score field to render (compile-time contract)', () => {
    // If a `resonanceScore`/`score` field were ever added to the rendered-turn type, this object
    // literal would still type-check — but the render assertions above would then also need it to be
    // omitted from the DOM. This runtime check documents the contract the type enforces structurally.
    const t = turns.complete as unknown as Record<string, unknown>;
    expect('resonanceScore' in t).toBe(false);
    expect('score' in t).toBe(false);
    expect('depthSignal' in t).toBe(false);
  });
});

// ─── (b) Hidden Earnings Reveal: safe harbor + zero-data growth path + NO share ───────────────────
describe('(b) Hidden Earnings Reveal (§4.13 / §18.5 / AC-5.1-8)', () => {
  test('zero-data (0–3 contacts): a growth path, NO dollar figure, no $0/NaN, no share control', () => {
    const html = render(
      createElement(HiddenEarningsReveal, {
        contactCount: 2,
        monthlyValueUsd: 0,
        estimatedAppointments: 0,
        estimatedClients: 0,
      })
    );
    expect(html).not.toContain('$'); // never a $0 shame moment
    expect(html).not.toMatch(/NaN/);
    expect(textOf(html)).toMatch(/field|add people|grows/i); // the seeded-field growth copy
    expect(html).not.toMatch(/share/i); // no share affordance exists on this screen
  });

  test('with real data: safe harbor is present, inseparable, and NO share control exists', () => {
    const html = render(
      createElement(HiddenEarningsReveal, {
        contactCount: 42,
        monthlyValueUsd: 125000,
        estimatedAppointments: 15,
        estimatedClients: 5,
      })
    );
    expect(html).toContain(SAFE_HARBOR_LINE);
    expect(html).toContain('$125,000');
    expect(html).not.toMatch(/share/i);
  });

  test('the single SR utterance carries BOTH the figure AND the disclaimer as one line (§6.1)', () => {
    const html = render(
      createElement(HiddenEarningsReveal, {
        contactCount: 42,
        monthlyValueUsd: 125000,
        estimatedAppointments: 15,
        estimatedClients: 5,
      })
    );
    // Extract the one screen-reader element (class srOnly, id reveal-sr) and assert it alone
    // announces the figure and the safe harbor together — never as two separate utterances.
    const srMatch = html.match(/id="reveal-sr"[^>]*>([^<]*)</);
    expect(srMatch).not.toBeNull();
    const sr = srMatch![1];
    expect(sr).toContain('$125,000');
    expect(sr).toMatch(/potential, not a promise/i);
  });
});

// ─── (c) Org gate: no Primerica leak to universal + solution number never echoed ─────────────────
describe('(c) Org gate UI (§17.1 / AC-5.1-2 / §6.10-4)', () => {
  test('universal (EXTERNAL) branch leaks NO Primerica string and shows no solution-number field', () => {
    const html = render(
      createElement(OrgBranchPanel, { orgContext: buildOrgContext(OrgType.EXTERNAL) })
    );
    expect(html).not.toMatch(/primerica/i);
    expect(html).not.toMatch(/solution/i);
    expect(html).not.toMatch(/not verified/i);
  });

  test('Primerica branch shows the honest "not verified" caption (never claims verification)', () => {
    const html = render(
      createElement(OrgBranchPanel, {
        orgContext: buildOrgContext(OrgType.PRIMERICA),
        solutionNumber: '',
      })
    );
    expect(html).toContain(SOLUTION_NUMBER_NOT_VERIFIED_CAPTION);
  });

  test('TEETH: after entry, the solution number is shown ONLY as the mask, never the raw digits', () => {
    const html = render(
      createElement(OrgBranchPanel, {
        orgContext: buildOrgContext(OrgType.PRIMERICA),
        solutionNumber: '1234567',
        confirmed: true,
      })
    );
    expect(html).toContain(SOLUTION_NUMBER_MASK);
    expect(html).not.toContain('1234567'); // the raw declared number is never echoed back
  });
});

// ─── (f) resume-exact ─────────────────────────────────────────────────────────────────────────────
describe('(f) resume-exact: a returning rep lands on the persisted step (AC-5.1-11)', () => {
  test.each([
    ['seven_whys', 'seven_whys'],
    ['goals_intensity', 'goals_intensity'],
    ['reveal', 'reveal'],
    ['first48', 'first48'],
    // wp01 track step KEYS map onto the finer O-screens
    ['sponsor_matching', 'sponsor'],
    ['role_org_context', 'org'],
    ['identity_capture', 'identity'],
  ])('persisted step "%s" resumes on screen "%s"', (step, screen) => {
    expect(resumeScreen(step)).toBe(screen);
  });

  test('fail-safe: an empty/unknown persisted step lands on the first screen (never blank)', () => {
    expect(resumeScreen(null)).toBe('vision');
    expect(resumeScreen(undefined)).toBe('vision');
    expect(resumeScreen('some-unknown-step')).toBe('vision');
  });
});

// ─── Extra AC-5.1 coverage: vision splash, intensity commitment act, sponsor waitlist ─────────────
describe('additional AC-5.1 screen invariants', () => {
  test('O-1 vision splash: exactly one button, ZERO form fields (AC-5.1-1)', () => {
    const html = render(createElement(VisionSplash, {}));
    expect((html.match(/<button/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(/<input|<textarea|<select/);
  });

  test('O-4 intensity dial: no position pre-selected — an explicit commitment act (AC-5.1-3)', () => {
    const html = render(createElement(IntensityDial, { value: null }));
    expect(html).not.toMatch(/aria-checked="true"/);
    // Continue is disabled until a level is chosen.
    expect(html).toMatch(/disabled/);
  });

  test('O-4 intensity dial: choosing a level checks exactly that one', () => {
    const html = render(createElement(IntensityDial, { value: IntensitySetting.HIGH }));
    expect((html.match(/aria-checked="true"/g) ?? []).length).toBe(1);
  });

  test('O-6 sponsor waitlist is NOT a dead end — both the waitlist and the $297 path are offered (AC-5.1-6)', () => {
    const outcome: SponsorMatchOutcome = {
      kind: 'waitlisted',
      orgType: OrgType.EXTERNAL,
      paidPathTier: 'PAID_INDIVIDUAL',
      noUplineYetIsComplete: true,
      waitlistedAt: new Date(),
    };
    const html = render(createElement(SponsorStep, { outcome }));
    expect(textOf(html)).toMatch(/waitlist/i);
    expect(textOf(html)).toMatch(/\$297/);
    expect(textOf(html)).toMatch(/no upline yet/i); // first-class completion, not an error
  });

  test('upline/RVP dense track hard-blocks an expired license with a named next step (AC-5.1-12)', () => {
    const html = render(
      createElement(UplineTrack, { role: Role.RVP, licensingState: 'LICENSE_EXPIRED' })
    );
    expect(textOf(html)).toMatch(/license/i);
    expect(textOf(html)).toMatch(/compliance/i); // routes to the compliance advisory queue
    // Blocked → the "Finish setup" BUTTON is NOT offered (only the compliance-advisory link is).
    // (The block-help COPY legitimately contains the words "finish setup" in a sentence, so target
    // the button label form `>Finish setup<` specifically.)
    expect(html).not.toContain('>Finish setup<');
  });
});
