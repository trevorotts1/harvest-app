// T-43 (WP07 §12.2, §12.3) — Today additions: the First-48 countdown banner (§12.2), the milestone
// pin strip (§12.3 "queued extras render as pinned milestone cards"), and links into the Learn/Grow
// surfaces this package ships (reachability — every WP07 surface is reachable from Today, the
// default landing surface, always).

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import styles from '../today.module.css';
import type { MilestonesZoneData, ZoneResult } from '@/services/mission-control/types';
import { useT } from '@/app/locale-context';

interface FirstFortyEightGoal {
  contactId: string;
  displayName: string;
  contacted: boolean;
}

interface FirstFortyEightState {
  active: boolean;
  phase: 'ON_TIME' | 'WARNING' | 'EXPIRED' | null;
  hoursElapsed: number | null;
  goals: FirstFortyEightGoal[];
}

// T-R32b — routed through catalog keys instead of a hardcoded EN map (same fix as AnchorHeader's
// momentum-band label): a plain object lookup, never a JSX text literal, so the no-literals
// scanner cannot see it, but it was still unconditionally English regardless of locale.
// ON_TIME reuses onboarding.first48Handoff.lede — the identical sentence already lives there.
const PHASE_COPY_KEY: Record<string, string> = {
  ON_TIME: 'onboarding.first48Handoff.lede',
  WARNING: 'today.wp07Panel.phase.warning',
  EXPIRED: 'today.wp07Panel.phase.expired',
};

export default function WP07Panel({ milestones }: { milestones: ZoneResult<MilestonesZoneData> }) {
  const t = useT();
  const [first48, setFirst48] = useState<FirstFortyEightState | null>(null);

  useEffect(() => {
    fetch('/api/gamification/first-48')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: FirstFortyEightState) => setFirst48(data))
      .catch(() => {});
  }, []);

  return (
    <>
      {first48?.active && (
        <section className={styles.zoneCard} data-zone="first-48">
          <span className="badge">{t('today.wp07Panel.first48Badge')}</span>
          <p style={{ marginTop: 8 }}>{t(PHASE_COPY_KEY[first48.phase ?? 'ON_TIME'])}</p>
          <div className="grid-3" style={{ marginTop: 12 }}>
            {first48.goals.length === 0 && <p style={{ color: 'var(--muted)' }}>{t('today.wp07Panel.first48Empty')}</p>}
            {first48.goals.map((goal) => (
              <div key={goal.contactId} className="card feature">
                <strong>{goal.displayName}</strong>
                <p>{goal.contacted ? t('today.wp07Panel.contactedYes') : t('today.wp07Panel.contactedNo')}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {milestones.status === 'ok' && milestones.data.items.length > 0 && (
        <section className={styles.zoneCard} data-zone="milestones">
          <span className="badge">{t('today.wp07Panel.milestonesHeading')}</span>
          <div className="stack" style={{ marginTop: 12 }}>
            {milestones.data.items.map((item) => (
              <div key={item.key} className="action-row">
                <span className="priority">✓</span>
                <div>{item.label}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className={styles.zoneCard} data-zone="wp07-nav">
        <div className="grid-3">
          <Link href="/learn" className="card feature">
            <span className="badge">{t('today.wp07Panel.learnBadge')}</span>
            <h3 style={{ marginTop: 8 }}>{t('today.wp07Panel.learnBody')}</h3>
          </Link>
          <Link href="/grow/goal-card" className="card feature">
            <span className="badge">{t('today.wp07Panel.growBadge')}</span>
            <h3 style={{ marginTop: 8 }}>{t('today.wp07Panel.growBody')}</h3>
          </Link>
          <Link href="/today/momentum" className="card feature">
            <span className="badge">{t('today.wp07Panel.momentumBadge')}</span>
            <h3 style={{ marginTop: 8 }}>{t('today.wp07Panel.momentumBody')}</h3>
          </Link>
        </div>
      </section>
    </>
  );
}
