// WP10: Payment & Subscription Service

import { SubscriptionTier, SubscriptionStatus, Subscription, PlanConfig } from '../../types/payment';

export const PLAN_CONFIGS: Record<SubscriptionTier, PlanConfig> = {
  [SubscriptionTier.FREE]: {
    tier: SubscriptionTier.FREE,
    priceMonthly: 0,
    priceYearly: 0,
    features: ['Basic onboarding', 'Contact import (50 max)', 'Basic pipeline view'],
  },
  [SubscriptionTier.ESSENTIAL]: {
    tier: SubscriptionTier.ESSENTIAL,
    priceMonthly: 29,
    priceYearly: 290,
    features: ['All FREE features', 'AI agents', 'Messaging (500/mo)', '500 contacts'],
  },
  [SubscriptionTier.PRO]: {
    tier: SubscriptionTier.PRO,
    priceMonthly: 79,
    priceYearly: 790,
    features: ['All ESSENTIAL features', 'Unlimited contacts', 'Unlimited messaging', 'Pipeline analytics', 'Priority support'],
  },
  [SubscriptionTier.ELITE]: {
    tier: SubscriptionTier.ELITE,
    priceMonthly: 199,
    priceYearly: 1990,
    features: ['All PRO features', 'API access', 'Custom cadence', 'Team features', 'White-glove onboarding'],
  },
};

const ALL_FEATURES = ['Basic onboarding', 'Contact import (50 max)', 'Basic pipeline view', 'AI agents', 'Messaging (500/mo)', '500 contacts', 'Unlimited contacts', 'Unlimited messaging', 'Pipeline analytics', 'Priority support', 'API access', 'Custom cadence', 'Team features', 'White-glove onboarding'];

const subscriptionStore: Record<string, Subscription> = {};

export const subscriptionService = {
  getSubscription(userId: string, isPrimerica: boolean = false): Subscription {
    if (!subscriptionStore[userId]) {
      // Default: FREE tier
      subscriptionStore[userId] = {
        userId,
        tier: SubscriptionTier.FREE,
        status: SubscriptionStatus.ACTIVE,
        isPrimericaOrgLinked: isPrimerica,
        currentPeriodStart: new Date().toISOString().split('T')[0],
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        features: isPrimerica ? [...ALL_FEATURES] : [...PLAN_CONFIGS[SubscriptionTier.FREE].features],
      };
    }
    return { ...subscriptionStore[userId] };
  },

  changePlan(userId: string, newTier: SubscriptionTier, isPrimerica: boolean = false): Subscription {
    const tiers = Object.values(SubscriptionTier);
    if (!tiers.includes(newTier)) {
      throw new Error(`Invalid tier: ${newTier}`);
    }
    const sub: Subscription = {
      userId,
      tier: newTier,
      status: SubscriptionStatus.ACTIVE,
      isPrimericaOrgLinked: isPrimerica,
      currentPeriodStart: new Date().toISOString().split('T')[0],
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      features: isPrimerica ? [...ALL_FEATURES] : [...PLAN_CONFIGS[newTier].features],
    };
    subscriptionStore[userId] = sub;
    return { ...sub };
  },

  cancelSubscription(userId: string, isPrimerica: boolean = false): Subscription {
    const current = this.getSubscription(userId, isPrimerica);
    current.status = SubscriptionStatus.CANCELED;
    subscriptionStore[userId] = current;
    return { ...current };
  },

  reactivateSubscription(userId: string, isPrimerica: boolean = false): Subscription {
    const current = this.getSubscription(userId, isPrimerica);
    current.status = SubscriptionStatus.ACTIVE;
    subscriptionStore[userId] = current;
    return { ...current };
  },

  getPlanConfig(tier: SubscriptionTier): PlanConfig {
    const config = PLAN_CONFIGS[tier];
    if (!config) throw new Error(`Invalid tier: ${tier}`);
    return { ...config };
  },

  resetStore() {
    Object.keys(subscriptionStore).forEach(key => delete subscriptionStore[key]);
  },
};
