// WP01 §6.3 — onboarding tracks A/B/D shells + the licensure hard-block. Proves QC critical failure
// (e) is ABSENT: a regulated role cannot pass a licensure-gated track step / reach gated_complete on
// an invalid license (§6.8, §16.5, §6.10-7). The block is proven against the REAL T-13 §16.5 state
// machine + LicensingService (in-memory repo), not a mock — so if T-13's rule changed, this follows.

import { Role } from '@prisma/client';

import {
  InMemoryLicensingRepository,
  LicensingService,
} from '../../src/services/compliance/licensing';
import {
  COMPLIANCE_ADVISORY_ROUTE,
  TRACKS,
  evaluateStepGate,
  evaluateTrackCompletion,
  evaluateTrackCompletionAsync,
  stepsForRole,
  trackForRole,
  trackRequiresLicensure,
} from '../../src/services/onboarding/wp01/tracks';

describe('WP01 onboarding tracks A/B/D (§6.3)', () => {
  describe('track shells + role → track mapping', () => {
    test('REP → Flow A (cinematic); UPLINE → Flow B (dense, <7min); RVP → Flow D', () => {
      expect(trackForRole(Role.REP)).toBe('A');
      expect(trackForRole(Role.UPLINE)).toBe('B');
      expect(trackForRole(Role.RVP)).toBe('D');
      expect(TRACKS.A.style).toBe('cinematic');
      expect(TRACKS.B.style).toBe('dense');
      expect(TRACKS.B.targetMinutes).toBe(7);
    });

    test('DUAL loads upline steps IN ADDITION TO rep steps (§6.2 union, deduped)', () => {
      const dualSteps = stepsForRole(Role.DUAL).map((s) => s.key);
      const repSteps = TRACKS.A.steps.map((s) => s.key);
      // Every rep step is present …
      for (const key of repSteps) expect(dualSteps).toContain(key);
      // … plus the upline-only FINRA licensure step from Flow B …
      expect(dualSteps).toContain('finra_licensure');
      // … with no duplicated shared step (identity_capture appears once).
      expect(dualSteps.filter((k) => k === 'identity_capture')).toHaveLength(1);
    });

    test('only regulated tracks carry a licensure gate', () => {
      expect(trackRequiresLicensure(Role.REP)).toBe(false);
      expect(trackRequiresLicensure(Role.ADMIN)).toBe(false);
      expect(trackRequiresLicensure(Role.UPLINE)).toBe(true);
      expect(trackRequiresLicensure(Role.RVP)).toBe(true);
      expect(trackRequiresLicensure(Role.DUAL)).toBe(true);
    });
  });

  describe('the licensure hard-block — synchronous, over a known §16.5 state', () => {
    test('an UPLINE cannot complete UNLICENSED / PRE_LICENSING / LICENSE_EXPIRED', () => {
      for (const state of ['UNLICENSED', 'PRE_LICENSING', 'LICENSE_EXPIRED'] as const) {
        const outcome = evaluateTrackCompletion(Role.UPLINE, state);
        expect(outcome.allowed).toBe(false);
        if (!outcome.allowed) {
          expect(outcome.reason).toBe('LICENSURE_REQUIRED');
          expect(outcome.route).toBe(COMPLIANCE_ADVISORY_ROUTE);
        }
      }
    });

    test('an UPLINE CAN complete when LICENSED', () => {
      expect(evaluateTrackCompletion(Role.UPLINE, 'LICENSED')).toEqual({ allowed: true });
    });

    test('a REP is never licensure-blocked (Flow A has no licensure gate)', () => {
      expect(evaluateTrackCompletion(Role.REP, 'UNLICENSED')).toEqual({ allowed: true });
    });

    test('evaluateStepGate blocks a licensure-gated step for an unlicensed user', () => {
      const gated = { key: 'finra_licensure', label: 'x', requiresLicensure: true };
      expect(evaluateStepGate(gated, { licensed: false }).allowed).toBe(false);
      expect(evaluateStepGate(gated, { licensed: true })).toEqual({ allowed: true });
      // A non-gated step is unaffected.
      expect(evaluateStepGate({ key: 'org_rank', label: 'x' }, { licensed: false })).toEqual({
        allowed: true,
      });
    });
    // TEETH: if requiresLicensure were dropped from the FINRA step, the unlicensed-block assertions
    // above would flip to allowed — an invalid-license passage.
  });

  describe('the licensure hard-block — async, backed by the REAL T-13 LicensingService', () => {
    const JURISDICTION = 'TX';

    function makeService() {
      return new LicensingService(new InMemoryLicensingRepository());
    }

    async function licenseUser(svc: LicensingService, userId: string) {
      const actor = { actor_id: 'admin-1', actor_role: 'ADMIN', reason: 'test setup' };
      await svc.applyTransition(userId, JURISDICTION, 'START_PRE_LICENSING', actor);
      await svc.applyTransition(userId, JURISDICTION, 'OBTAIN_LICENSE', actor);
    }

    test('an UPLINE with NO license record (UNLICENSED, fail-closed) is hard-blocked', async () => {
      const svc = makeService();
      const outcome = await evaluateTrackCompletionAsync(Role.UPLINE, 'never-licensed', svc);
      expect(outcome.allowed).toBe(false);
      if (!outcome.allowed) {
        expect(outcome.reason).toBe('LICENSURE_REQUIRED');
        expect(outcome.route).toBe(COMPLIANCE_ADVISORY_ROUTE);
      }
    });

    test('an UPLINE still in PRE_LICENSING is hard-blocked (only LICENSED clears)', async () => {
      const svc = makeService();
      await svc.applyTransition('pre-lic-user', JURISDICTION, 'START_PRE_LICENSING', {
        actor_id: 'admin-1',
      });
      const outcome = await evaluateTrackCompletionAsync(Role.UPLINE, 'pre-lic-user', svc);
      expect(outcome.allowed).toBe(false);
    });

    test('an UPLINE that reaches LICENSED clears the gate', async () => {
      const svc = makeService();
      await licenseUser(svc, 'licensed-upline');
      const outcome = await evaluateTrackCompletionAsync(Role.UPLINE, 'licensed-upline', svc);
      expect(outcome).toEqual({ allowed: true });
    });

    test('a DUAL user (inherits Flow B licensure) is blocked unlicensed, cleared once licensed', async () => {
      const svc = makeService();
      const blocked = await evaluateTrackCompletionAsync(Role.DUAL, 'dual-unlicensed', svc);
      expect(blocked.allowed).toBe(false);

      await licenseUser(svc, 'dual-licensed');
      const cleared = await evaluateTrackCompletionAsync(Role.DUAL, 'dual-licensed', svc);
      expect(cleared).toEqual({ allowed: true });
    });

    test('a REP is not licensure-gated regardless of licensing state', async () => {
      const svc = makeService();
      const outcome = await evaluateTrackCompletionAsync(Role.REP, 'rep-unlicensed', svc);
      expect(outcome).toEqual({ allowed: true });
    });
  });
});
