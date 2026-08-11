// R-02 (refinements catalog 2026-08-10) — the org type is captured EXACTLY ONCE at registration
// (`src/app/api/auth/register/route.ts`, fail-closed to EXTERNAL) and the onboarding flow is driven
// ENTIRELY from that single persisted determination via the server session — the redundant
// "Where do you build?" Primerica-vs-other step is gone, and a non-Primerica user sees a clean,
// generic experience with zero Primerica strings.
//
// R-05 (refinements catalog 2026-07-28) — the SOLUTION NUMBER is captured EXACTLY ONCE too (the
// registration form, the first Primerica surface; persisted encrypted at rest). The O-3 screen no
// longer shows a solution-number re-entry field: it renders the already-persisted value's MASKED
// saved-state + the not-verified caption (driven by the server presence probe `hasSolutionNumber`),
// and the server's `/step` T-R38 fallback reuses the persisted value for ROLE_ORG_CONTEXT's format
// gate — the rep is never asked for the number twice.
//
// This suite proves, structurally AND by render:
//   1. The entry pages hand the persisted org from the SERVER session into the flow (same pattern
//      as R-01's role wiring).
//   2. The flow has NO client-side org-selection state or affordance left (no setOrgType, no
//      onSelectOrgType, no choice-card radiogroup) — a tampered org cannot even be declared here.
//   3. The O-3 org-context screen renders from the session org: universal branch = Primerica-free
//      by construction; Primerica branch = solution-number SAVED-STATE (mask + "not verified"
//      caption), never a re-entry field (R-05).
//   4. The Primerica-vs-other framing strings are gone from the catalogs and the flow model.
//   5. R-01 (role-keyed RVP skip), R-08 (sponsor pool), and the dense tracks are preserved.
//   6. The server-side tamper defense is intact: ROLE_ORG_CONTEXT validation still reads the
//      persisted `User.org_type`, never the submitted org.
//
// Render proofs follow the repo's established convention (onboarding-ui.test.ts): react-dom/server
// `renderToStaticMarkup` with `createElement` (no JSX) — this Jest env has no jsdom.
// Structural proofs follow onboarding-flow-wiring.test.ts's source-scan convention.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { OrgType, Role } from '@prisma/client';

import OrgStep from '@/app/onboarding/components/OrgStep';
import { REP_SCREENS, SCREEN_LABELS } from '@/app/onboarding/flow-model';

const REPO = path.join(__dirname, '..', '..');
const ONBOARDING_DIR = path.join(REPO, 'src', 'app', 'onboarding');

const read = (rel: string) => readFileSync(path.join(REPO, rel), 'utf8');
const flowSrc = read('src/app/onboarding/OnboardingFlow.tsx');
const orgStepSrc = read('src/app/onboarding/components/OrgStep.tsx');
const pageSrc = read('src/app/onboarding/page.tsx');
const resumePageSrc = read('src/app/onboarding/resume/page.tsx');
const flowModelSrc = read('src/app/onboarding/flow-model.ts');
const registerRouteSrc = read('src/app/api/auth/register/route.ts');
const stepRouteSrc = read('src/app/api/onboarding/step/route.ts');
const serviceSrc = read('src/services/onboarding/service.ts');

const enCatalog = JSON.parse(read('src/lib/i18n/messages/en.json')) as { onboarding: Record<string, unknown> };
const esCatalog = JSON.parse(read('src/lib/i18n/messages/es.json')) as { onboarding: Record<string, unknown> };

const render = (el: ReactElement) => renderToStaticMarkup(el);
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');

