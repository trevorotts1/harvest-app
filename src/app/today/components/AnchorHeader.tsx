// uiux §5.2 zone 1 — Anchor header: greeting, momentum score + 7-day sparkline (tap = receipts),
// the Grove hero (§3), Approval Inbox badge. Renders this zone's OWN error state when its data
// source failed, independent of the other five zones (uiux AC-5.2-6).

import { useState } from 'react';

import Grove from './Grove';
import styles from '../today.module.css';
import type { HeaderZoneData, ZoneResult } from '@/services/mission-control/types';

// T-32 QC fix (non-blocking item): 'quiet' previously read "At risk" here — an alarming label for
// the SAME momentum band whose Grove caption (momentum.ts) is the deliberately gentle "Your field
// is quiet — one small action wakes it up" (uiux §3.2 non-shaming states). "Quiet" reconciles the
// two so the same state isn't narrated as calm in one place and alarming in the other.
const BAND_LABEL: Record<string, string> = {
  thriving: 'Thriving',
  growing: 'Growing',
  quiet: 'Quiet',
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
        {/* T-32 QC fix (non-blocking item): was a bare `<button>` with no onClick — a no-op that
            looked actionable. This is a plain navigation link to the Approval Inbox (T-33's route;
            no T-33 code imported here). */}
        <a href="/inbox" className={styles.approvalBadge} aria-label={`Approval inbox, ${approvalInboxCount} waiting`}>
          Approval Inbox
          <span className={styles.approvalBadgeCount}>{approvalInboxCount}</span>
        </a>
        {/* WP10 (T-47) — Me → Subscription entry (uiux §5.8). Plain nav link to the billing surface,
            matching the ad-hoc link pattern this header already uses for the Approval Inbox. */}
        <a href="/me/subscription" className={styles.approvalBadge} aria-label="Subscription and billing">
          Subscription
        </a>
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
