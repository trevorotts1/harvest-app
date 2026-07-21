// uiux §5.2 zone 1 — Anchor header: greeting, momentum score + 7-day sparkline (tap = receipts),
// the Grove hero (§3), Approval Inbox badge. Renders this zone's OWN error state when its data
// source failed, independent of the other five zones (uiux AC-5.2-6).

import { useState } from 'react';

import Grove from './Grove';
import styles from '../today.module.css';
import { MOMENTUM_CRITERION_LABEL } from '@/services/gamification/momentum-criteria';
import type { HeaderZoneData, ZoneResult } from '@/services/mission-control/types';
import { useT } from '@/app/locale-context';

// T-32 QC fix (non-blocking item): 'quiet' previously read "At risk" here — an alarming label for
// the SAME momentum band whose Grove caption (momentum.ts) is the deliberately gentle "Your field
// is quiet — one small action wakes it up" (uiux §3.2 non-shaming states). "Quiet" reconciles the
// two so the same state isn't narrated as calm in one place and alarming in the other.
//
// T-R32b — routed through the catalog's existing (previously unused) `today.momentum.*` keys
// instead of a hardcoded EN map, so this label is real ES under a Spanish locale too.
const BAND_LABEL_KEY: Record<string, string> = {
  thriving: 'today.momentum.thriving',
  growing: 'today.momentum.growing',
  quiet: 'today.momentum.quiet',
  resting: 'today.momentum.resting',
};

export interface AnchorHeaderProps {
  result: ZoneResult<HeaderZoneData>;
}

export default function AnchorHeader({ result }: AnchorHeaderProps) {
  const t = useT();
  const [receiptsOpen, setReceiptsOpen] = useState(false);

  if (result.status === 'error') {
    return (
      <section className={styles.zoneCard} data-zone="header">
        <p className={styles.zoneErrorText}>{result.message}</p>
      </section>
    );
  }

  const { greetingName, momentum, groveState, groveCaption, groveBloomNarration, approvalInboxCount, momentumCriteria } = result.data;
  const bandLabelKey = BAND_LABEL_KEY[momentum.band];
  const bandLabel = bandLabelKey ? t(bandLabelKey) : momentum.band;

  return (
    <section className={styles.headerZone} data-zone="header">
      <div className={styles.headerTop}>
        <h1 className={styles.greeting}>{t('today.greeting', { name: greetingName })}</h1>
        {/* T-32 QC fix (non-blocking item): was a bare `<button>` with no onClick — a no-op that
            looked actionable. This is a plain navigation link to the Approval Inbox (T-33's route;
            no T-33 code imported here). */}
        <a href="/inbox" className={styles.approvalBadge} aria-label={`Approval inbox, ${approvalInboxCount} waiting`}>
          {t('nav.approvalInbox')}
          <span className={styles.approvalBadgeCount}>{approvalInboxCount}</span>
        </a>
        {/* WP08 (§13, uiux §5.5) — the reachability mandate: the Orchard/Grow surface must be
            linked from existing nav, not orphaned. Today's persistent header is the one element
            rendered on every visit to the app's primary landing page, so it is the anchor link. */}
        <a href="/grow" className={styles.approvalBadge} aria-label={t('nav.orchardAria')}>
          {t('nav.grow')}
        </a>
        {/* T-R28 (uiux AC-2-1's five-destination nav check) — Community had a real page
            (src/app/community/page.tsx) but no link anywhere in Today's component tree, unlike
            Grow (above) and Learn (WP07Panel.tsx). Same ad-hoc header-link pattern as the rest of
            this row. */}
        <a href="/community" className={styles.approvalBadge} aria-label={t('nav.communityAria')}>
          {t('nav.community')}
        </a>
        {/* WP10 (T-47) — Me → Subscription entry (uiux §5.8). Plain nav link to the billing surface,
            matching the ad-hoc link pattern this header already uses for the Approval Inbox. */}
        <a href="/me/subscription" className={styles.approvalBadge} aria-label={t('nav.subscriptionAria')}>
          {t('nav.subscription')}
        </a>
        {/* T-R29 (compliance-reachability build, master-spec §16.3/§9 GDPR/CCPA data rights) — Me →
            Data & Privacy entry. T-51 found the data-rights export/deletion center built but
            unreachable (no route, no UI); this is the reachability fix, same ad-hoc nav-link
            pattern as Subscription above (no "Me" index page exists yet for either to live on). */}
        <a href="/me/data-rights" className={styles.approvalBadge} aria-label={t('nav.dataPrivacyAria')}>
          {t('nav.dataPrivacy')}
        </a>
        {/* T-53 (master-spec §17.5 / uiux §6.2 i18n) — Me → Language entry. Same ad-hoc header-link
            pattern as Subscription/Data & Privacy above (no "Me" index page exists yet for any of
            the three to live on). */}
        <a href="/me/language" className={styles.approvalBadge} aria-label={t('nav.languageAria')}>
          {t('nav.language')}
        </a>
      </div>

      <div className={styles.headerBody}>
        <Grove state={groveState} laws={momentum.laws} caption={groveCaption} bloomNarration={groveBloomNarration} size="hero" />

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
                <li>{t('today.laws.grow')}: {momentum.laws.grow}</li>
                <li>{t('today.laws.engage')}: {momentum.laws.engage}</li>
                <li>{t('today.laws.wealth')}: {momentum.laws.wealth}</li>
              </ul>
              {momentumCriteria && (
                <>
                  <p className={styles.receiptsTitle}>{t('today.criteriaHeading')}</p>
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
                {t('today.receiptsCta')}
              </a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
