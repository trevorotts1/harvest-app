'use client';

// WP10 (T-47) — a single locked-tier card (uiux §5.8). Renders ONLY the price line from the locked
// tier table (no other price string is possible — the data comes from the server's listLockedTiers,
// which reads tiers.ts). Prices are text, never images (a11y — uiux §5.8).

'use client';

import { useT } from '@/app/locale-context';
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

// T-R32 (i18n) — catalog keys per tier body copy (was a hardcoded EN-only Record).
const TIER_BODY_KEY: Record<TierCardData['plan_tier'], string> = {
  free: 'billing.tier.body.free',
  individual: 'billing.tier.body.individual',
  enterprise: 'billing.tier.body.enterprise',
};

export default function TierCard({ tier, isCurrent, cta }: TierCardProps) {
  const t = useT();
  return (
    <div className={`${styles.tierCard} ${isCurrent ? styles.tierCardCurrent : ''}`}>
      {isCurrent && <span className={styles.currentBadge}>{t('billing.tier.currentPlanBadge')}</span>}
      <h3 className={styles.tierName}>{tier.display_name}</h3>
      <p className={styles.priceLine}>{tier.price_line}</p>
      <p className={styles.tierBody}>{t(TIER_BODY_KEY[tier.plan_tier])}</p>
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
