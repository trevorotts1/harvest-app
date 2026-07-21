// uiux §4.1 Ratio Card / §5.2 zone 5 — Agent's Ratio + Field Trainer's Ratio (master-spec §9.7).
// Learning state (mandatory until 20-50 real data points): the 20:5:1 baseline with a "learning your
// community" chip — never presented as the rep's own performance (AC-4-5: never NaN either).
//
// T-R16 (§9.9-7 "both ratios display WITH explainers"): each card ALSO renders a "what this means"
// explainer alongside the headline numerals — mirroring the Shift's own `RatioCard.tsx`, which
// already renders one; this was the one surface that showed the numbers without it. The explainer
// is display-only text carried on `RatioTriple.explainer` (`mission-control/zones/ratios.ts`) — it
// never contributes to the Readiness Score, which stays hidden by design (uiux AC-5.4-4).

import styles from '../today.module.css';
import type { RatiosZoneData, RatioTriple, ZoneResult } from '@/services/mission-control/types';
import { useT } from '@/app/locale-context';

export interface RatioCardsProps {
  result: ZoneResult<RatiosZoneData>;
}

function RatioCard({ titleKey, ratio, t }: { titleKey: string; ratio: RatioTriple; t: (key: string) => string }) {
  return (
    <div className={styles.ratioCard}>
      <div className={styles.zoneHeaderRow}>
        <strong>{t(titleKey)}</strong>
        {ratio.learning && <span className={styles.learningChip}>{t('today.ratioCards.learningCommunity')}</span>}
      </div>
      <p className={styles.ratioNumerals}>
        {ratio.a} : {ratio.b} : {ratio.c}
      </p>
      <p className={styles.ratioLabels}>{ratio.labels.join(' → ')}</p>
      <p className={styles.ratioExplainer}>{ratio.explainer}</p>
    </div>
  );
}

export default function RatioCards({ result }: RatioCardsProps) {
  const t = useT();

  if (result.status === 'error') {
    return (
      <section className={styles.zoneCard} data-zone="ratios">
        <span className={styles.zoneBadge}>{t('today.ratioCards.heading')}</span>
        <p className={styles.zoneErrorText}>{result.message}</p>
      </section>
    );
  }

  return (
    <section className={styles.zoneCard} data-zone="ratios">
      <span className={styles.zoneBadge}>{t('today.ratioCards.heading')}</span>
      <RatioCard titleKey="today.ratioCards.agentRatioTitle" ratio={result.data.agentRatio} t={t} />
      <RatioCard titleKey="today.ratioCards.fieldTrainerRatioTitle" ratio={result.data.fieldTrainerRatio} t={t} />
    </section>
  );
}
