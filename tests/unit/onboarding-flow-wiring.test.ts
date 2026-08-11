// T-R37 — structural (source-scan) proof that `OnboardingFlow.tsx` is actually WIRED to the real
// `/api/onboarding/step` + `/api/onboarding/complete` routes, in the correct order, fail-closed.
//
// `OnboardingFlow.tsx` is a `'use client'` component whose handlers fire from user clicks/effects —
// this repo's Jest config runs `testEnvironment: 'node'` with no jsdom and no `@testing-library/react`
// (confirmed: no such dependency in package.json), so a click can't actually be simulated here. This
// mirrors the EXACT, already-established precedent for that exact constraint:
// tests/unit/composer-handoff-wiring.test.ts ("the two page components fetch their own data in
// `useEffect` (which never runs in this repo's node/no-jsdom render) — a source-scan is the
// deterministic proof that the trigger + sheet are mounted and fed the right ids").
//
// The BEHAVIORAL proof that the network calls themselves are correct (payload shapes, fail-closed
// sequencing, resume-safety) lives in tests/unit/onboarding-step-client.test.ts (mocked fetch) and
// tests/unit/onboarding-client-mapping-integration.test.ts (the REAL route handlers). This suite
// closes the remaining gap: that `OnboardingFlow.tsx` itself actually CALLS those proven-correct
// functions, in the right place, in the right order, and never advances/navigates on a failure.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(__dirname, '..', '..', 'src', 'app', 'onboarding');
const flowSrc = readFileSync(path.join(SRC, 'OnboardingFlow.tsx'), 'utf8');
const first48Src = readFileSync(path.join(SRC, 'components', 'First48Handoff.tsx'), 'utf8');

/** Extracts a named function's body (naive brace-matching — good enough for this file's own
 *  `function name() { ... }`/`async function name() { ... }` shape, matching the existing
 *  `composer-handoff-wiring.test.ts` "read the source, assert on shape" convention). */
function extractFunctionBody(src: string, name: string): string {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`function ${name} not found in source`);
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  let i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(braceStart, i + 1);
}

describe('OnboardingFlow.tsx imports the proven client-step-wiring module (never a hand-rolled duplicate)', () => {
  test('imports every step-wiring primitive from ./onboarding-step-client', () => {
    expect(flowSrc).toMatch(/from '\.\/onboarding-step-client'/);
    for (const name of [
      'buildDenseTrackStepPlan',
      'buildGoalCardPayload',
      'buildIntensityDataPayload',
      'buildRoleOrgContextPayload',
      'buildSevenWhysResponses',
      'postOnboardingComplete',
      'postOnboardingStep',
      'sendOrderedSteps',
      'stepToScreen',
    ]) {
      expect(flowSrc).toContain(name);
    }
  });
});

describe('handleIdentityAdvance — O-2 identity screen sends REGISTER then ACCOUNT_TYPE', () => {
  const body = extractFunctionBody(flowSrc, 'handleIdentityAdvance');

  test('sends OnboardingStep.REGISTER before OnboardingStep.ACCOUNT_TYPE (source order)', () => {
    const registerIdx = body.indexOf('OnboardingStep.REGISTER');
    const accountTypeIdx = body.indexOf('OnboardingStep.ACCOUNT_TYPE');
    expect(registerIdx).toBeGreaterThan(-1);
    expect(accountTypeIdx).toBeGreaterThan(-1);
    expect(registerIdx).toBeLessThan(accountTypeIdx);
  });

  test('fail-closed: a rejected outcome sets the error and returns BEFORE `advance()` is ever reached', () => {
    const guardIdx = body.indexOf('if (!outcome.ok)');
    const returnIdx = body.indexOf('return;', guardIdx);
    const advanceIdx = body.lastIndexOf('advance();');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(guardIdx);
    expect(advanceIdx).toBeGreaterThan(returnIdx); // advance() only runs past the guard's early return
  });

  test('uses sendOrderedSteps (the resume-safe, fail-closed sequencer) rather than two bare fetches', () => {
    expect(body).toContain('sendOrderedSteps(');
  });
});

