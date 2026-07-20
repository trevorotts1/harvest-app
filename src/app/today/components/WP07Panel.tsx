// T-43 (WP07 §12.2, §12.3) — Today additions: the First-48 countdown banner (§12.2), the milestone
// pin strip (§12.3 "queued extras render as pinned milestone cards"), and links into the Learn/Grow
// surfaces this package ships (reachability — every WP07 surface is reachable from Today, the
// default landing surface, always).

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import styles from '../today.module.css';
import type { MilestonesZoneData, ZoneResult } from '@/services/mission-control/types';

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

const PHASE_COPY: Record<string, string> = {
  ON_TIME: 'Three introductions in 48 hours — that\'s the whole first mission.',
  WARNING: 'You can still claim these — no rush, no shame.',
  EXPIRED: 'The clock stopped, but these three are still yours whenever you\'re ready.',
};

export default function WP07Panel({ milestones }: { milestones: ZoneResult<MilestonesZoneData> }) {
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
          <span className="badge">First 48</span>
          <p style={{ marginTop: 8 }}>{PHASE_COPY[first48.phase ?? 'ON_TIME']}</p>
          <div className="grid-3" style={{ marginTop: 12 }}>
            {first48.goals.length === 0 && <p style={{ color: 'var(--muted)' }}>Import a few contacts to see your first three here.</p>}
            {first48.goals.map((goal) => (
              <div key={goal.contactId} className="card feature">
                <strong>{goal.displayName}</strong>
                <p>{goal.contacted ? 'Contacted' : 'Not yet contacted'}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {milestones.status === 'ok' && milestones.data.items.length > 0 && (
        <section className={styles.zoneCard} data-zone="milestones">
          <span className="badge">Milestones</span>
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
            <span className="badge">Learn</span>
            <h3 style={{ marginTop: 8 }}>Course, referrals &amp; coaching</h3>
          </Link>
          <Link href="/grow/goal-card" className="card feature">
            <span className="badge">Grow</span>
            <h3 style={{ marginTop: 8 }}>Your Goal Commitment Card</h3>
          </Link>
          <Link href="/today/momentum" className="card feature">
            <span className="badge">Momentum</span>
            <h3 style={{ marginTop: 8 }}>The ten criteria, in full</h3>
          </Link>
        </div>
      </section>
    </>
  );
}
