import { subscriptionService, PLAN_CONFIGS } from '../../src/services/payment/subscription.service';
import { SubscriptionTier, SubscriptionStatus } from '../../src/types/payment';

describe('Payment Service', () => {
  beforeEach(() => subscriptionService.resetStore());

  test('FREE tier has basic features', () => {
    const config = PLAN_CONFIGS[SubscriptionTier.FREE];
    expect(config.priceMonthly).toBe(0);
    expect(config.features).toContain('Basic onboarding');
    expect(config.features).not.toContain('AI agents');
  });

  test('ESSENTIAL tier unlocks agents and messaging', () => {
    const config = PLAN_CONFIGS[SubscriptionTier.ESSENTIAL];
    expect(config.features).toContain('AI agents');
    expect(config.features).toContain('Messaging (500/mo)');
    expect(config.priceMonthly).toBe(29);
  });

  test('Primerica users get FREE with all features', () => {
    const sub = subscriptionService.getSubscription('prim-user', true);
    expect(sub.tier).toBe(SubscriptionTier.FREE);
    expect(sub.isPrimericaOrgLinked).toBe(true);
    expect(sub.features).toContain('AI agents');
    expect(sub.features).toContain('API access');
  });

  test('External users need paid for advanced features', () => {
    const sub = subscriptionService.getSubscription('external-user', false);
    expect(sub.tier).toBe(SubscriptionTier.FREE);
    expect(sub.isPrimericaOrgLinked).toBe(false);
    expect(sub.features).not.toContain('AI agents');
  });

  test('Cancel changes status', () => {
    const canceled = subscriptionService.cancelSubscription('user-1', false);
    expect(canceled.status).toBe(SubscriptionStatus.CANCELED);
  });

  test('Invalid tier returns error', () => {
    expect(() => subscriptionService.getPlanConfig('INVALID' as SubscriptionTier)).toThrow();
  });

  test('Change plan upgrades features', () => {
    const upgraded = subscriptionService.changePlan('user-2', SubscriptionTier.PRO, false);
    expect(upgraded.tier).toBe(SubscriptionTier.PRO);
    expect(upgraded.features).toContain('Unlimited contacts');
  });
});