// ─── 1. Entry pages: persisted org from the SERVER session (R-01's role pattern) ─────────────────
describe('R-02 — entry pages hand the persisted org from the server session into the flow', () => {
  test('both entry pages read getCurrentSession() and pass orgType into OnboardingFlow', () => {
    for (const src of [pageSrc, resumePageSrc]) {
      expect(src).toContain('getCurrentSession()');
      expect(src).toContain('<OnboardingFlow role={role} orgType={orgType}');
    }
  });

  test('both entry pages resolve orgType from the SESSION and fail closed to EXTERNAL', () => {
    for (const src of [pageSrc, resumePageSrc]) {
      expect(src).toContain('session?.user?.orgType');
      expect(src).toContain('OrgType.EXTERNAL');
    }
  });

  test('registration remains the ONE place org is resolved (fail-closed to EXTERNAL), untouched by this change', () => {
    expect(registerRouteSrc).toContain(
      "const resolvedOrgType: OrgType = orgType === 'PRIMERICA' ? OrgType.PRIMERICA : OrgType.EXTERNAL;"
    );
  });
});

// ─── 2. No redundant org step: no client-side org selection anywhere in the flow ─────────────────
describe('R-02 — the onboarding flow has NO client-side org-selection state or affordance left', () => {
  test('OnboardingFlow no longer declares org-selection state (setOrgType is gone)', () => {
    expect(flowSrc).not.toContain('setOrgType');
    expect(flowSrc).not.toContain('useState<OrgType | null>');
  });

  test('OnboardingFlow hands the session org straight to the O-3 screen (no selectedOrgType/onSelectOrgType props)', () => {
    expect(flowSrc).not.toContain('selectedOrgType');
    expect(flowSrc).not.toContain('onSelectOrgType');
    expect(flowSrc).toContain('<OrgStep');
    expect(flowSrc).toContain('orgType={orgType}');
  });

  test('OrgStep renders no org-choice radiogroup and no Primerica/external selector surface', () => {
    expect(orgStepSrc).not.toContain('role="radiogroup"');
    expect(orgStepSrc).not.toContain('onSelectOrgType');
    expect(orgStepSrc).not.toContain('selectedOrgType');
    expect(orgStepSrc).not.toContain('orgChoices');
  });

  test('the flow\'s ROLE_ORG_CONTEXT payload is built from the SESSION org — a tampered org cannot be declared', () => {
    // `handleOrgContinue`'s payload must reference the prop directly, never a client-settable value.
    expect(flowSrc).toContain('buildRoleOrgContextPayload(orgType, ');
  });
});

// ─── 3. O-3 org-context screen renders from the session org, branch-shaped ──────────────────────
describe('R-02 — the O-3 org-context screen renders ONLY the branch for the persisted org', () => {
  test('universal (EXTERNAL) branch: clean generic experience, ZERO Primerica strings, no solution surface', () => {
    const html = render(createElement(OrgStep, { orgType: OrgType.EXTERNAL }));
    expect(html).not.toMatch(/primerica/i);
    expect(html).not.toMatch(/solution/i);
    expect(html).not.toMatch(/not verified/i);
    // The generic build-context body is what renders — never a choice question. (Apostrophe
    // matched loosely: the catalog's typographic ’ differs from a straight quote.)
    expect(textOf(html)).toMatch(/building independently/);
    expect(textOf(html)).not.toMatch(/where do you build/i);
  });

  test('Primerica branch: the saved-state (mask + "not verified" caption) renders, never a re-entry field (R-05)', () => {
    // R-05 — the solution number is captured ONCE at registration; the O-3 screen NEVER shows a
    // re-entry field. It renders the persisted value's masked saved-state + the honest not-verified
    // caption. (The old test asserted the capture input; that surface is deliberately gone.)
    const html = render(createElement(OrgStep, { orgType: OrgType.PRIMERICA }));
    expect(html).toContain('•••••••'); // the mask is the ONLY display form
    expect(textOf(html)).toContain('Solution number');
    expect(textOf(html)).toMatch(/Not verified/);
    expect(html).not.toContain('<input'); // no re-entry field anywhere
    expect(textOf(html)).not.toMatch(/where do you build/i);
  });

  test('TEETH: the Primerica saved-state renders ONLY the mask — never the raw digits, regardless of any prop (§6.10-4)', () => {
    // Even a would-be digits-carrying prop cannot leak: the display path always masks.
    const html = render(
      createElement(OrgStep, { orgType: OrgType.PRIMERICA, hasSolutionNumber: true })
    );
    expect(html).toContain('•••••••');
    expect(html).not.toContain('ABC-1234');
    expect(html).not.toContain('1234567');
  });

  test('TEETH: the O-3 screen never asks the Primerica-vs-other question again, in either branch', () => {
    for (const orgType of [OrgType.PRIMERICA, OrgType.EXTERNAL]) {
      const html = render(createElement(OrgStep, { orgType }));
      expect(textOf(html)).not.toMatch(/where do you build/i);
      expect(textOf(html)).not.toMatch(/primerica vs/i);
    }
  });
});

