// WP10: Payment & Subscription - Types

export enum SubscriptionTier {
  FREE = 'FREE',
  ESSENTIAL = 'ESSENTIAL',
  PRO = 'PRO',
  ELITE = 'ELITE',
}

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
  TRIALING = 'TRIALING',
}

export interface PlanConfig {
  tier: SubscriptionTier;
  priceMonthly: number;
  priceYearly: number;
  features: string[];
}

export interface Subscription {
  userId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  isPrimericaOrgLinked: boolean;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  features: string[];
}
