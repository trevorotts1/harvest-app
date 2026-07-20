// WP10 (T-47) — locked-tier + purge guard tests. The RETIRED FREE/ESSENTIAL/PRO/ELITE tiers and
// their void $29/$79/$199/$1990 pricing are gone; this suite proves EXACTLY the three locked tiers
// exist and NO void price/name survives (qc-checklist WP10 checkpoint 1; §0.4 rules 6/9).

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { AccessTier } from '@prisma/client';

import {
  ALL_PLAN_TIERS,
  LOCKED_TIERS,
  isSponsoredAccessTier,
  planCollectsPayment,
  planTierForAccessTier,
  priceCentsFor,
} from '@/services/payment/tiers';
import { ACCESS_TIER_PRICE_CENTS } from '@/services/onboarding/wp01/access-tier';

describe('WP10 locked tiers (§0.2 / §15.1)', () => {
  test('exactly three tiers exist — free / individual / enterprise, no fourth', () => {
    expect(ALL_PLAN_TIERS).toEqual(['free', 'individual', 'enterprise']);
    expect(Object.keys(LOCKED_TIERS).sort()).toEqual(['enterprise', 'free', 'individual']);
  });

  test('the locked price lines are exactly $0 / $297 / $25,000 — the only prices that render', () => {
    expect(LOCKED_TIERS.free.price_line).toBe('$0 to you');
    expect(LOCKED_TIERS.individual.price_line).toBe('$297 / month');
    expect(LOCKED_TIERS.enterprise.price_line).toBe('$25,000 / year');
  });

  test('locked cents: free=0, individual=$297/mo (29700), enterprise=$25,000/yr (2,500,000)', () => {
    expect(priceCentsFor('individual', 'monthly')).toBe(29_700);
    expect(priceCentsFor('individual', 'annual')).toBe(356_400); // 12 × $297, the real total
    expect(priceCentsFor('enterprise', 'annual')).toBe(2_500_000);
    expect(LOCKED_TIERS.free.pricing.monthly_cents).toBe(0);
  });

  test('NO void price appears anywhere in the tier table (no 49/199/29/79/1990/290/790)', () => {
    const voidCents = [4900, 19900, 2900, 7900, 199000, 29000, 79000];
    const allCents = Object.values(LOCKED_TIERS).flatMap((t) => [
      t.pricing.monthly_cents,
      t.pricing.annual_cents,
    ]);
    for (const v of voidCents) expect(allCents).not.toContain(v);
    const priceLines = Object.values(LOCKED_TIERS).map((t) => t.price_line).join(' ');
    expect(priceLines).not.toMatch(/\$49\b|\$199\b|\$29\b|\$79\b/);
  });

  test('§6.7 → §15.2 access-tier → plan-tier mapping', () => {
    expect(planTierForAccessTier(AccessTier.FREE_ORG_LINKED)).toBe('free');
    expect(planTierForAccessTier(AccessTier.FREE_PAID_EXTERNAL)).toBe('free');
    expect(planTierForAccessTier(AccessTier.PAID_INDIVIDUAL)).toBe('individual');
    expect(planTierForAccessTier(AccessTier.ENTERPRISE)).toBe('enterprise');
  });

  test('only org-linked is sponsored; free never collects payment (§15.1 / AC-5.8-2)', () => {
    expect(isSponsoredAccessTier(AccessTier.FREE_ORG_LINKED)).toBe(true);
    expect(isSponsoredAccessTier(AccessTier.FREE_PAID_EXTERNAL)).toBe(false);
    expect(planCollectsPayment('free')).toBe(false);
    expect(planCollectsPayment('individual')).toBe(true);
    expect(planCollectsPayment('enterprise')).toBe(true);
    expect(LOCKED_TIERS.free.collects_payment).toBe(false);
  });

  test('WP10 tiers agree with WP01 ACCESS_TIER_PRICE_CENTS — ONE pricing truth across the seam', () => {
    expect(ACCESS_TIER_PRICE_CENTS[AccessTier.PAID_INDIVIDUAL]).toBe(priceCentsFor('individual', 'monthly'));
    expect(ACCESS_TIER_PRICE_CENTS[AccessTier.ENTERPRISE]).toBe(priceCentsFor('enterprise', 'annual'));
    expect(ACCESS_TIER_PRICE_CENTS[AccessTier.FREE_ORG_LINKED]).toBe(0);
    expect(ACCESS_TIER_PRICE_CENTS[AccessTier.FREE_PAID_EXTERNAL]).toBe(0);
  });
});

describe('WP10 tier PURGE — no retired name/price survives in the payment source (checkpoint 1)', () => {
  const paymentDir = path.join(process.cwd(), 'src', 'services', 'payment');
  const typesFile = path.join(process.cwd(), 'src', 'types', 'payment.ts');
  const files = [
    path.join(paymentDir, 'tiers.ts'),
    path.join(paymentDir, 'subscription.service.ts'),
    typesFile,
  ];

  test('no retired tier ENUM MEMBER (ESSENTIAL/PRO/ELITE) or SubscriptionTier enum survives', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // Allow the words only inside the purge-documentation comment lines; assert no live enum decl.
      expect(src).not.toMatch(/enum\s+SubscriptionTier/);
      expect(src).not.toMatch(/SubscriptionTier\.(FREE|ESSENTIAL|PRO|ELITE)/);
      expect(src).not.toMatch(/\bESSENTIAL\s*[:=]/);
      expect(src).not.toMatch(/\bELITE\s*[:=]/);
    }
  });

  test('no void price literal (priceMonthly/priceYearly: 29/79/199/1990/290/790) survives', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/price(Monthly|Yearly)\s*:\s*(29|79|199|1990|290|790)\b/);
    }
  });
});