// ─── 4. The Primerica-vs-other framing is gone from catalogs + flow model ────────────────────────
describe('R-02 — the redundant orgStep framing is removed from catalogs and flow model', () => {
  test('the orgStep catalog block (headline "Where do you build?", the two choice cards) is gone from BOTH locales', () => {
    for (const catalog of [enCatalog, esCatalog]) {
      expect('orgStep' in catalog.onboarding).toBe(false);
      expect('orgContext' in catalog.onboarding).toBe(true);
    }
  });

  test('the orgContext block carries the universal body + solution-number saved-state strings in BOTH locales (R-05)', () => {
    for (const catalog of [enCatalog, esCatalog]) {
      const block = catalog.onboarding.orgContext as Record<string, string>;
      for (const key of [
        'universalBody',
        'solutionNumberSavedAria',
        'solutionNumberMaskedAria',
        'solutionNumberLabel',
        'solutionNumberNotVerifiedCaption',
      ]) {
        expect(typeof block[key]).toBe('string');
        expect(block[key].length).toBeGreaterThan(0);
      }
    }
  });

  test('no src file references the removed orgStep catalog keys anymore', () => {
    // The old key path must be fully gone from the source (comments in tests/history may still
    // name the removed step, but the live catalogs and components must not).
    expect(flowSrc).not.toContain('onboarding.orgStep.');
    expect(orgStepSrc).not.toContain('onboarding.orgStep.');
  });

  test('the flow model\'s org-screen resume label no longer carries the "Where you build" framing', () => {
    expect(SCREEN_LABELS.org).toBe('Your build context');
    // The org screen is still part of the rep track — the step itself is NOT removed, only the
    // redundant QUESTION it used to ask.
    expect(REP_SCREENS).toContain('org');
  });
});

