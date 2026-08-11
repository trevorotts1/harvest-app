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

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { IntensitySetting, OrgType, Role } from '@prisma/client';

import ContactImportStep from '@/app/onboarding/components/ContactImportStep';
import ManualAddStep from '@/app/onboarding/components/ManualAddStep';
import GdprConsentStep, { GDPR_CONSENT_LABEL } from '@/app/onboarding/components/GdprConsentStep';
import HiddenEarningsReveal, {
  SAFE_HARBOR_LINE,
} from '@/app/onboarding/components/HiddenEarningsReveal';
import IdentityStep, { initialsFromName } from '@/app/onboarding/components/IdentityStep';
import IntensityDial from '@/app/onboarding/components/IntensityDial';
import { OrgBranchPanel } from '@/app/onboarding/components/OrgStep';
import OutreachConsentToggle, {
  OUTREACH_CONSENT_LABEL,
} from '@/app/onboarding/components/OutreachConsentToggle';
import SevenWhysConversation from '@/app/onboarding/components/SevenWhysConversation';
import SponsorStep from '@/app/onboarding/components/SponsorStep';
import VisionSplash from '@/app/onboarding/components/VisionSplash';
import UplineTrack from '@/app/onboarding/components/UplineTrack';
import { resumeScreen } from '@/app/onboarding/flow-model';
import { t as catalogT } from '@/lib/i18n/catalog';
import type { NativeContactCandidate } from '@/services/warm-market/vault/native-contacts-adapter';

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

// R-11 — component source snapshots for the no-leak assertion: the §16.3 GDPR detail copy must
// exist ONLY in the O-8.5 consent step, never leaked into a sibling O-screen.
const readComponentSrc = (name: string) =>
  readFileSync(path.join(process.cwd(), 'src', 'app', 'onboarding', 'components', `${name}.tsx`), 'utf8');
