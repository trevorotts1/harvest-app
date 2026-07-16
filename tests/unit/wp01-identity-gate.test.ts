// WP01 §6.1 — master identity gate. Proves QC critical failure (d) is ABSENT: the org/identity gate
// cannot be bypassed (unauthenticated or wrong/forged identity is denied), and no WP02–WP10 surface
// is reachable before gated_complete (§6.10-1).

import { AccessTier, OnboardingStatus, OrgType, Role } from '@prisma/client';

import {
  IdentityGateError,
  ONBOARDING_RESUME_PATH,
  evaluateOnboardingGate,
  requireIdentity,
  resolveIdentity,
  type IdentitySession,
} from '../../src/services/onboarding/wp01/identity-gate';

const validUser = {
  id: 'user-1',
  role: Role.REP,
  orgType: OrgType.EXTERNAL,
  organizationId: null,
  accessTier: AccessTier.FREE_PAID_EXTERNAL,
};

describe('WP01 master identity gate (§6.1)', () => {
  describe('fail-closed — the gate cannot be bypassed (critical failure d)', () => {
    test('no session at all → UNAUTHENTICATED', () => {
      expect(resolveIdentity(null)).toEqual({ ok: false, reason: 'UNAUTHENTICATED' });
      expect(resolveIdentity(undefined)).toEqual({ ok: false, reason: 'UNAUTHENTICATED' });
    });

    test('session with no user → UNAUTHENTICATED', () => {
      expect(resolveIdentity({ user: null })).toEqual({ ok: false, reason: 'UNAUTHENTICATED' });
      expect(resolveIdentity({} as IdentitySession)).toEqual({
        ok: false,
        reason: 'UNAUTHENTICATED',
      });
    });

    test('user missing an id → UNAUTHENTICATED (cannot proceed anonymously)', () => {
      expect(resolveIdentity({ user: { role: Role.REP } } as IdentitySession)).toEqual({
        ok: false,
        reason: 'UNAUTHENTICATED',
      });
    });

    test('forged/garbage role is rejected, never coerced to a default', () => {
      const forged = { user: { ...validUser, role: 'SUPERUSER' } } as unknown as IdentitySession;
      expect(resolveIdentity(forged)).toEqual({ ok: false, reason: 'INCOMPLETE_IDENTITY' });
    });

    test('out-of-enum org type is rejected (no default branch is inferred)', () => {
      const forged = { user: { ...validUser, orgType: 'PARTNER' } } as unknown as IdentitySession;
      expect(resolveIdentity(forged)).toEqual({ ok: false, reason: 'INCOMPLETE_IDENTITY' });
    });

    test('missing access tier is rejected', () => {
      const noTier = { user: { id: 'u', role: Role.REP, orgType: OrgType.EXTERNAL } };
      expect(resolveIdentity(noTier as IdentitySession)).toEqual({
        ok: false,
        reason: 'INCOMPLETE_IDENTITY',
      });
    });

    test('requireIdentity throws 401 for unauthenticated and 403 for a forged identity', () => {
      try {
        requireIdentity(null);
        throw new Error('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(IdentityGateError);
        expect((e as IdentityGateError).status).toBe(401);
      }

      const forged = { user: { ...validUser, role: 'SUPERUSER' } } as unknown as IdentitySession;
      try {
        requireIdentity(forged);
        throw new Error('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(IdentityGateError);
        expect((e as IdentityGateError).status).toBe(403);
      }
    });

    // TEETH: if the id-presence guard were removed, an anonymous session would resolve `ok:true`.
    test('a valid, fully-populated session passes and is wired to the 5-role + org model', () => {
      const result = resolveIdentity({ user: validUser } as IdentitySession);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.identity).toEqual({
          userId: 'user-1',
          role: Role.REP,
          orgType: OrgType.EXTERNAL,
          organizationId: null,
          accessTier: AccessTier.FREE_PAID_EXTERNAL,
        });
      }
    });
  });

  describe('hard onboarding gate — no downstream feature before gated_complete (§6.10-1)', () => {
    test('IN_PROGRESS is blocked and redirected to the resume path keyed to the last step', () => {
      const outcome = evaluateOnboardingGate(OnboardingStatus.IN_PROGRESS, 'SEVEN_WHYS');
      expect(outcome.allowed).toBe(false);
      if (!outcome.allowed) {
        expect(outcome.redirectTo).toBe(`${ONBOARDING_RESUME_PATH}?step=SEVEN_WHYS`);
      }
    });

    test('an unknown/garbage status fails closed (blocked), never allowed', () => {
      const outcome = evaluateOnboardingGate('SOMETHING_ELSE', 'INTENSITY');
      expect(outcome.allowed).toBe(false);
    });

    test('GATED_COMPLETE is the ONLY status that unlocks downstream features', () => {
      expect(evaluateOnboardingGate(OnboardingStatus.GATED_COMPLETE, 'INTENSITY')).toEqual({
        allowed: true,
      });
    });
  });
});
