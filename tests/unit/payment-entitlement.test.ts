// WP10 (T-47) — real-time entitlement gate (§15.1 / §15.7-3). Status gate + tier-limit, and the
// cardinal §15.4/§15.3 rules: grace & member_grace keep FULL function; soft suspension is READ-ONLY
// (data intact); dispute suspends OUTBOUND only; a sponsored member is NEVER instantly locked.

import {
  PAYMENT_GRACE_DAYS,
  evaluateEntitlement,
  isFeatureAccessible,
  resolveBillingPhase,
  type BillingSnapshot,
  type EntitlementPrismaClient,
} from '@/services/payment/entitlement';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 2_000_000_000_000;

function snap(partial: Partial<BillingSnapshot>): BillingSnapshot {
  return {
    plan_tier: 'individual',
    status: 'ACTIVE',
    currentPeriodEndMs: NOW + 10 * DAY,
    sponsorshipState: null,
    sponsorshipGraceUntilMs: null,
    ...partial,
  };
}

describe('resolveBillingPhase (§15.4)', () => {
  test('ACTIVE → active', () => {
    expect(resolveBillingPhase(snap({ status: 'ACTIVE' }), NOW)).toBe('active');
  });
  test('PAST_DUE within the grace window → grace (full function)', () => {
    expect(resolveBillingPhase(snap({ status: 'PAST_DUE', currentPeriodEndMs: NOW - 1 * DAY }), NOW)).toBe('grace');
  });
  test('PAST_DUE past the grace window → soft_suspended (even if the sweep has not run)', () => {
    const end = NOW - (PAYMENT_GRACE_DAYS + 2) * DAY;
    expect(resolveBillingPhase(snap({ status: 'PAST_DUE', currentPeriodEndMs: end }), NOW)).toBe('soft_suspended');
  });
  test('EXPIRED → soft_suspended', () => {
    expect(resolveBillingPhase(snap({ status: 'EXPIRED' }), NOW)).toBe('soft_suspended');
  });
  test('DISPUTED → disputed', () => {
    expect(resolveBillingPhase(snap({ status: 'DISPUTED' }), NOW)).toBe('disputed');
  });
  test('CANCELED but within access-until → canceled_active_until; after → expired', () => {
    expect(resolveBillingPhase(snap({ status: 'CANCELED', currentPeriodEndMs: NOW + 3 * DAY }), NOW)).toBe(
      'canceled_active_until'
    );
    expect(resolveBillingPhase(snap({ status: 'CANCELED', currentPeriodEndMs: NOW - 3 * DAY }), NOW)).toBe('expired');
  });

  describe('sponsored member (§15.3 — never instantly punished for the sponsor card)', () => {
    test('ACTIVE sponsorship → member_active (full function)', () => {
      expect(resolveBillingPhase(snap({ plan_tier: 'free', status: 'ACTIVE', sponsorshipState: 'ACTIVE' }), NOW)).toBe(
        'member_active'
      );
    });
    test('MEMBER_GRACE within the 30-day window → member_grace (FULL function, not a lock)', () => {
      const s = snap({
        plan_tier: 'free',
        status: 'ACTIVE',
        sponsorshipState: 'MEMBER_GRACE',
        sponsorshipGraceUntilMs: NOW + 20 * DAY,
      });
      expect(resolveBillingPhase(s, NOW)).toBe('member_grace');
    });
    test('SPONSOR_LAPSED but not yet swept → still protected (member_grace), never an instant lock', () => {
      const s = snap({ plan_tier: 'free', sponsorshipState: 'SPONSOR_LAPSED' });
      expect(resolveBillingPhase(s, NOW)).toBe('member_grace');
    });
    test('MEMBER_GRACE past grace_until → soft_suspended (only after the full protected window)', () => {
      const s = snap({
        plan_tier: 'free',
        sponsorshipState: 'MEMBER_GRACE',
        sponsorshipGraceUntilMs: NOW - 1 * DAY,
      });
      expect(resolveBillingPhase(s, NOW)).toBe('soft_suspended');
    });
  });
});

describe('evaluateEntitlement matrix (§15.1)', () => {
  test('active: everything accessible', () => {
    for (const f of ['mission_control_view', 'contacts_edit', 'agent_outbound']) {
      expect(evaluateEntitlement(f, 'active', 'individual').accessible).toBe(true);
    }
  });
  test('grace & member_grace: FULL function (agents still send)', () => {
    expect(evaluateEntitlement('agent_outbound', 'grace', 'individual').accessible).toBe(true);
    expect(evaluateEntitlement('agent_outbound', 'member_grace', 'free').accessible).toBe(true);
  });
  test('soft_suspended: read OK, write/outbound DENIED (read-only, data intact)', () => {
    expect(evaluateEntitlement('mission_control_view', 'soft_suspended', 'individual').accessible).toBe(true);
    expect(evaluateEntitlement('contacts_edit', 'soft_suspended', 'individual')).toMatchObject({
      accessible: false,
      reason: 'soft_suspended_read_only',
    });
    expect(evaluateEntitlement('agent_outbound', 'soft_suspended', 'individual').accessible).toBe(false);
  });
  test('disputed: outbound DENIED, read+write retained (§15.5)', () => {
    expect(evaluateEntitlement('agent_outbound', 'disputed', 'individual')).toMatchObject({
      accessible: false,
      reason: 'disputed_outbound_suspended',
    });
    expect(evaluateEntitlement('mission_control_view', 'disputed', 'individual').accessible).toBe(true);
    expect(evaluateEntitlement('contacts_edit', 'disputed', 'individual').accessible).toBe(true);
  });
  test('tier-limit: enterprise-only features require the enterprise plan', () => {
    expect(evaluateEntitlement('org_analytics', 'active', 'individual')).toMatchObject({
      accessible: false,
      reason: 'enterprise_tier_required',
    });
    expect(evaluateEntitlement('org_analytics', 'active', 'enterprise').accessible).toBe(true);
  });
  test('unknown feature fails CLOSED to outbound (denied in a suspended phase)', () => {
    expect(evaluateEntitlement('some_new_unregistered_feature', 'soft_suspended', 'individual').accessible).toBe(false);
  });
});

describe('isFeatureAccessible (real-time resolver)', () => {
  function mockPrisma(sub: unknown, sponsorship: unknown): EntitlementPrismaClient {
    return {
      subscription: { findFirst: jest.fn().mockResolvedValue(sub) },
      sponsorship: { findFirst: jest.fn().mockResolvedValue(sponsorship) },
    } as unknown as EntitlementPrismaClient;
  }

  test('reads live subscription + sponsorship and gates in real time', async () => {
    const prisma = mockPrisma(
      { plan_tier: 'individual', status: 'EXPIRED', current_period_end: new Date(NOW - DAY) },
      null
    );
    const decision = await isFeatureAccessible(prisma, 'u1', 'agent_outbound', NOW);
    expect(decision).toMatchObject({ accessible: false, phase: 'soft_suspended' });
  });

  test('a sponsored member in MEMBER_GRACE keeps full function', async () => {
    const prisma = mockPrisma(
      { plan_tier: 'free', status: 'ACTIVE', current_period_end: new Date(NOW + DAY) },
      { state: 'MEMBER_GRACE', grace_until: new Date(NOW + 20 * DAY) }
    );
    const decision = await isFeatureAccessible(prisma, 'u1', 'agent_outbound', NOW);
    expect(decision).toMatchObject({ accessible: true, phase: 'member_grace' });
  });
});
