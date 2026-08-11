// R-08 (refinements catalog 2026-07-28) — structural (source-scan) proof that `OnboardingFlow.tsx`
// is actually WIRED to the real sponsor pool + the persisting decision route, and that the
// hard-coded empty pool is GONE. Mirrors the exact precedent of
// tests/unit/onboarding-flow-wiring.test.ts (this repo's node/no-jsdom Jest env cannot click
// client components — a source-scan is the deterministic proof of the wiring, with the behavioral
// proofs living in the sponsor-decision route/client suites).

import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(__dirname, '..', '..', 'src', 'app', 'onboarding');
const flowSrc = readFileSync(path.join(SRC, 'OnboardingFlow.tsx'), 'utf8');

describe('R-08 — the hard-coded empty candidate pool is GONE', () => {
  test('the matcher is never invoked with `candidates: []` — the old every-session-waitlist stub is gone', () => {
    expect(flowSrc).not.toMatch(/candidates:\s*\[\]/);
    expect(flowSrc).not.toContain('matchSponsor({ orgType: orgType ?? OrgType.EXTERNAL, candidates: [] }');
  });

  test('the pool comes from the server — fetchSponsorCandidates is imported and called', () => {
    expect(flowSrc).toContain("import { fetchSponsorCandidates, postSponsorDecision } from './sponsor-decision-client'");
    expect(flowSrc).toContain('fetchSponsorCandidates()');
  });

  test("the matcher runs over the REAL resolved pool — the 'linked' branch is reachable with a real candidate", () => {
    expect(flowSrc).toContain('matchSponsor(');
    expect(flowSrc).toContain('candidates: sponsorCandidates');
  });

  test('an unresolved/failed pool is rendered honestly (loading / retry) — never a fabricated verdict', () => {
    expect(flowSrc).toContain('onboarding.sponsor.loadingPool');
    expect(flowSrc).toContain('onboarding.sponsor.poolErrorTitle');
    expect(flowSrc).toContain('onboarding.sponsor.poolRetryCta');
  });
});

describe('R-08 — the four buttons persist a real choice server-side', () => {
  test('every button is bound to persistSponsorDecision — none advances bare', () => {
    expect(flowSrc).toContain('onAccept={() => void persistSponsorDecision(\'accept\')}');
    expect(flowSrc).toContain('onJoinWaitlist={() => void persistSponsorDecision(\'join_waitlist\')}');
    expect(flowSrc).toContain('onStartPaid={() => void persistSponsorDecision(\'start_paid\')}');
    expect(flowSrc).toContain('onNoUplineYet={() => void persistSponsorDecision(\'no_upline_yet\')}');
    // The old bare-advance wiring is gone.
    expect(flowSrc).not.toContain('onAccept={advance}');
    expect(flowSrc).not.toContain('onJoinWaitlist={advance}');
    expect(flowSrc).not.toContain('onStartPaid={advance}');
    expect(flowSrc).not.toContain('onNoUplineYet={advance}');
  });

  test('a rejected/failed decision never advances — the guard returns before advance() (fail-closed)', () => {
    const body = flowSrc.slice(flowSrc.indexOf('async function persistSponsorDecision'));
    const guardIdx = body.indexOf('if (!result.ok)');
    const returnIdx = body.indexOf('return;', guardIdx);
    const advanceIdx = body.indexOf('advance();', returnIdx);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(guardIdx);
    expect(advanceIdx).toBeGreaterThan(returnIdx);
  });

  test('the linked sponsor name is the REAL candidate name resolved server-side (never the localizer default shadowed)', () => {
    expect(flowSrc).toContain('sponsorCandidateNames[sponsorOutcome.sponsorId]');
  });

  test('R-01 preserved: the RVP no-pairing guard still replaces SponsorStep for an RVP (never re-added)', () => {
    expect(flowSrc).toContain("screen === 'sponsor' && !sponsorStepSkippedForRole(role)");
    expect(flowSrc).toContain("screen === 'sponsor' && sponsorStepSkippedForRole(role)");
    expect(flowSrc).toContain("t('onboarding.sponsor.rvpNoPairingHeadline')");
  });
});