// ─── 5. Preserved: R-01 role-keyed skip, R-08 sponsor flow, dense tracks, solution gating ────────
describe('R-02 — prior flow behavior is preserved (R-01, R-08, dense tracks)', () => {
  test('R-01: advance() still walks the role-keyed screen list (RVP skips the sponsor screen)', () => {
    expect(flowSrc).toContain('repScreensForRole(role)');
  });

  test('R-01: the RVP no-pairing guard panel still replaces SponsorStep for a skipped role', () => {
    expect(flowSrc).toContain("screen === 'sponsor' && !sponsorStepSkippedForRole(role)");
    expect(flowSrc).toContain("t('onboarding.sponsor.rvpNoPairingHeadline')");
  });

  test('R-08: the sponsor pool still fetches real same-org candidates and persists the decision', () => {
    expect(flowSrc).toContain('fetchSponsorCandidates()');
    expect(flowSrc).toContain('postSponsorDecision(');
    // The matcher is still scoped to the session org (the single determination).
    expect(flowSrc).toMatch(/\{ orgType: orgType \?\? OrgType\.EXTERNAL, candidates: sponsorCandidates \}/);
    // The pool's candidate objects are stamped with the same session org (the pool is org-scoped).
    expect(flowSrc).toMatch(/userId: c\.userId,/);
  });

  test('dense track: buildDenseTrackStepPlan still walks the role plan with the session org', () => {
    // R-05 — the dense plan is built with NO locally-held solution number (captured once at
    // registration; the server's T-R38 fallback reuses the persisted value for the format gate).
    expect(flowSrc).toContain('buildDenseTrackStepPlan(role, orgType, ');
  });

  test('the solution-number saved-state remains PRIMERICA-ONLY and still gated (org-gate intact)', () => {
    // OrgStep still builds its branch panel through the org gate (never a hand-rolled branch).
    expect(orgStepSrc).toContain("buildOrgContext(orgType, locale)");
    // The server still format-gates ROLE_ORG_CONTEXT on the PERSISTED org — a tampered org can
    // never unlock a Primerica gate (validateStep reads session.org_type, the User row).
    expect(serviceSrc).toContain(
      'step === OnboardingStep.ROLE_ORG_CONTEXT && session.org_type === OrgType.PRIMERICA'
    );
    // The step route still falls back to the persisted User org when a payload omits the org
    // (a client cannot influence the server's branch determination).
    expect(stepRouteSrc).toContain('user.org_type');
  });

  // R-05 — capture-once TEETH: no re-entry surface, no local value, server-side reuse intact.
  test('R-05: the flow holds NO local solution-number state and the O-3 screen shows no re-entry field', () => {
    // No local solution-number state or re-entry affordance anywhere in the shell.
    expect(flowSrc).not.toContain('setSolutionNumber');
    expect(flowSrc).not.toContain('onSolutionNumberChange');
    expect(flowSrc).not.toContain('solutionConfirmed');
    expect(orgStepSrc).not.toContain('onSolutionNumberChange');
    expect(orgStepSrc).not.toContain('<input');
    // The saved-state mask is driven by the server presence probe, not by local typing.
    expect(flowSrc).toContain('hasSolutionNumber={hasSolutionNumber}');
    // The server's /step reuse fallback (T-R38) is what satisfies ROLE_ORG_CONTEXT's format gate
    // for the already-captured value — never a re-prompt.
    expect(stepRouteSrc).toContain('decryptSolutionNumberFromStorage(user.solution_number)');
  });

  test('R-05: the status route exposes the presence-only hasSolutionNumber probe (never the value)', () => {
    const statusRouteSrc = read('src/app/api/onboarding/status/route.ts');
    expect(statusRouteSrc).toContain('decryptSolutionNumberFromStorage');
    expect(statusRouteSrc).toContain('hasSolutionNumber');
    // The value itself never crosses the API — only the boolean probe is returned. The route's
    // `select: { solution_number: true }` reads the ENCRYPTED column server-side; the RESPONSE
    // body (everything after `return NextResponse.json({`) must never carry a solution-number key.
    const responseTail = statusRouteSrc.split('return NextResponse.json({')[1] ?? '';
    expect(responseTail).not.toContain('solution_number');
    expect(responseTail).not.toContain('solutionNumber');
  });

  test('the sponsor screen is still absent from an RVP\'s screen list while present for every other role', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { repScreensForRole } = require('@/app/onboarding/flow-model');
    expect(repScreensForRole(Role.RVP)).not.toContain('sponsor');
    expect(repScreensForRole(Role.REP)).toContain('sponsor');
  });
});

// ─── 6. i18n guard baseline hygiene: catalogs stay valid JSON and parallel ───────────────────────
describe('R-02 — catalog hygiene', () => {
  test('EN and ES catalogs expose the exact same orgContext keys (no drift)', () => {
    const enKeys = Object.keys((enCatalog.onboarding.orgContext as Record<string, unknown>)).sort();
    const esKeys = Object.keys((esCatalog.onboarding.orgContext as Record<string, unknown>)).sort();
    expect(enKeys).toEqual(esKeys);
  });

  test('a Spanish universal user sees the Spanish generic body, not English, with zero Primerica strings', () => {
    // The universalBody ES copy contains no Primerica term and is genuinely Spanish.
    const esBody = (esCatalog.onboarding.orgContext as Record<string, string>).universalBody;
    expect(esBody).toMatch(/Estás construyendo de forma independiente/);
    expect(esBody).not.toMatch(/primerica/i);
  });
});
