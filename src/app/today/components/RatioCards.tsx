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

function RatioCard({
  titleKey,
  ratio,
  t,
}: {
  titleKey: string;
  ratio: RatioTriple;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
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
      {/* T-57 R3c-1 (MAJOR-D4, uiux AC-4-10) — a real receipts expander: the plain-language
          `explainer` above STAYS always-visible (unchanged — a mandatory TEETH test in
          mission-control-ui.test.ts asserts it renders unconditionally); this ADDS the real,
          already-computed breakdown (`a`/`b`/`c` against their own `labels`, plus the real
          `dataPoints` count — both already on `RatioTriple`, never previously rendered anywhere)
          behind a chevron, mirroring the AnchorHeader/BriefingCard receipts pattern. Native
          `<details>/<summary>` — no new `useState` needed. */}
      <details className={styles.receiptsDetails}>
        <summary className={styles.zoneBadge}>
          {t('receipts.ratioCards.toggleCta')}
          <span aria-hidden="true" className={styles.receiptChevron}>
            ›
          </span>
        </summary>
        <div className={styles.receiptsPanel}>
          <ul className={styles.receiptsList}>
            {ratio.labels.map((label, i) => (
              <li key={label}>
                {label}: {[ratio.a, ratio.b, ratio.c][i]}
              </li>
            ))}
          </ul>
          <p className={styles.receiptsTitle}>
            {ratio.learning
              ? t('receipts.ratioCards.dataPointsLearning', { count: ratio.dataPoints })
              : t('receipts.ratioCards.dataPointsReal', { count: ratio.dataPoints })}
          </p>
        </div>
      </details>
    </div>
  );
}

export default function RatioCards({ result }: RatioCardsProps) {
  const t = useT();

  if (result.status === 'error') {
    return (
      <section className={styles.zoneCard} data-zone="ratios">
        <span className={styles.zoneBadge}>{t('today.ratioCards.heading')}</span>
        <p className={styles.zoneErrorText} role="status">{result.message}</p>
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
