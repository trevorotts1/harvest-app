// WP10 (T-47) — provisioning from the §6.7/§15.2 contract (qc-checklist WP10 checkpoint 2).
// PROVE: never before onboarding_completed; idempotent (no double-provision); sponsored = no card.

import { AccessTier, OnboardingStatus, SubscriptionStatus } from '@prisma/client';

import {
  ProvisioningNotAllowedError,
  accessTierRequiresNoCard,
  provisionFromContract,
  type ProvisioningPrismaClient,
} from '@/services/payment/provisioning';

function buildPrisma(opts: {
  onboardingStatus: OnboardingStatus | null;
  existingActive?: boolean;
  sponsorUserId?: string | null;
}): { prisma: ProvisioningPrismaClient; created: jest.Mock } {
  const created = jest.fn().mockImplementation(({ data }) =>
    Promise.resolve({
      id: 'sub_new',
      user_id: data.user_id,
      plan_tier: data.plan_tier,
      status: data.status,
      org_sponsored: data.org_sponsored,
      sponsor_user_id: data.sponsor_user_id,
    })
  );
  const prisma: ProvisioningPrismaClient = {
    user: {
      findUnique: jest.fn().mockResolvedValue(
        opts.onboardingStatus === null ? null : { onboarding_status: opts.onboardingStatus }
      ),
    },
    subscription: {
      findFirst: jest.fn().mockResolvedValue(
        opts.existingActive
          ? {
              id: 'sub_existing',
              user_id: 'u1',
              plan_tier: 'free',
              status: SubscriptionStatus.ACTIVE,
              org_sponsored: true,
              sponsor_user_id: 'sp1',
            }
          : null
      ),
      create: created,
    },
    sponsorship: {
      findFirst: jest.fn().mockResolvedValue(
        opts.sponsorUserId ? { sponsor_user_id: opts.sponsorUserId } : null
      ),
    },
  };
  return { prisma, created };
}

describe('provisionFromContract', () => {
  test('REFUSES to provision before onboarding_completed (§15.2) — throws, creates nothing', async () => {
    const { prisma, created } = buildPrisma({ onboardingStatus: OnboardingStatus.IN_PROGRESS });
    await expect(
      provisionFromContract(prisma, { user_id: 'u1', access_tier: AccessTier.FREE_ORG_LINKED })
    ).rejects.toBeInstanceOf(ProvisioningNotAllowedError);
    expect(created).not.toHaveBeenCalled();
  });

  test('REFUSES for a missing user row (fail-closed)', async () => {
    const { prisma } = buildPrisma({ onboardingStatus: null });
    await expect(
      provisionFromContract(prisma, { user_id: 'ghost', access_tier: AccessTier.PAID_INDIVIDUAL })
    ).rejects.toBeInstanceOf(ProvisioningNotAllowedError);
  });

  test('provisions the free plan for a sponsored (org-linked) member, no card, sponsor linked', async () => {
    const { prisma, created } = buildPrisma({
      onboardingStatus: OnboardingStatus.GATED_COMPLETE,
      sponsorUserId: 'sponsor-42',
    });
    const result = await provisionFromContract(prisma, {
      user_id: 'u1',
      access_tier: AccessTier.FREE_ORG_LINKED,
    });
    expect(result.provisioned).toBe(true);
    expect(created).toHaveBeenCalledTimes(1);
    const data = created.mock.calls[0][0].data;
    expect(data.plan_tier).toBe('free');
    expect(data.org_sponsored).toBe(true);
    expect(data.sponsor_user_id).toBe('sponsor-42');
  });

  test('provisions the individual plan (self-serve external) as NOT org_sponsored', async () => {
    const { prisma, created } = buildPrisma({ onboardingStatus: OnboardingStatus.GATED_COMPLETE });
    const result = await provisionFromContract(prisma, {
      user_id: 'u1',
      access_tier: AccessTier.PAID_INDIVIDUAL,
    });
    expect(result.provisioned).toBe(true);
    expect(created.mock.calls[0][0].data.plan_tier).toBe('individual');
    expect(created.mock.calls[0][0].data.org_sponsored).toBe(false);
  });

  test('IDEMPOTENT: an already-ACTIVE subscription is not re-provisioned (no double-provision)', async () => {
    const { prisma, created } = buildPrisma({
      onboardingStatus: OnboardingStatus.GATED_COMPLETE,
      existingActive: true,
    });
    const result = await provisionFromContract(prisma, {
      user_id: 'u1',
      access_tier: AccessTier.FREE_ORG_LINKED,
    });
    expect(result.provisioned).toBe(false);
    expect(result.subscription.id).toBe('sub_existing');
    expect(created).not.toHaveBeenCalled();
  });

  test('both free access tiers require no card on file (§15.1 / AC-5.8-2)', () => {
    expect(accessTierRequiresNoCard(AccessTier.FREE_ORG_LINKED)).toBe(true);
    expect(accessTierRequiresNoCard(AccessTier.FREE_PAID_EXTERNAL)).toBe(true);
    expect(accessTierRequiresNoCard(AccessTier.PAID_INDIVIDUAL)).toBe(false);
    expect(accessTierRequiresNoCard(AccessTier.ENTERPRISE)).toBe(false);
  });
});