describe('handleOrgContinue — O-3 org screen sends ROLE_ORG_CONTEXT via buildRoleOrgContextPayload', () => {
  const body = extractFunctionBody(flowSrc, 'handleOrgContinue');

  test('calls postOnboardingStep(OnboardingStep.ROLE_ORG_CONTEXT, buildRoleOrgContextPayload(...))', () => {
    expect(body).toMatch(/postOnboardingStep\(\s*OnboardingStep\.ROLE_ORG_CONTEXT/);
    expect(body).toContain('buildRoleOrgContextPayload(');
  });

  test('fail-closed: advance() only reachable after the `!result.ok` guard\'s early return', () => {
    const guardIdx = body.indexOf('if (!result.ok)');
    const returnIdx = body.indexOf('return;', guardIdx);
    const advanceIdx = body.lastIndexOf('advance();');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(advanceIdx).toBeGreaterThan(returnIdx);
  });
});

describe('handleSevenWhysContinue — THE CRUX FIX: SEVEN_WHYS before GOAL_CARD before INTENSITY', () => {
  const body = extractFunctionBody(flowSrc, 'handleSevenWhysContinue');

  test('the three steps are sent in the SERVER-correct order (SEVEN_WHYS, GOAL_CARD, INTENSITY) — not the UI screen order', () => {
    const sevenWhysIdx = body.indexOf('OnboardingStep.SEVEN_WHYS');
    const goalCardIdx = body.indexOf('OnboardingStep.GOAL_CARD');
    const intensityIdx = body.indexOf('OnboardingStep.INTENSITY');
    expect(sevenWhysIdx).toBeGreaterThan(-1);
    expect(goalCardIdx).toBeGreaterThan(sevenWhysIdx);
    expect(intensityIdx).toBeGreaterThan(goalCardIdx);
  });

  test('builds each payload via the proven builder functions, never an inline hand-rolled object', () => {
    expect(body).toContain('buildSevenWhysResponses(');
    expect(body).toContain('buildGoalCardPayload(');
    expect(body).toContain('buildIntensityDataPayload(');
  });

  test('fail-closed: advance() only reachable after the outcome guard\'s early return', () => {
    const guardIdx = body.indexOf('if (!outcome.ok)');
    const returnIdx = body.indexOf('return;', guardIdx);
    const advanceIdx = body.lastIndexOf('advance();');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(advanceIdx).toBeGreaterThan(returnIdx);
  });
});

describe('handleGrantGdprConsent — grants REAL consent AND advances the REAL session past CONSENT_CAPTURE', () => {
  const body = extractFunctionBody(flowSrc, 'handleGrantGdprConsent');

  test('POSTs /api/onboarding/consent AND submits OnboardingStep.CONSENT_CAPTURE via postOnboardingStep', () => {
    expect(body).toContain("fetch('/api/onboarding/consent'");
    expect(body).toMatch(/postOnboardingStep\(\s*OnboardingStep\.CONSENT_CAPTURE,\s*\{\s*gdpr_consent:\s*true/);
  });

  test('fail-closed: neither the consent-route failure NOR the step-call failure ever reaches advance()/setDenseScreen', () => {
    const consentGuardIdx = body.indexOf('if (!response.ok)');
    const stepGuardIdx = body.indexOf('if (!stepResult.ok)');
    const advanceIdx = body.lastIndexOf('advance();');
    expect(consentGuardIdx).toBeGreaterThan(-1);
    expect(stepGuardIdx).toBeGreaterThan(consentGuardIdx);
    expect(advanceIdx).toBeGreaterThan(stepGuardIdx);
  });
});

describe('handleShowToday — the FINAL CTA: POST /complete, THEN (and only then) navigate to /today', () => {
  const body = extractFunctionBody(flowSrc, 'handleShowToday');

  test('calls postOnboardingComplete() and router.push(\'/today\') is textually AFTER the failure guard\'s return', () => {
    expect(body).toContain('postOnboardingComplete(');
    const guardIdx = body.indexOf('if (!result.ok)');
    const returnIdx = body.indexOf('return;', guardIdx);
    const navigateIdx = body.indexOf("router.push('/today')");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(navigateIdx).toBeGreaterThan(returnIdx);
  });

  test('TEETH: the failure branch itself contains NO router.push call (a rejected /complete must never navigate)', () => {
    const guardIdx = body.indexOf('if (!result.ok)');
    const guardBlockEnd = body.indexOf('}', guardIdx);
    const guardBlock = body.slice(guardIdx, guardBlockEnd);
    expect(guardBlock).not.toContain('router.push');
  });

  test('sets a completeError from errorDisplay on failure — never silently swallowed', () => {
    expect(body).toMatch(/setCompleteError\(errorDisplay\(t, result\.code\)\)/);
  });
});

describe('first48 screen wiring — the terminal CTA is bound to handleShowToday, not a bare router.push', () => {
  test('OnboardingFlow.tsx no longer calls router.push(\'/today\') directly from First48Handoff\'s onShowToday', () => {
    expect(flowSrc).not.toMatch(/onShowToday=\{\(\) => router\.push\('\/today'\)\}/);
    expect(flowSrc).toMatch(/onShowToday=\{handleShowToday\}/);
  });

  test('First48Handoff is passed submitting/error props (both render sites: rep track + dense track)', () => {
    const occurrences = flowSrc.match(/<First48Handoff[^/]*\/>/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2); // rep-track first48 screen + dense-track tail
    for (const occurrence of occurrences) {
      expect(occurrence).toContain('submitting={completeSubmitting}');
      expect(occurrence).toContain('error={completeError}');
    }
  });

  test('First48Handoff itself disables its CTA while submitting and announces a failure via StatusMessage', () => {
    expect(first48Src).toMatch(/disabled=\{submitting\}/);
    expect(first48Src).toContain('<StatusMessage>{error}</StatusMessage>');
  });
});

describe('dense track (UPLINE/RVP/DUAL/ADMIN) reuses the SAME compliant consent + first48 tail as the rep track', () => {
  test('the dense-track branch renders GdprConsentStep and First48Handoff, never a second bespoke consent surface', () => {
    // `if (trackKindForRole(role) === 'dense') {` appears TWICE (the mount-effect's resume branch,
    // and the actual render branch) — the RENDER branch is the later occurrence in source order.
    const denseBranchStart = flowSrc.lastIndexOf("if (trackKindForRole(role) === 'dense') {");
    expect(denseBranchStart).toBeGreaterThan(-1);
    const denseBranch = flowSrc.slice(denseBranchStart, denseBranchStart + 1500);
    expect(denseBranch).toContain('<GdprConsentStep');
    expect(denseBranch).toContain('<First48Handoff');
    expect(denseBranch).toContain('handleDenseFinish');
  });

  test('handleDenseFinish builds its plan via buildDenseTrackStepPlan and is fail-closed', () => {
    const body = extractFunctionBody(flowSrc, 'handleDenseFinish');
    expect(body).toContain('buildDenseTrackStepPlan(');
    const guardIdx = body.indexOf('if (!outcome.ok)');
    const returnIdx = body.indexOf('return;', guardIdx);
    // lastIndexOf — R-03 added an early back-then-forward short-circuit at the top of this
    // handler (only reachable once the chain was already CLEARED, i.e. already succeeded); the
    // real success landing is still the FINAL one, past the outcome guard's early return.
    const successIdx = body.lastIndexOf("setDenseScreen('consent')");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(successIdx).toBeGreaterThan(returnIdx);
  });
});

describe('resume support: GET /status on mount seeds the screen + serverStepRef, never throws on a missing session', () => {
  test('the mount effect fetches /api/onboarding/status and is wrapped in a try/catch (a missing session degrades to a fresh start)', () => {
    const effectIdx = flowSrc.indexOf("fetch('/api/onboarding/status')");
    expect(effectIdx).toBeGreaterThan(-1);
    const surroundingTry = flowSrc.lastIndexOf('try {', effectIdx);
    const surroundingCatch = flowSrc.indexOf('} catch {', effectIdx);
    expect(surroundingTry).toBeGreaterThan(-1);
    expect(surroundingCatch).toBeGreaterThan(effectIdx);
  });

  test('resolves the resumed screen via stepToScreen, never a hardcoded/guessed value', () => {
    expect(flowSrc).toContain('setScreen(stepToScreen(body.currentStep))');
  });
});

// ─── R-01 (refinements catalog 2026-07-28) — the RVP no-pairing wiring ────────────────────────────
// The role-keyed behavior must be genuinely wired into `OnboardingFlow.tsx` (the entry pages hand
// the persisted role from the server session; the sponsor screen is skipped/guarded for an RVP).
describe('R-01 wiring — OnboardingFlow.tsx consumes the role-keyed no-pairing policy', () => {
  test('advance() walks the role-keyed screen list (repScreensForRole) so an RVP skips the sponsor screen', () => {
    const body = extractFunctionBody(flowSrc, 'advance');
    expect(body).toContain('repScreensForRole(role)');
    expect(body).toContain('nextScreen(');
  });

  test('the sponsor screen renders SponsorStep ONLY for a role that is not sponsor-step-skipped (RVP excluded)', () => {
    expect(flowSrc).toContain("screen === 'sponsor' && !sponsorStepSkippedForRole(role)");
  });

  test('an RVP that somehow lands on the sponsor screen sees the no-pairing statement, not a pairing prompt', () => {
    expect(flowSrc).toContain('sponsorStepSkippedForRole(role)');
    expect(flowSrc).toContain("t('onboarding.sponsor.rvpNoPairingHeadline')");
    expect(flowSrc).toContain("t('onboarding.sponsor.rvpNoPairingBody')");
    expect(flowSrc).toContain("t('onboarding.sponsor.rvpUplineOptional')");
    // The guard is a REPLACEMENT for SponsorStep, never stacked alongside it: the two branches are
    // mutually exclusive (the same `screen === 'sponsor'` condition cannot render both).
    const sponsorRender = flowSrc.indexOf('<SponsorStep');
    const guardRender = flowSrc.indexOf('sponsorStepSkippedForRole(role) && (');
    expect(sponsorRender).toBeGreaterThan(-1);
    expect(guardRender).toBeGreaterThan(-1);
  });

  test('the entry pages hand the persisted role from the SERVER session into the flow', () => {
    const entryPageSrc = readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'onboarding', 'page.tsx'), 'utf8');
    const resumePageSrc = readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'onboarding', 'resume', 'page.tsx'), 'utf8');
    for (const src of [entryPageSrc, resumePageSrc]) {
      expect(src).toContain('getCurrentSession()');
      expect(src).toContain('<OnboardingFlow role={role}');
    }
  });

  // ─── R-02 (refinements catalog 2026-08-10) — the persisted ORG rides the same server-session
  // pattern into the flow; the redundant "Where do you build?" step is gone. Deep behavioral proofs
  // (render + tamper) live in tests/unit/r02-org-once.test.ts.
  test('R-02: the entry pages hand the persisted org from the SERVER session into the flow (same pattern as the role)', () => {
    const entryPageSrc = readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'onboarding', 'page.tsx'), 'utf8');
    const resumePageSrc = readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'onboarding', 'resume', 'page.tsx'), 'utf8');
    for (const src of [entryPageSrc, resumePageSrc]) {
      expect(src).toContain('session?.user?.orgType');
      expect(src).toContain('OrgType.EXTERNAL'); // fail-closed to the universal branch
      expect(src).toContain('<OnboardingFlow role={role} orgType={orgType}');
    }
  });

  test('R-02: the flow owns NO org-selection state — the O-3 continue handler builds its payload from the session org prop', () => {
    const handleOrgContinueBody = extractFunctionBody(flowSrc, 'handleOrgContinue');
    // R-05 — the payload is built from the session org with NO locally-held solution number (it is
    // captured once at registration; the server's T-R38 fallback reuses the persisted value).
    expect(handleOrgContinueBody).toContain('buildRoleOrgContextPayload(orgType, ');
    // No client-settable org exists anywhere in the shell anymore (tamper can't even be attempted).
    expect(flowSrc).not.toContain('setOrgType');
    expect(flowSrc).not.toContain('onSelectOrgType');
  });
});
