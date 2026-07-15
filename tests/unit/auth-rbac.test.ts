import { Role } from '@prisma/client';
import type { Session } from 'next-auth';

import { hasRole, RBACError, requireRole, roleSatisfies } from '../../src/lib/auth/rbac';
import {
  isMfaRequiredForRole,
  MFA_REQUIRED_ROLES,
  requireStepUp,
  StepUpRequiredError,
} from '../../src/lib/auth/mfa';

function fakeSession(role: Role): Session {
  return {
    user: {
      id: 'user-1',
      role,
      orgType: 'EXTERNAL',
      organizationId: null,
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

describe('roleSatisfies (pure allow-list check)', () => {
  test('an exact role match is allowed', () => {
    expect(roleSatisfies(Role.REP, [Role.REP])).toBe(true);
    expect(roleSatisfies(Role.UPLINE, [Role.UPLINE, Role.RVP])).toBe(true);
    expect(roleSatisfies(Role.RVP, [Role.RVP])).toBe(true);
  });

  test('a role not on the allow-list is denied', () => {
    expect(roleSatisfies(Role.REP, [Role.UPLINE])).toBe(false);
    expect(roleSatisfies(Role.UPLINE, [Role.REP, Role.RVP])).toBe(false);
  });

  test('ADMIN bypasses any allow-list by default (§16.6 "full" access)', () => {
    expect(roleSatisfies(Role.ADMIN, [Role.REP])).toBe(true);
    expect(roleSatisfies(Role.ADMIN, [Role.UPLINE, Role.RVP])).toBe(true);
  });

  test('adminBypass: false disables the ADMIN bypass for audited-only capabilities', () => {
    expect(roleSatisfies(Role.ADMIN, [Role.REP], { adminBypass: false })).toBe(false);
    // ADMIN explicitly on the list still passes even with adminBypass disabled.
    expect(roleSatisfies(Role.ADMIN, [Role.ADMIN], { adminBypass: false })).toBe(true);
  });

  describe('DUAL role (§6.2 "concurrent rep + upline; union permissions")', () => {
    test('DUAL satisfies a REP-only allow-list', () => {
      expect(roleSatisfies(Role.DUAL, [Role.REP])).toBe(true);
    });

    test('DUAL satisfies an UPLINE-only allow-list', () => {
      expect(roleSatisfies(Role.DUAL, [Role.UPLINE])).toBe(true);
    });

    test('DUAL satisfies a REP+UPLINE allow-list', () => {
      expect(roleSatisfies(Role.DUAL, [Role.REP, Role.UPLINE])).toBe(true);
    });

    test('DUAL is denied an RVP-only allow-list (RVP is a distinct tier above upline, §6.2)', () => {
      expect(roleSatisfies(Role.DUAL, [Role.RVP])).toBe(false);
    });

    test('DUAL is denied an ADMIN-only allow-list', () => {
      expect(roleSatisfies(Role.DUAL, [Role.ADMIN])).toBe(false);
    });

    test('a plain REP does not get DUAL\'s union — REP alone cannot reach an UPLINE-only allow-list', () => {
      expect(roleSatisfies(Role.REP, [Role.UPLINE])).toBe(false);
    });
  });

  test('the five-role enum is exactly REP | UPLINE | RVP | ADMIN | DUAL (§3.1)', () => {
    expect(Object.values(Role).sort()).toEqual(['ADMIN', 'DUAL', 'REP', 'RVP', 'UPLINE'].sort());
  });
});

describe('hasRole (non-throwing session check)', () => {
  test('returns true when the session role satisfies the allow-list', () => {
    expect(hasRole(fakeSession(Role.RVP), [Role.RVP, Role.ADMIN])).toBe(true);
  });

  test('returns false when the session role does not satisfy the allow-list', () => {
    expect(hasRole(fakeSession(Role.REP), [Role.RVP, Role.ADMIN])).toBe(false);
  });

  test('returns false for a null/undefined session (no throw)', () => {
    expect(hasRole(null, [Role.REP])).toBe(false);
    expect(hasRole(undefined, [Role.REP])).toBe(false);
  });
});

describe('requireRole (throwing guard)', () => {
  test('does not throw when the role is allowed', () => {
    expect(() => requireRole(fakeSession(Role.REP), [Role.REP])).not.toThrow();
  });

  test('throws RBACError("UNAUTHENTICATED") for a null session', () => {
    try {
      requireRole(null, [Role.REP]);
      throw new Error('expected requireRole to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RBACError);
      expect((error as RBACError).code).toBe('UNAUTHENTICATED');
      expect((error as RBACError).status).toBe(401);
    }
  });

  test('throws RBACError("FORBIDDEN") when the role is not on the allow-list', () => {
    try {
      requireRole(fakeSession(Role.REP), [Role.UPLINE, Role.RVP]);
      throw new Error('expected requireRole to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RBACError);
      expect((error as RBACError).code).toBe('FORBIDDEN');
      expect((error as RBACError).status).toBe(403);
      expect((error as RBACError).actualRole).toBe(Role.REP);
      expect((error as RBACError).allowedRoles).toEqual([Role.UPLINE, Role.RVP]);
    }
  });

  test('allows a DUAL session through a REP-scoped guard', () => {
    expect(() => requireRole(fakeSession(Role.DUAL), [Role.REP])).not.toThrow();
  });

  test('allows a DUAL session through an UPLINE-scoped guard', () => {
    expect(() => requireRole(fakeSession(Role.DUAL), [Role.UPLINE])).not.toThrow();
  });

  test('denies a DUAL session against an RVP-scoped guard', () => {
    expect(() => requireRole(fakeSession(Role.DUAL), [Role.RVP])).toThrow(RBACError);
  });

  test('allows ADMIN through any role-scoped guard by default', () => {
    expect(() => requireRole(fakeSession(Role.ADMIN), [Role.REP])).not.toThrow();
    expect(() => requireRole(fakeSession(Role.ADMIN), [Role.RVP])).not.toThrow();
  });
});

describe('MFA-capable hook points (T-04 scaffold; enforcement lands in T-12)', () => {
  test('MFA is required for UPLINE, RVP, ADMIN, and DUAL (§16.4)', () => {
    expect(isMfaRequiredForRole(Role.UPLINE)).toBe(true);
    expect(isMfaRequiredForRole(Role.RVP)).toBe(true);
    expect(isMfaRequiredForRole(Role.ADMIN)).toBe(true);
    expect(isMfaRequiredForRole(Role.DUAL)).toBe(true);
  });

  test('MFA is offered, not required, for REP (§16.4)', () => {
    expect(isMfaRequiredForRole(Role.REP)).toBe(false);
    expect(MFA_REQUIRED_ROLES).not.toContain(Role.REP);
  });

  test('requireStepUp is a documented no-op in T-04 (T-12 implements real enforcement)', () => {
    expect(() =>
      requireStepUp({ mfaEnrolled: false, mfaVerifiedAt: null }, 'billing_change')
    ).not.toThrow();
    expect(() =>
      requireStepUp({ mfaEnrolled: true, mfaVerifiedAt: null }, 'data_delete')
    ).not.toThrow();
  });

  test('StepUpRequiredError carries the action name for T-12 to use', () => {
    const error = new StepUpRequiredError('rbac_change');
    expect(error.action).toBe('rbac_change');
    expect(error.message).toContain('rbac_change');
  });
});