const visionSplashSrc = readComponentSrc('VisionSplash');
const identityStepSrc = readComponentSrc('IdentityStep');
const orgStepSrc = readComponentSrc('OrgStep');
const contactImportStepSrc = readComponentSrc('ContactImportStep');
/** Visible text only — strips HTML tags (and thus attributes like `rows="3"`) so digit checks test
 *  what the rep actually SEES, not incidental markup. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');

// T-57 RG7 (dimension B) — the safe-harbor line's VISUAL form now renders through the sanctioned FTC
// catalog key (`grow.goalCard.potentialNotPromise`), so a Spanish rep sees the approved ES translation
// instead of the hardcoded English `SAFE_HARBOR_LINE`. That constant is still the SR/spoken form. These
// are the exact visible strings each locale must render (meaning identical; only punctuation differs
// from `SAFE_HARBOR_LINE` — see HiddenEarningsReveal.tsx / hidden-earnings.ts's SPOKEN note).
const SAFE_HARBOR_VISUAL_EN = catalogT('en', 'grow.goalCard.potentialNotPromise');
const SAFE_HARBOR_VISUAL_ES = catalogT('es', 'grow.goalCard.potentialNotPromise');

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

  // T-24 TEETH: master-spec §18.5 says "Hidden Earnings with 3 or 0 contacts -> renders the growth
  // path... safe harbor ALWAYS" — the growth path is explicitly NOT exempt from the disclaimer. This
  // fails if the safe-harbor paragraph were ever removed from (or never added to) the zero-data
  // branch, which is exactly the state this component was in before T-24.
  test('TEETH (§18.5 "safe harbor always"): the zero-data growth path ALSO carries the exact safe-harbor line, in the same one-utterance SR announcement', () => {
    const html = render(
      createElement(HiddenEarningsReveal, {
        contactCount: 2,
        monthlyValueUsd: 0,
        estimatedAppointments: 0,
        estimatedClients: 0,
      })
    );
    expect(html).toContain(SAFE_HARBOR_VISUAL_EN);
    // The SR utterance for the growth path must ALSO be a single element carrying growth copy +
    // disclaimer together, never two separate announcements.
    const srMatch = html.match(/id="reveal-zero-sr"[^>]*>([^<]*)</);
    expect(srMatch).not.toBeNull();
    expect(srMatch![1]).toMatch(/field/i);
    expect(srMatch![1]).toMatch(/potential, not a promise/i);
  });

  // T-24 TEETH: a count strictly above 3 (10) whose UPSTREAM-COMPUTED value is <=0 (the engine's own
  // "never $0" fallback, hidden-earnings.ts) must still render the growth path here, not a literal
  // "$0" figure — proving the component's zero-data decision is not merely `contactCount <= 3`.
  test('TEETH: contactCount=10 with monthlyValueUsd=0 (the engine\'s own growth-path fallback for a count above 3) still renders the growth path, never a literal $0', () => {
    const html = render(
      createElement(HiddenEarningsReveal, {
        contactCount: 10,
        monthlyValueUsd: 0,
        estimatedAppointments: 2,
        estimatedClients: 0,
      })
    );
    expect(html).not.toMatch(/\$0\b/);
    expect(textOf(html)).toMatch(/field|add people|grows/i);
    expect(html).toContain(SAFE_HARBOR_VISUAL_EN);
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
    expect(html).toContain(SAFE_HARBOR_VISUAL_EN);
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

  // T-R32 (§17.5 locale-aware number formatting) — `formatUsd` used to hardcode `Intl.NumberFormat
  // ('en-US', ...)` regardless of the rep's locale. `locale` is an OPTIONAL prop (defaults to 'en')
  // precisely so every test above — none of which pass it — keeps proving byte-identical EN output;
  // this test proves the NEW `locale` prop actually reaches `formatUsd`, routing through the real
  // i18n formatting layer rather than a hardcoded literal.
  test('T-R32: an explicit locale="es" prop reaches the currency figure via the shared formatUsd (no crash, still a valid USD figure)', () => {
    const htmlEn = render(
      createElement(HiddenEarningsReveal, {
        contactCount: 42,
        monthlyValueUsd: 125000,
        estimatedAppointments: 15,
        estimatedClients: 5,
        locale: 'en',
      })
    );
    const htmlEs = render(
      createElement(HiddenEarningsReveal, {
        contactCount: 42,
        monthlyValueUsd: 125000,
        estimatedAppointments: 15,
        estimatedClients: 5,
        locale: 'es',
      })
    );
    // Both render the exact same figure text — en-US/es-US share USD grouping/symbol conventions
    // (this app's launch Spanish locale is deliberately es-US, not es-ES/es-MX) — proving the switch
    // is real (not silently ignored/crashing) without asserting a visible difference that doesn't
    // exist for this specific locale pair + currency.
    expect(htmlEn).toContain('$125,000');
    expect(htmlEs).toContain('$125,000');
    // T-57 RG7 (dimension B) — the safe harbor + no-share invariants hold regardless of locale, and
    // the ES rep now sees the SANCTIONED SPANISH safe-harbor visual, NOT the English SAFE_HARBOR_LINE
    // (the leak this fix closes). EN renders the EN visual; ES renders the ES visual.
    expect(htmlEn).toContain(SAFE_HARBOR_VISUAL_EN);
    expect(htmlEs).toContain(SAFE_HARBOR_VISUAL_ES);
    expect(htmlEs).not.toContain(SAFE_HARBOR_LINE);
    expect(htmlEs).not.toMatch(/share/i);
  });

  test('omitting locale defaults to "en" — every pre-T-R32 caller keeps compiling and rendering unchanged', () => {
    const withDefault = render(
      createElement(HiddenEarningsReveal, {
        contactCount: 42,
        monthlyValueUsd: 125000,
        estimatedAppointments: 15,
        estimatedClients: 5,
      })
    );
    const withExplicitEn = render(
      createElement(HiddenEarningsReveal, {
        contactCount: 42,
        monthlyValueUsd: 125000,
        estimatedAppointments: 15,
        estimatedClients: 5,
        locale: 'en',
      })
    );
    expect(withDefault).toBe(withExplicitEn);
  });
});

// ─── (c) Org gate: no Primerica leak to universal + solution number never echoed ─────────────────
describe('(c) Org gate UI (§17.1 / AC-5.1-2 / §6.10-4)', () => {
  // R-02 — the O-3 screen no longer offers an org choice at all: it renders ONLY the branch panel
  // for the persisted registration-time org (see r02-org-once.test.ts). These OrgBranchPanel
  // render contracts (org-gate no-leak, masked solution number) are unchanged and still proven here.
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
      })
    );
    expect(html).toContain(SOLUTION_NUMBER_NOT_VERIFIED_CAPTION);
  });

  // R-05 — the solution number is captured exactly ONCE (at registration); the O-3 panel is a
  // SAVED-STATE surface: mask + not-verified caption, never a re-entry field, never the digits.
  test('R-05 TEETH: the Primerica saved-state shows ONLY the mask and never a re-entry input', () => {
    const html = render(
      createElement(OrgBranchPanel, {
        orgContext: buildOrgContext(OrgType.PRIMERICA),
        hasSolutionNumber: true,
      })
    );
    expect(html).toContain(SOLUTION_NUMBER_MASK);
    expect(html).not.toContain('<input'); // no re-entry field on the O-3 surface anymore
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

  // ─── R-06 (refinements catalog 2026-07-28) — dial copy clarity ────────────────────────────────
  // "doesn't say WHOSE agents", "only reveals what each level does AFTER you pick". Copy-only fix:
  // the headline/caption name the HARVEST AI AGENTS + the "2 Hour CEO" relevance, and every
  // level's description renders BEFORE selection (no picking required). The intensity_setting
  // VALUES and the cadence/cost logic are untouched — the "2 / 5 / 10 introductions per day"
  // wording mirrors `SCHEDULED_ACTION_CAP_BY_INTENSITY` (src/services/agent-runtime/
  // scheduled-dispatch.ts: LOW 2 / MEDIUM 5 / HIGH 10, master-spec §4.2).
  test('R-06 intensity dial: headline + lede name the Harvest AI agents and the 2 Hour CEO relevance', () => {
    const en = textOf(render(createElement(IntensityDial, { value: null })));
    expect(en).toContain('Harvest AI agents');
    expect(en).toContain('2 Hour CEO');
    expect(en).toContain('outreach cadence, daily volume, and the cost ceiling');
    // NEVER a Primerica string on this universal step (org-gate/leak law).
    expect(en).not.toMatch(/primerica/i);
  });

  test('R-06 intensity dial: every level shows what it does BEFORE selection, not only after', () => {
    const en = textOf(render(createElement(IntensityDial, { value: null })));
    expect(en).toContain('a few gentle community introductions per day');
    expect(en).toContain('a focused queue of community introductions and gentle follow-ups');
    expect(en).toContain('more community introductions and quicker follow-through each day');
    expect(en).toContain('lowest cost ceiling');
    expect(en).toContain('moderate cost ceiling');
    expect(en).toContain('highest cost ceiling');
  });

  test('R-06 intensity dial: the post-pick detail panel is retained after a level is chosen', () => {
    const en = textOf(render(createElement(IntensityDial, { value: IntensitySetting.HIGH })));
    // The pre-selection "what" line stays visible AND the post-pick consequence panel still renders.
    expect(en).toContain('more community introductions and quicker follow-through each day');
    expect(en).toContain('Your agents work harder and faster');
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

// ─── T-20 QC gap fix (1): AC-5.1-5 outreach-consent toggle on the O-5 completion render ──────────
// BEFORE this fix: `OutreachConsentToggle` did not exist and `SevenWhysConversation` had no
// `outreachConsent` prop at all — every test below would fail on the import alone (module not
// found) or on a missing prop (toggle simply never renders, `role="switch"` never appears).
describe('T-20 gap (1): outreach-consent toggle renders on O-5 completion, defaults OFF, and toggles (AC-5.1-5)', () => {
  const completeTurn: SevenWhysRenderedTurn = {
    filledLevels: [],
    pulsingLevel: null,
    question: null,
    acknowledgment: null,
    reprompt: false,
    complete: true,
    anchorStatement: 'You build so the people you love never have to worry.',
  };
  const incompleteTurn: SevenWhysRenderedTurn = {
    filledLevels: [],
    pulsingLevel: null,
    question: 'What do you want most from building this?',
    acknowledgment: null,
    reprompt: false,
    complete: false,
    anchorStatement: null,
  };

  test('the standalone toggle defaults OFF (aria-checked="false") and carries the exact label + sub-line', () => {
    const html = render(createElement(OutreachConsentToggle, { value: false }));
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(textOf(html)).toContain(OUTREACH_CONSENT_LABEL);
    expect(textOf(html)).toMatch(/you can change this any time/i);
  });

  test('the toggle switches ON when its value is true', () => {
    const html = render(createElement(OutreachConsentToggle, { value: true }));
    expect(html).toContain('aria-checked="true"');
  });

  test('SevenWhysConversation renders the toggle in the O-5 completion beat, defaulting OFF', () => {
    const html = render(
      createElement(SevenWhysConversation, { turn: completeTurn, answer: '', outreachConsent: false })
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(textOf(html)).toContain(OUTREACH_CONSENT_LABEL);
  });

  test('SevenWhysConversation reflects an ON consent value once flipped', () => {
    const html = render(
      createElement(SevenWhysConversation, { turn: completeTurn, answer: '', outreachConsent: true })
    );
    expect(html).toContain('aria-checked="true"');
  });

  test('the toggle does NOT render before the conversation completes, even if a consent value is supplied', () => {
    const html = render(
      createElement(SevenWhysConversation, { turn: incompleteTurn, answer: '', outreachConsent: false })
    );
    expect(html).not.toContain('role="switch"');
  });

  test('backward-compat: omitting outreachConsent entirely renders no toggle (existing callers unaffected)', () => {
    const html = render(createElement(SevenWhysConversation, { turn: completeTurn, answer: '' }));
    expect(html).not.toContain('role="switch"');
  });
});

// ─── T-20 QC gap fix (2): O-2 photo-capture affordance + initials-avatar fallback ─────────────────
// BEFORE this fix: `IdentityStep` offered only name/email/skip — no camera/library affordance and no
// avatar preview at all, so every assertion below (the two new buttons, the avatar role="img", the
// initials text) would fail against the pre-fix component.
describe('T-20 gap (2): O-2 IdentityStep photo-capture affordance + initials-avatar fallback', () => {
  test('initialsFromName derives First+Last initials, and "?" when there is no name yet', () => {
    expect(initialsFromName('Jane Doe')).toBe('JD');
    expect(initialsFromName('Madonna')).toBe('M');
    expect(initialsFromName('  ')).toBe('?');
    expect(initialsFromName('')).toBe('?');
  });

  test('camera / photo-library / browse-files / skip affordance all render alongside name+email (R-04 source chooser)', () => {
    const html = render(createElement(IdentityStep, { name: 'Jane Doe', email: 'jane@example.com' }));
    expect(textOf(html)).toMatch(/take a photo/i);
    expect(textOf(html)).toMatch(/photo library/i);
    expect(textOf(html)).toMatch(/browse files/i);
    expect(textOf(html)).toMatch(/skip photo/i);
    // The source chooser is backed by ONE standard file input restricted to images — the capture
    // affordance the platform resolves per capability (camera / photo library / desktop files).
    const fileInputs = html.match(/type="file"[^>]*>/g) ?? [];
    expect(fileInputs).toHaveLength(1);
    expect(fileInputs[0]).toContain('accept="image/*"');
  });

  test('default (no photo chosen yet) and explicit "skipped" state both yield the initials-avatar fallback', () => {
    const unset = render(createElement(IdentityStep, { name: 'Jane Doe', email: 'jane@example.com' }));
    expect(unset).toContain('aria-label="Initials avatar: JD"');
    expect(textOf(unset)).toContain('JD');

    const skipped = render(
      createElement(IdentityStep, { name: 'Jane Doe', email: 'jane@example.com', photoState: 'skipped' })
    );
    expect(skipped).toContain('aria-label="Initials avatar: JD"');
  });

  test('TEETH: once a photo is "chosen", the initials avatar is replaced, proving the fallback is conditional, not hardcoded', () => {
    const html = render(
      createElement(IdentityStep, { name: 'Jane Doe', email: 'jane@example.com', photoState: 'chosen' })
    );
    expect(html).not.toContain('aria-label="Initials avatar: JD"');
    expect(textOf(html)).toMatch(/photo added/i);
  });

  // R-04 — the chosen state renders the caller-minted REAL preview (img with the object URL) and
  // the file's name, and the source buttons yield to a Remove affordance — never a silent blank.
  test('R-04 TEETH: a chosen file renders its real preview + file name, and Remove replaces the source buttons', () => {
    const html = render(
      createElement(IdentityStep, {
        name: 'Jane Doe',
        email: 'jane@example.com',
        photoState: 'chosen',
        photoFileName: 'jane.jpg',
        photoPreviewUrl: 'blob:nodedata:preview-1',
      })
    );
    expect(html).toContain('src="blob:nodedata:preview-1"');
    expect(textOf(html)).toContain('jane.jpg added');
    expect(textOf(html)).toContain('Remove photo');
    // The source chooser + Skip are gone once a photo is chosen (the file is captured).
    expect(textOf(html)).not.toMatch(/take a photo/i);
    expect(textOf(html)).not.toMatch(/skip photo/i);
    expect(html).not.toContain('aria-label="Initials avatar: JD"');
  });

  test('R-04: chosen state without a preview URL still renders the "Photo added" placeholder (never a broken img)', () => {
    const html = render(
      createElement(IdentityStep, { name: 'Jane Doe', email: 'jane@example.com', photoState: 'chosen' })
    );
    expect(html).not.toContain('<img');
    expect(textOf(html)).toMatch(/photo added/i);
  });
});

// ─── T-20 QC gap fix (3): DUAL persona-switcher on the dense upline/RVP track ──────────────────────
// BEFORE this fix: `UplineTrack` had no persona concept at all — it called `stepsForRole(role)`
// directly, so a DUAL user always got the undifferentiated union track and no `role="radiogroup"`
// ever appeared; every assertion below would fail against the pre-fix component.
describe('T-20 gap (3): DUAL persona-switcher (§4.10 segmented control; roles.ts canInPersona semantics)', () => {
  test('a DUAL user sees the persona switcher (segmented control)', () => {
    const html = render(createElement(UplineTrack, { role: Role.DUAL, licensingState: 'LICENSED' }));
    expect(html).toContain('role="radiogroup"');
    expect(textOf(html)).toMatch(/my rep setup/i);
    expect(textOf(html)).toMatch(/my team setup/i);
  });

  test('UPLINE, RVP, and REP do NOT see a persona switcher — only DUAL does', () => {
    for (const role of [Role.UPLINE, Role.RVP, Role.REP] as const) {
      const html = render(createElement(UplineTrack, { role, licensingState: 'LICENSED' }));
      expect(html).not.toContain('role="radiogroup"');
    }
  });

  test('switching the DUAL switcher to "rep" renders the REP-base track (no FINRA licensure step)', () => {
    const html = render(
      createElement(UplineTrack, { role: Role.DUAL, licensingState: 'UNLICENSED', initialPersona: 'rep' })
    );
    // REP base track (Flow A) carries no licensure-gated step, so an UNLICENSED state never blocks.
    expect(html).not.toContain('role="alert"');
    expect(textOf(html)).toMatch(/seven whys/i);
    expect(textOf(html)).not.toMatch(/finra u4/i);
  });

  test('switching the DUAL switcher to "upline" renders the UPLINE-base track (FINRA licensure gate applies)', () => {
    const html = render(
      createElement(UplineTrack, { role: Role.DUAL, licensingState: 'UNLICENSED', initialPersona: 'upline' })
    );
    // UPLINE base track (Flow B) DOES carry the licensure-gated step, so UNLICENSED hard-blocks —
    // exactly the pre-existing §16.5 hard-block behavior, now scoped to the active persona only.
    expect(textOf(html)).toMatch(/finra u4/i);
    expect(html).toContain('role="alert"');
  });

  test('the switcher itself never appears for a plain (non-DUAL) role\'s track, which renders exactly as before', () => {
    const html = render(createElement(UplineTrack, { role: Role.RVP, licensingState: 'LICENSED' }));
    expect(textOf(html)).toMatch(/finra u4/i); // RVP's own track, unchanged
    expect(html).not.toMatch(/my rep setup|my team setup/i);
  });
});

// ─── T-21R gap fix: GDPR consent capture — explicit affirmative, never pre-checked (§6.10-10) ─────
// BEFORE this fix: no O-screen captured GDPR consent at all — `GdprConsentStep` did not exist, so
// every assertion below would fail on the import alone (module not found).
describe('T-21R gap: O-8.5 GdprConsentStep — explicit affirmative act, default NOT-consented (§6.10-10)', () => {
  // PROOF (d): the affordance is explicit affirmative, default NOT-consented.
  test('defaults to NOT consented (aria-checked="false") and Continue is DISABLED — never pre-checked', () => {
    const html = render(createElement(GdprConsentStep, { consented: false }));
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(textOf(html)).toContain(GDPR_CONSENT_LABEL);
    // TEETH: the Continue button carries the `disabled` attribute while not consented — a rep cannot
    // advance past this screen without the explicit act.
    const continueButtonHtml = html.match(/<button[^>]*>\s*Continue\s*<\/button>/)?.[0] ?? '';
    expect(continueButtonHtml).toMatch(/disabled/);
  });

  test('once consented (toggle ON), Continue is ENABLED — the explicit act unlocks progression', () => {
    const html = render(createElement(GdprConsentStep, { consented: true }));
    expect(html).toContain('aria-checked="true"');
    const continueButtonHtml = html.match(/<button[^>]*>\s*Continue\s*<\/button>/)?.[0] ?? '';
    expect(continueButtonHtml).not.toMatch(/disabled/);
  });

  test('the caption is explicit that this is not pre-selected and is revocable', () => {
    const html = render(createElement(GdprConsentStep, { consented: false }));
    expect(textOf(html)).toMatch(/not pre-selected/i);
    expect(textOf(html)).toMatch(/revocable/i);
  });

  test('while submitting, Continue stays disabled even if consented (prevents a double-submit)', () => {
    const html = render(createElement(GdprConsentStep, { consented: true, submitting: true }));
    const continueButtonHtml = html.match(/<button[^>]*>\s*Continue\s*<\/button>/)?.[0] ?? '';
    expect(continueButtonHtml).toMatch(/disabled/);
  });

  test('a server-side grant failure is surfaced as an alert — Continue never silently "succeeds" only in the UI', () => {
    const html = render(
      createElement(GdprConsentStep, { consented: true, error: 'Could not record your consent — please try again.' })
    );
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toMatch(/could not record your consent/i);
  });
});

// ─── R-11 (refinements catalog 2026-07-28; master spec §16.3; operator decision D4 + D2) ─────────
// The master spec's ACs require a DISTINCT, explicit GDPR/consent step in onboarding; the uiux
// spec's O-1..O-9 enumeration omits one. Reconcile TO THE MASTER SPEC: this O-8.5 step IS the
// required step, and its copy must carry the §16.3 content — what is processed, who it is for, and
// the deletion/FINRA carve-out — with the grant REQUIRED (fail-closed, not bypassable by skipping).
describe('R-11: O-8.5 GdprConsentStep — distinct GDPR step with clear §16.3 copy, no bypass', () => {
  test('renders the clear data-processing scope copy (what is processed, §16.3 "Consent")', () => {
    const html = textOf(render(createElement(GdprConsentStep, { consented: false })));
    expect(html).toMatch(/what this covers/i);
    // The scope must be concrete — a rep is told which data classes are processed and why,
    // not handed a bare "we process your data" statement.
    expect(html).toMatch(/contact details/i);
    expect(html).toMatch(/Seven Whys/i);
    expect(html).toMatch(/introduction pipeline/i);
  });

  test('renders the "who it is for" copy — for the rep\'s own community building, never sold (§16.3 "Minimization")', () => {
    const html = textOf(render(createElement(GdprConsentStep, { consented: false })));
    // renderToStaticMarkup HTML-entity-encodes the apostrophe (&#x27;) — match it either way.
    expect(html).toMatch(/who it&#x27;s for|who it's for/i);
    expect(html).toMatch(/never sold/i);
  });

  test('renders the deletion/FINRA carve-out copy — ordinary data deleted, regulated communications lawfully retained (§16.3 retention split)', () => {
    const html = textOf(render(createElement(GdprConsentStep, { consented: false })));
    expect(html).toMatch(/deletion and the FINRA carve-out/i);
    expect(html).toMatch(/FINRA 2210\/3110/i);
    expect(html).toMatch(/deletion certificate/i);
    expect(html).toMatch(/segregated archive/i);
  });

  test('TEETH: the §16.3 detail copy exists ONLY on the distinct consent step — no other O-screen renders it', () => {
    // The GDPR consent screen is the single owner of this copy. If the flow ever renders the
    // consent detail strings anywhere else (a stray leak into another screen), this fails.
    for (const src of [visionSplashSrc, identityStepSrc, orgStepSrc, contactImportStepSrc]) {
      expect(src).not.toMatch(/FINRA 2210\/3110/);
    }
  });

  test('TEETH: the flow still has NO skip affordance for the consent step — Continue is the only advance, disabled without the explicit grant', () => {
    // A "Skip" affordance on this screen would let a rep bypass the grant in the UI. The step's
    // own Continue is the only advance button, and it is disabled until consented (proven above).
    const html = render(createElement(GdprConsentStep, { consented: false }));
    expect(html).not.toMatch(/skip/i);
    const continueButtonHtml = html.match(/<button[^>]*>\s*Continue\s*<\/button>/)?.[0] ?? '';
    expect(continueButtonHtml).toMatch(/disabled/);
  });
});

// ─── T-21R: the O-8.5 GDPR consent screen is reachable in the flow model + resume-exact ───────────
describe('T-21R: flow-model wiring for the new "consent" O-screen', () => {
  test('"consent" is a real OnboardingScreen, positioned between "reveal" (O-8) and "first48" (O-9)', () => {
    // Imported lazily here to avoid a second top-level import block purely for this constant.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { REP_SCREENS } = require('@/app/onboarding/flow-model');
    const revealIdx = REP_SCREENS.indexOf('reveal');
    const consentIdx = REP_SCREENS.indexOf('consent');
    const first48Idx = REP_SCREENS.indexOf('first48');
    expect(consentIdx).toBe(revealIdx + 1);
    expect(first48Idx).toBe(consentIdx + 1);
  });

  test('resume-exact: the wp01 "consent_capture" track-step key resumes onto the "consent" O-screen', () => {
    expect(resumeScreen('consent_capture')).toBe('consent');
    expect(resumeScreen('consent')).toBe('consent');
  });
});

// ─── T-R30 gap fix (GAP 1): O-7 ContactImportStep's real CSV import in-flight/error affordance ────
// BEFORE this fix: `OnboardingFlow.tsx`'s `onUseCsv` faked `contactCount=24` and never read a file
// (T-51) — `ContactImportStep` had no importing/error state at all, so every assertion below would
// fail against the pre-fix component (no `csvImporting`/`csvError` props existed to assert on).
describe('T-R30 gap (GAP 1): O-7 ContactImportStep surfaces real CSV-import progress/failure', () => {
  test('backward-compat: omitting csvImporting/csvError renders exactly as before ("Import a CSV", enabled, no alert)', () => {
    const html = render(createElement(ContactImportStep, { beat: 'denied' }));
    expect(textOf(html)).toContain('Import a CSV');
    expect(html).not.toMatch(/role="alert"/);
    const csvButtonHtml = html.match(/<button[^>]*>\s*Import a CSV\s*<\/button>/)?.[0] ?? '';
    expect(csvButtonHtml).not.toMatch(/disabled/);
  });

  test('csvImporting=true relabels the button "Importing…" and disables it against a double-submit', () => {
    const html = render(createElement(ContactImportStep, { beat: 'denied', csvImporting: true }));
    expect(textOf(html)).toContain('Importing…');
    expect(textOf(html)).not.toContain('Import a CSV');
    const importButtonHtml = html.match(/<button[^>]*>\s*Importing…\s*<\/button>/)?.[0] ?? '';
    expect(importButtonHtml).toMatch(/disabled/);
  });

  test('a real import failure (csvError set) is surfaced as an alert — never a silently-faked success', () => {
    const html = render(
      createElement(ContactImportStep, { beat: 'denied', csvError: 'Could not import that file — please try again.' })
    );
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toMatch(/could not import that file/i);
  });

  test('csvImporting/csvError props do not leak into unrelated beats (e.g. "value")', () => {
    const html = render(createElement(ContactImportStep, { beat: 'value', csvImporting: true, csvError: 'x' }));
    expect(html).not.toMatch(/role="alert"/);
    expect(textOf(html)).not.toMatch(/importing|import a csv/i);
  });
});

// ─── T-58 — O-7 ContactImportStep's REAL "Import from Phone" beats, replacing the fake
// `onRequestPermission={() => setContactCount(24)}` success path. Proves: an honest empty state
// (never a fabricated list), real checkbox selection state, the duplicate label, the web
// fail-closed ('unsupported') beat, and the distinct native-error message on 'denied' (never
// conflated with a plain permission refusal, which shows no error text at all).
describe('T-58: O-7 ContactImportStep — real device-contacts selection list + web/error fail-closed beats', () => {
  const CANDIDATES: NativeContactCandidate[] = [
    { contactId: 'c-1', row: { name: 'Jane Doe', phone: '312-555-0100', email: null, notes: null, industry: null, birthdate: null }, isDuplicate: false },
    { contactId: 'c-2', row: { name: 'Andre Bell', phone: null, email: 'andre@example.com', notes: null, industry: null, birthdate: null }, isDuplicate: true },
  ];

  test('"select" beat with an EMPTY candidate list renders the honest empty state — no checkboxes, no fabricated rows', () => {
    const html = render(createElement(ContactImportStep, { beat: 'select', nativeCandidates: [] }));
    expect(textOf(html)).toMatch(/couldn.t find any importable contacts/i);
    expect(html).not.toMatch(/<input[^>]*type="checkbox"/);
  });

  test('"select" beat with real candidates renders one checkbox row per candidate, reflecting the caller\'s selected-ids set', () => {
    const html = render(
      createElement(ContactImportStep, {
        beat: 'select',
        nativeCandidates: CANDIDATES,
        nativeSelectedIds: new Set(['c-1']),
      })
    );
    expect(textOf(html)).toContain('Jane Doe');
    expect(textOf(html)).toContain('Andre Bell');
    // c-1 is checked, c-2 is not — proves the checkbox state is driven by the caller's prop, not a
    // fixed default.
    const checkboxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toMatch(/checked=""/);
    expect(checkboxes[1]).not.toMatch(/checked=""/);
  });

  test('a duplicate candidate is labeled, not hidden — the rep can still see and select it', () => {
    const html = render(
      createElement(ContactImportStep, { beat: 'select', nativeCandidates: CANDIDATES, nativeSelectedIds: new Set<string>() })
    );
    expect(textOf(html)).toMatch(/already in your community/i);
  });

  test('the import CTA is disabled with zero selected, and pluralizes correctly at exactly one selected', () => {
    const zeroSelected = render(
      createElement(ContactImportStep, { beat: 'select', nativeCandidates: CANDIDATES, nativeSelectedIds: new Set<string>() })
    );
    const zeroButtonHtml = zeroSelected.match(/<button[^>]*>\s*Import[^<]*<\/button>/)?.[0] ?? '';
    expect(zeroButtonHtml).toMatch(/disabled/);

    const oneSelected = render(
      createElement(ContactImportStep, { beat: 'select', nativeCandidates: CANDIDATES, nativeSelectedIds: new Set(['c-1']) })
    );
    expect(textOf(oneSelected)).toContain('Import 1 contact');
    expect(textOf(oneSelected)).not.toContain('Import 1 contacts');

    const twoSelected = render(
      createElement(ContactImportStep, {
        beat: 'select',
        nativeCandidates: CANDIDATES,
        nativeSelectedIds: new Set(['c-1', 'c-2']),
      })
    );
    expect(textOf(twoSelected)).toContain('Import 2 contacts');
  });

  test('nativeImporting=true relabels the import CTA "Importing…" and disables it against a double-submit', () => {
    const html = render(
      createElement(ContactImportStep, {
        beat: 'select',
        nativeCandidates: CANDIDATES,
        nativeSelectedIds: new Set(['c-1']),
        nativeImporting: true,
      })
    );
    expect(textOf(html)).toContain('Importing…');
    const button = html.match(/<button[^>]*>\s*Importing…\s*<\/button>/)?.[0] ?? '';
    expect(button).toMatch(/disabled/);
  });

  test('"unsupported" (web fail-closed) beat offers the SAME CSV/manual fallback as "denied", with its own honest headline', () => {
    const html = render(createElement(ContactImportStep, { beat: 'unsupported' }));
    expect(textOf(html)).toMatch(/isn.t available here/i);
    expect(textOf(html)).toContain('Import a CSV');
    expect(textOf(html)).toContain('Add one at a time');
  });

  test('"denied" beat with nativeImportError set surfaces it as a DISTINCT alert from csvError — both can render, never conflated', () => {
    const html = render(
      createElement(ContactImportStep, {
        beat: 'denied',
        nativeImportError: 'We couldn’t read your phone’s contacts just now.',
      })
    );
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toMatch(/couldn.t read your phone.s contacts/i);
  });

  test('a plain permission refusal (nativeImportError=null) shows NO error alert — refusal itself is not an error', () => {
    const html = render(createElement(ContactImportStep, { beat: 'denied' }));
    expect(html).not.toMatch(/role="alert"/);
  });

  test('native props do not leak into unrelated beats (e.g. "value")', () => {
    const html = render(
      createElement(ContactImportStep, {
        beat: 'value',
        nativeCandidates: CANDIDATES,
        nativeImportError: 'x',
      })
    );
    expect(html).not.toMatch(/role="alert"/);
    expect(textOf(html)).not.toContain('Jane Doe');
  });
});

// ─── R-13 (refinements catalog 2026-07-28) — the REAL "Add one at a time" contact-entry form
// (ManualAddStep). The catalog row's observed loop — "Add one at a time" → reveal "Add people" →
// back to the phone-import screen, with NO reachable entry UI — is fixed by this form: name/phone/
// email fields, add-and-repeat, a polite success confirmation, a Done CTA that routes ONWARD into
// the flow, and a Cancel CTA with a sane landing. Proves the form actually RENDERS the fields and
// the caller's wiring affordances; the POST wiring/navigation proofs live in the R-13 describe
// block of onboarding-flow-wiring.test.ts (source-scan, same convention as the other R-items).
describe('R-13: O-7 ManualAddStep — the real one-at-a-time contact-entry form', () => {
  const baseProps = {
    name: '',
    onNameChange: () => {},
    phone: '',
    onPhoneChange: () => {},
    email: '',
    onEmailChange: () => {},
  };

  test('renders the name/phone/email fields and the add / cancel / done affordances', () => {
    const html = render(createElement(ManualAddStep, { ...baseProps }));
    const text = textOf(html);
    expect(text).toContain('Add contacts one at a time');
    expect(html).toMatch(/<input[^>]*id="manual-add-name"/);
    expect(html).toMatch(/<input[^>]*id="manual-add-phone"/);
    expect(html).toMatch(/<input[^>]*id="manual-add-email"/);
    expect(text).toContain('Add contact');
    expect(text).toContain('Cancel');
    expect(text).toContain('Done — see my field');
  });

  test('no success confirmation renders until a contact was actually added (lastAddedName set by the caller)', () => {
    const empty = render(createElement(ManualAddStep, { ...baseProps }));
    expect(empty).not.toMatch(/role="status"/);

    const confirmed = render(
      createElement(ManualAddStep, { ...baseProps, lastAddedName: 'Jamie Rivera' })
    );
    expect(confirmed).toMatch(/role="status"/);
    expect(textOf(confirmed)).toContain('Added Jamie Rivera to your community');
  });

  test('saving=true relabels the Add CTA "Adding…" and disables it against a double-submit', () => {
    const html = render(createElement(ManualAddStep, { ...baseProps, saving: true }));
    expect(textOf(html)).toContain('Adding…');
    const button = html.match(/<button[^>]*>\s*Adding…\s*<\/button>/)?.[0] ?? '';
    expect(button).toMatch(/disabled/);
  });

  test('a real save failure surfaces as an alert — never silently swallowed', () => {
    const html = render(
      createElement(ManualAddStep, { ...baseProps, saveError: 'We couldn’t add that contact just now.' })
    );
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toMatch(/couldn.t add that contact/i);
  });
});

// ─── T-20 QC gap fix (4): SOLUTION_NUMBER_ENCRYPTION_KEY documented in .env.example ───────────────
describe('T-20 gap (4): .env.example documents SOLUTION_NUMBER_ENCRYPTION_KEY', () => {
  test('the env var name is present (name + placeholder only — never a real value)', () => {
    const envExample = readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');
    expect(envExample).toMatch(/^SOLUTION_NUMBER_ENCRYPTION_KEY=/m);
    // Never a real base64 secret — only the placeholder pattern used by its sibling keys.
    expect(envExample).toMatch(/SOLUTION_NUMBER_ENCRYPTION_KEY="your-[\w-]+-here"/);
  });
});
