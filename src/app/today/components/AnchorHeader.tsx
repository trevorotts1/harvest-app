// uiux §5.2 zone 1 — Anchor header: greeting, momentum score + 7-day sparkline (tap = receipts),
// the Grove hero (§3), Approval Inbox badge. Renders this zone's OWN error state when its data
// source failed, independent of the other five zones (uiux AC-5.2-6).

import { useState } from 'react';

import Grove from './Grove';
import styles from '../today.module.css';
import { MOMENTUM_CRITERION_LABEL } from '@/services/gamification/momentum-criteria';
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

  const { greetingName, momentum, groveState, groveCaption, approvalInboxCount, momentumCriteria } = result.data;
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
              {/* T-43 (WP07 §12.1): the ten-criteria per-Law breakdown + the five-level Downline-Maxxer
                  name. The raw score itself is deliberately shown ONLY to the rep who owns it (this is
                  the rep's own Today, never a cross-rep surface) — see the anti-surveillance doctrine
                  note in the file header of momentum-criteria.ts / this package's QC notes: no
                  leaderboard/ranking view exists anywhere in this build. */}
              <p className={styles.receiptsTitle}>{momentumCriteria?.levelName ?? bandLabel}</p>
              <ul className={styles.receiptsList}>
                <li>Grow: {momentum.laws.grow}</li>
                <li>Engage: {momentum.laws.engage}</li>
                <li>Wealth: {momentum.laws.wealth}</li>
              </ul>
              {momentumCriteria && (
                <>
                  <p className={styles.receiptsTitle}>The ten criteria feeding your Grove</p>
                  <ul className={styles.receiptsList}>
                    {(Object.keys(momentumCriteria.criteria) as (keyof typeof MOMENTUM_CRITERION_LABEL)[]).map((key) => (
                      <li key={key}>
                        {MOMENTUM_CRITERION_LABEL[key]}: {momentumCriteria.criteria[key]}/10
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <a href="/today/momentum" className={styles.momentumButton}>
                See the one action that helps most
              </a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
