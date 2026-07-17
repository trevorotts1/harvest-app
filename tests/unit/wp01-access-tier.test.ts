// WP01 §6.7 — access-tier assignment. Proves (c): every registration path produces the correct
// real Prisma `AccessTier` value, and NEVER a `$49`/`$199`-era value (those values do not exist in
// the enum at all — the test also sweeps `ACCESS_TIER_PRICE_CENTS` for a stray legacy price).

import { AccessTier, Role } from '@prisma/client';

import {
  ACCESS_TIER_PRICE_CENTS,
  AccessTierAuthorizationError,
  adminProvisionEnterpriseTier,
  assignAccessTier,
  assignAccessTierFromSignals,
  canProvisionEnterpriseTier,
  resolveRegistrationPath,
  type RegistrationPath,
} from '../../src/services/onboarding/wp01/access-tier';

describe('WP01 access-tier assignment — §6.7', () => {
  describe('assignAccessTier — the exhaustive §6.7 rule', () => {
    test('email/password, no sponsor → FREE_PAID_EXTERNAL', () => {
      expect(assignAccessTier('email_password_no_sponsor')).toBe(AccessTier.FREE_PAID_EXTERNAL);
    });

    test('email/password WITH sponsor invite → FREE_ORG_LINKED', () => {
      expect(assignAccessTier('email_password_with_sponsor')).toBe(AccessTier.FREE_ORG_LINKED);
    });

    test('Primerica-portal OAuth → FREE_ORG_LINKED', () => {
      expect(assignAccessTier('primerica_portal_oauth')).toBe(AccessTier.FREE_ORG_LINKED);
    });

    test('admin provisioning → ENTERPRISE', () => {
      expect(assignAccessTier('admin_provisioning')).toBe(AccessTier.ENTERPRISE);
    });

    test('post-subscription upgrade → PAID_INDIVIDUAL', () => {
      expect(assignAccessTier('post_subscription_upgrade')).toBe(AccessTier.PAID_INDIVIDUAL);
    });

    test('every path produces a genuine Prisma AccessTier enum member — never undefined/null/a stray string', () => {
      const paths: RegistrationPath[] = [
        'email_password_no_sponsor',
        'email_password_with_sponsor',
        'primerica_portal_oauth',
        'admin_provisioning',
        'post_subscription_upgrade',
      ];
      const validTiers = new Set(Object.values(AccessTier));
      for (const path of paths) {
        const tier = assignAccessTier(path);
        expect(validTiers.has(tier)).toBe(true);
      }
    });
  });

  describe('resolveRegistrationPath — fail-closed precedence over raw signals', () => {
    test('admin-provisioned always wins, even alongside a sponsor/portal signal', () => {
      expect(
        resolveRegistrationPath({
          authMethod: 'primerica_portal_oauth',
          sponsorLinked: true,
          adminProvisioned: true,
        })
      ).toBe('admin_provisioning');
    });

    test('subscription-upgrade wins over sponsor/auth signals when admin is not set', () => {
      expect(
        resolveRegistrationPath({ authMethod: 'email_password', sponsorLinked: true, subscriptionUpgrade: true })
      ).toBe('post_subscription_upgrade');
    });

    test('Primerica-portal OAuth resolves to its own path regardless of sponsorLinked', () => {
      expect(resolveRegistrationPath({ authMethod: 'primerica_portal_oauth', sponsorLinked: false })).toBe(
        'primerica_portal_oauth'
      );
    });

    test('email/password + sponsorLinked=true → email_password_with_sponsor', () => {
      expect(resolveRegistrationPath({ authMethod: 'email_password', sponsorLinked: true })).toBe(
        'email_password_with_sponsor'
      );
    });

    test('email/password + no sponsor → email_password_no_sponsor (the ordinary default, never a dead end)', () => {
      expect(resolveRegistrationPath({ authMethod: 'email_password', sponsorLinked: false })).toBe(
        'email_password_no_sponsor'
      );
    });

    test('assignAccessTierFromSignals composes resolve + assign in one call', () => {
      expect(
        assignAccessTierFromSignals({ authMethod: 'email_password', sponsorLinked: false })
      ).toBe(AccessTier.FREE_PAID_EXTERNAL);
      expect(
        assignAccessTierFromSignals({ authMethod: 'email_password', sponsorLinked: true })
      ).toBe(AccessTier.FREE_ORG_LINKED);
    });
  });

  // (c) RBAC-gated tier assignment: admin provisioning is the ONE manual tier action §6.7 names,
  // and it is gated to ADMIN only (§16.6 access_tier_assignment row) — not even RVP.
  describe('adminProvisionEnterpriseTier — RBAC-gated (§6.7 admin-only, teeth)', () => {
    test('ADMIN is authorized and receives ENTERPRISE', () => {
      expect(canProvisionEnterpriseTier(Role.ADMIN)).toBe(true);
      expect(adminProvisionEnterpriseTier(Role.ADMIN)).toBe(AccessTier.ENTERPRISE);
    });

    test.each([Role.REP, Role.UPLINE, Role.RVP, Role.DUAL])(
      '%s is DENIED — throws AccessTierAuthorizationError, never silently returns a tier',
      (role) => {
        expect(canProvisionEnterpriseTier(role)).toBe(false);
        expect(() => adminProvisionEnterpriseTier(role)).toThrow(AccessTierAuthorizationError);
      }
    );
  });

  // Confirms the §0.2/§15.1 locked pricing and that no `$49`/`$199`-era value can appear anywhere
  // WP10 reads from this module.
  describe('ACCESS_TIER_PRICE_CENTS — locked pricing only, no $49/$199 (§0.2/§15.1)', () => {
    test('exactly $0 / $0 / $297 / $25,000 in cents', () => {
      expect(ACCESS_TIER_PRICE_CENTS[AccessTier.FREE_ORG_LINKED]).toBe(0);
      expect(ACCESS_TIER_PRICE_CENTS[AccessTier.FREE_PAID_EXTERNAL]).toBe(0);
      expect(ACCESS_TIER_PRICE_CENTS[AccessTier.PAID_INDIVIDUAL]).toBe(29_700);
      expect(ACCESS_TIER_PRICE_CENTS[AccessTier.ENTERPRISE]).toBe(2_500_000);
    });

    test('no stray $49 (4900 cents) or $199 (19900 cents) legacy value appears anywhere in the table', () => {
      const forbiddenCents = new Set([4_900, 19_900]);
      for (const cents of Object.values(ACCESS_TIER_PRICE_CENTS)) {
        expect(forbiddenCents.has(cents)).toBe(false);
      }
    });
  });
});
