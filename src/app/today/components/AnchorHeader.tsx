// uiux §5.2 zone 1 — Anchor header: greeting, momentum score + 7-day sparkline (tap = receipts),
// the Grove hero (§3), Approval Inbox badge. Renders this zone's OWN error state when its data
// source failed, independent of the other five zones (uiux AC-5.2-6).

import { useState } from 'react';

import Grove from './Grove';
import styles from '../today.module.css';
import type { HeaderZoneData, ZoneResult } from '@/services/mission-control/types';

const BAND_LABEL: Record<string, string> = {
  thriving: 'Thriving',
  growing: 'Growing',
  quiet: 'At risk',
  resting: 'Resting',
};

export interface AnchorHeaderProps {
  result: ZoneResult<HeaderZoneData>;
}

export default function AnchorHeader({ result }: AnchorHeaderProps) {
  const [receiptsOpen, setReceiptsOpen] = useState(false);

  if (result.status === 'error') {
    return (
      <section className={styles.zoneCard} data-zone="header">
        <p className={styles.zoneErrorText}>{result.message}</p>
      </section>
    );
  }

  const { greetingName, momentum, groveState, groveCaption, approvalInboxCount } = result.data;
  const bandLabel = BAND_LABEL[momentum.band] ?? momentum.band;

  return (
    <section className={styles.headerZone} data-zone="header">
      <div className={styles.headerTop}>
        <h1 className={styles.greeting}>Good morning, {greetingName}</h1>
        <button type="button" className={styles.approvalBadge} aria-label={`Approval inbox, ${approvalInboxCount} waiting`}>
          Approval Inbox
          <span className={styles.approvalBadgeCount}>{approvalInboxCount}</span>
        </button>
      </div>

      <div className={styles.headerBody}>
        <Grove state={groveState} laws={momentum.laws} caption={groveCaption} size="hero" />

        <div className={styles.momentumBlock}>
          <button
            type="button"
            className={styles.momentumButton}
            onClick={() => setReceiptsOpen((v) => !v)}
            aria-expanded={receiptsOpen}
          >
            <span className={styles.momentumScore}>{momentum.score}</span>
            <span className={styles.momentumBand}>{bandLabel}</span>
          </button>

          <div className={styles.sparkline} role="img" aria-label={`7 day momentum trend: ${momentum.sparkline.join(', ')}`}>
            {momentum.sparkline.map((v, i) => (
              <span key={i} className={styles.sparklineBar} style={{ height: `${Math.max(6, v)}%` }} />
            ))}
          </div>

          {receiptsOpen && (
            <div className={styles.receiptsPanel}>
              <p className={styles.receiptsTitle}>Per-Law breakdown (receipts)</p>
              <ul className={styles.receiptsList}>
                <li>Grow: {momentum.laws.grow}</li>
                <li>Engage: {momentum.laws.engage}</li>
                <li>Wealth: {momentum.laws.wealth}</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
