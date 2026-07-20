'use client';

// WP10 (T-47) — a single locked-tier card (uiux §5.8). Renders ONLY the price line from the locked
// tier table (no other price string is possible — the data comes from the server's listLockedTiers,
// which reads tiers.ts). Prices are text, never images (a11y — uiux §5.8).

import styles from '../subscription.module.css';

export interface TierCardData {
  plan_tier: 'free' | 'individual' | 'enterprise';
  display_name: string;
  price_line: string;
}

interface TierCardProps {
  tier: TierCardData;
  isCurrent: boolean;
  /** CTA label + handler; null for a pure state card (e.g. active sponsored). */
  cta: { label: string; onClick: () => void } | null;
}

const TIER_BODY: Record<TierCardData['plan_tier'], string> = {
  free: 'Everything included — your Downline Sponsor covers your first year.',
  individual: 'The full platform: every agent, every surface.',
  enterprise: 'Org-wide deployment, team management, org analytics, dedicated support.',
};

export default function TierCard({ tier, isCurrent, cta }: TierCardProps) {
  return (
    <div className={`${styles.tierCard} ${isCurrent ? styles.tierCardCurrent : ''}`}>
      {isCurrent && <span className={styles.currentBadge}>Your plan</span>}
      <h3 className={styles.tierName}>{tier.display_name}</h3>
      <p className={styles.priceLine}>{tier.price_line}</p>
      <p className={styles.tierBody}>{TIER_BODY[tier.plan_tier]}</p>
      {cta && (
        <div className={styles.btnRow}>
          <button type="button" className={styles.actionBtn} onClick={cta.onClick}>
            {cta.label}
          </button>
        </div>
      )}
    </div>
  );
}
