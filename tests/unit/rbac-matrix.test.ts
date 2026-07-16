import { Role } from '@prisma/client';
import type { Session } from 'next-auth';

import {
  can,
  canAccessCrossOrg,
  canAccessDownlinePIIAudited,
  MATRIX,
  type Resource,
} from '../../src/lib/auth/rbac-matrix';
import { hasCapability, requireCapability, RBACError } from '../../src/lib/auth/rbac';
import { RBACService } from '../../src/services/compliance/rbac/rbac-service';

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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (a) role WITH a §16.6 grant → allowed
// (b) role WITHOUT a grant → denied
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('can() — §16.6 grants (a: allowed / b: denied)', () => {
  test('REP is granted contacts:read/write/delete/export (row 1 "full")', () => {
    expect(can(Role.REP, 'contacts', 'read')).toBe(true);
    expect(can(Role.REP, 'contacts', 'write')).toBe(true);
    expect(can(Role.REP, 'contacts', 'delete')).toBe(true);
    expect(can(Role.REP, 'contacts', 'export')).toBe(true);
  });

  test('REP is denied downline_visibility:read (row 2 "—" for rep)', () => {
    expect(can(Role.REP, 'downline_visibility', 'read')).toBe(false);
  });

  test('REP is denied compliance_audit (row 4 "—" for rep — flagged-content review)', () => {
    expect(can(Role.REP, 'compliance_audit', 'read')).toBe(false);
    expect(can(Role.REP, 'compliance_audit', 'approve')).toBe(false);
  });

  test('UPLINE is granted downline_visibility:read but not compliance_audit:manage (team, not org-wide)', () => {
    expect(can(Role.UPLINE, 'downline_visibility', 'read')).toBe(true);
    expect(can(Role.UPLINE, 'compliance_audit', 'read')).toBe(true);
    expect(can(Role.UPLINE, 'compliance_audit', 'approve')).toBe(true);
    expect(can(Role.UPLINE, 'compliance_audit', 'manage')).toBe(false); // org-wide manage is rvp/admin only
  });

  test('RVP is granted org-wide compliance_audit:manage (row 4 "org-wide")', () => {
    expect(can(Role.RVP, 'compliance_audit', 'manage')).toBe(true);
  });

  test('RVP is denied org_seat_config:manage is FALSE for upline, TRUE for rvp (row 7)', () => {
    expect(can(Role.UPLINE, 'org_seat_config', 'manage')).toBe(false);
    expect(can(Role.RVP, 'org_seat_config', 'manage')).toBe(true);
    expect(can(Role.REP, 'org_seat_config', 'manage')).toBe(false);
  });

  test('billing_own:manage is granted to rep/upline/rvp/admin (row 5 "Billing (own)")', () => {
    expect(can(Role.REP, 'billing_own', 'manage')).toBe(true);
    expect(can(Role.UPLINE, 'billing_own', 'manage')).toBe(true);
    expect(can(Role.RVP, 'billing_own', 'manage')).toBe(true);
    expect(can(Role.ADMIN, 'billing_own', 'manage')).toBe(true);
  });

  test('billing_org: upline can only read (view downline), rvp/admin can manage (configure+pay) (row 6)', () => {
    expect(can(Role.UPLINE, 'billing_org', 'read')).toBe(true);
    expect(can(Role.UPLINE, 'billing_org', 'manage')).toBe(false);
    expect(can(Role.RVP, 'billing_org', 'manage')).toBe(true);
    expect(can(Role.ADMIN, 'billing_org', 'manage')).toBe(true);
    expect(can(Role.REP, 'billing_org', 'read')).toBe(false); // row 6 "—" for rep
  });

  test('cross_org: admin flat-granted, rep/upline/dual denied outright (row 9)', () => {
    expect(can(Role.ADMIN, 'cross_org', 'read')).toBe(true);
    expect(can(Role.REP, 'cross_org', 'read')).toBe(false);
    expect(can(Role.UPLINE, 'cross_org', 'read')).toBe(false);
    expect(can(Role.DUAL, 'cross_org', 'read')).toBe(false);
    // RVP is NOT flat-granted here — it's conditional. See canAccessCrossOrg tests below.
    expect(can(Role.RVP, 'cross_org', 'read')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (c) DUAL gets REP ∪ UPLINE, never RVP/ADMIN-only grants
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('can() — DUAL union semantics (c)', () => {
  test('DUAL gets contacts full access (present for REP)', () => {
    expect(can(Role.DUAL, 'contacts', 'read')).toBe(true);
    expect(can(Role.DUAL, 'contacts', 'delete')).toBe(true);
  });

  test('DUAL gets downline_visibility:read (present for UPLINE)', () => {
    expect(can(Role.DUAL, 'downline_visibility', 'read')).toBe(true);
  });

  test('DUAL gets billing_org:read (upline-side) but NOT billing_org:manage (rvp/admin-only)', () => {
    expect(can(Role.DUAL, 'billing_org', 'read')).toBe(true);
    expect(can(Role.DUAL, 'billing_org', 'manage')).toBe(false);
  });

  test('DUAL is denied org_seat_config:manage — rvp/admin-only, and neither rep nor upline has it to union from', () => {
    expect(can(Role.DUAL, 'org_seat_config', 'manage')).toBe(false);
  });

  test('DUAL is denied compliance_audit:manage — rvp/admin-only org-wide capability', () => {
    expect(can(Role.DUAL, 'compliance_audit', 'manage')).toBe(false);
    // but does get the upline-side team actions
    expect(can(Role.DUAL, 'compliance_audit', 'read')).toBe(true);
    expect(can(Role.DUAL, 'compliance_audit', 'approve')).toBe(true);
  });

  test('DUAL is denied data_rights:manage — ADMIN+RVP-only oversight action (f overlap)', () => {
    expect(can(Role.DUAL, 'data_rights', 'manage')).toBe(false);
  });

  test('a plain REP or UPLINE alone never reaches an RVP/ADMIN-only grant', () => {
    expect(can(Role.REP, 'org_seat_config', 'manage')).toBe(false);
    expect(can(Role.UPLINE, 'org_seat_config', 'manage')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (d) ADMIN-audited-only exception: ADMIN does NOT bypass the raw-PII/conversation exception
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('downline_pii — §16.6 row 3 audited-only exception (d)', () => {
  test('can() denies EVERY role, including ADMIN, on downline_pii — no bypass', () => {
    expect(can(Role.REP, 'downline_pii', 'read')).toBe(false);
    expect(can(Role.UPLINE, 'downline_pii', 'read')).toBe(false);
    expect(can(Role.RVP, 'downline_pii', 'read')).toBe(false);
    expect(can(Role.DUAL, 'downline_pii', 'read')).toBe(false);
    expect(can(Role.ADMIN, 'downline_pii', 'read')).toBe(false); // the teeth: admin is NOT bypassed
  });

  test('MATRIX.downline_pii has zero grants for any action (never a blanket admin allow)', () => {
    expect(Object.keys(MATRIX.downline_pii)).toHaveLength(0);
  });

  test('canAccessDownlinePIIAudited grants ONLY ADMIN, and ONLY with a real audit context', () => {
    expect(canAccessDownlinePIIAudited(Role.ADMIN, { actorId: 'admin-1', reason: 'compliance investigation' })).toBe(
      true
    );
    expect(canAccessDownlinePIIAudited(Role.ADMIN, null)).toBe(false);
    expect(canAccessDownlinePIIAudited(Role.ADMIN, { actorId: '', reason: '' })).toBe(false);
    expect(canAccessDownlinePIIAudited(Role.RVP, { actorId: 'rvp-1', reason: 'because' })).toBe(false);
    expect(canAccessDownlinePIIAudited(Role.UPLINE, { actorId: 'upline-1', reason: 'because' })).toBe(false);
  });

  test('requireCapability throws FORBIDDEN for ADMIN on downline_pii (the general guard never grants it)', () => {
    expect(() => requireCapability(fakeSession(Role.ADMIN), 'downline_pii', 'read')).toThrow(RBACError);
    try {
      requireCapability(fakeSession(Role.ADMIN), 'downline_pii', 'read');
    } catch (error) {
      expect((error as RBACError).code).toBe('FORBIDDEN');
    }
  });
});

describe('cross_org — §16.6 row 9 "gated behind admin approval" (rvp is conditional, not flat)', () => {
  test('RVP is denied without an approval token, granted with one', () => {
    expect(canAccessCrossOrg(Role.RVP, null)).toBe(false);
    expect(canAccessCrossOrg(Role.RVP, undefined)).toBe(false);
    expect(canAccessCrossOrg(Role.RVP, 'admin-42')).toBe(true);
  });

  test('ADMIN gets cross_org directly, with no approval token needed', () => {
    expect(canAccessCrossOrg(Role.ADMIN, null)).toBe(true);
  });

  test('REP/UPLINE/DUAL never get cross_org even with a token (row 9: never for them)', () => {
    expect(canAccessCrossOrg(Role.REP, 'admin-42')).toBe(false);
    expect(canAccessCrossOrg(Role.UPLINE, 'admin-42')).toBe(false);
    expect(canAccessCrossOrg(Role.DUAL, 'admin-42')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (e) unknown resource/action → deny (fail-closed)
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('fail-closed on unknown resource/action (e)', () => {
  test('an unknown resource string is denied for every role, admin included', () => {
    expect(can(Role.ADMIN, 'not_a_real_resource' as Resource, 'read')).toBe(false);
    expect(can(Role.REP, 'nonexistent' as Resource, 'manage')).toBe(false);
  });

  test('an unknown action on a known resource is denied for every role, admin included', () => {
    expect(can(Role.ADMIN, 'contacts', 'teleport' as never)).toBe(false);
    expect(can(Role.REP, 'contacts', 'teleport' as never)).toBe(false);
  });

  test('a known resource with no grant at all for that action (e.g. downline_pii) denies everyone', () => {
    expect(can(Role.ADMIN, 'downline_pii', 'manage' as never)).toBe(false);
  });

  test('hasCapability returns false (never throws) for a session-less caller', () => {
    expect(hasCapability(null, 'contacts', 'read')).toBe(false);
    expect(hasCapability(undefined, 'contacts', 'read')).toBe(false);
  });

  test('requireCapability throws UNAUTHENTICATED for no session, FORBIDDEN for an ungranted resource', () => {
    expect(() => requireCapability(null, 'contacts', 'read')).toThrow(RBACError);
    try {
      requireCapability(null, 'contacts', 'read');
    } catch (error) {
      expect((error as RBACError).code).toBe('UNAUTHENTICATED');
    }

    expect(() => requireCapability(fakeSession(Role.REP), 'org_seat_config', 'manage')).toThrow(RBACError);
    try {
      requireCapability(fakeSession(Role.REP), 'org_seat_config', 'manage');
    } catch (error) {
      expect((error as RBACError).code).toBe('FORBIDDEN');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (f) data_rights:manage = ADMIN + RVP only (the exact contract T-11's LegalHoldService depends on)
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('data_rights:manage = ADMIN + RVP only (f)', () => {
  const service = new RBACService();

  test('ADMIN and RVP are granted data_rights:manage', () => {
    expect(service.checkPermission(Role.ADMIN, 'data_rights', 'manage')).toBe(true);
    expect(service.checkPermission(Role.RVP, 'data_rights', 'manage')).toBe(true);
  });

  test('REP, UPLINE, and DUAL are all denied data_rights:manage', () => {
    expect(service.checkPermission(Role.REP, 'data_rights', 'manage')).toBe(false);
    expect(service.checkPermission(Role.UPLINE, 'data_rights', 'manage')).toBe(false);
    expect(service.checkPermission(Role.DUAL, 'data_rights', 'manage')).toBe(false);
  });

  test('assertPermission throws for a role without data_rights:manage, and is silent for one with it', () => {
    expect(() => service.assertPermission(Role.REP, 'data_rights', 'manage')).toThrow(
      /does not have 'manage' permission on 'data_rights'/
    );
    expect(() => service.assertPermission(Role.ADMIN, 'data_rights', 'manage')).not.toThrow();
    expect(() => service.assertPermission(Role.RVP, 'data_rights', 'manage')).not.toThrow();
  });

  test('reconciliation fix: ALL five roles now get data_rights:export/delete/read/write (§16.6 row 8 "yes" — the pre-T-14 matrix wrongly limited upline to read-only)', () => {
    for (const role of [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN, Role.DUAL]) {
      expect(service.checkPermission(role, 'data_rights', 'export')).toBe(true);
      expect(service.checkPermission(role, 'data_rights', 'delete')).toBe(true);
      expect(service.checkPermission(role, 'data_rights', 'read')).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// rbac-service.ts is now DERIVED from the same MATRIX (reconciliation — one authoritative source)
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('RBACService is derived from rbac-matrix.ts MATRIX (single authoritative source)', () => {
  const service = new RBACService();

  test.each([Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN, Role.DUAL])(
    'every MATRIX resource/action grant for %s agrees with RBACService.checkPermission',
    (role) => {
      for (const resource of Object.keys(MATRIX) as Resource[]) {
        for (const action of Object.keys(MATRIX[resource]) as (keyof (typeof MATRIX)[typeof resource])[]) {
          expect(service.checkPermission(role, resource, action as never)).toBe(
            can(role, resource, action as never)
          );
        }
      }
    }
  );

  test('an unrecognized resource/action is denied by RBACService too (fail-closed parity)', () => {
    expect(service.checkPermission(Role.ADMIN, 'not_a_real_resource' as Resource, 'read')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Stale Role type retirement (Wave 0 gate hand-forward)
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('stale compliance.ts Role type retirement', () => {
  test('the canonical Role enum (Prisma, used everywhere) is exactly the five §3.1 roles — no EXTERNAL', () => {
    expect(Object.values(Role).sort()).toEqual(['ADMIN', 'DUAL', 'REP', 'RVP', 'UPLINE'].sort());
    expect(Object.values(Role)).not.toContain('EXTERNAL');
  });

  test('rbac-service.ts ROLE_PERMISSIONS is keyed by exactly the five Prisma Role values (no stale EXTERNAL row)', () => {
    const service = new RBACService();
    for (const role of Object.values(Role)) {
      // Every real role resolves to a (possibly empty) permission list without throwing.
      expect(() => service.getPermissions(role)).not.toThrow();
    }
    // There is no sixth 'EXTERNAL' key possible — TypeScript enforces this at the Record<Role, ...>
    // level now that Role has five members, which is exactly the point of the retirement.
    expect(Object.keys(Role)).toHaveLength(5);
  });
});
