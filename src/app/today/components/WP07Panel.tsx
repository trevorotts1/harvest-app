// T-43 (WP07 §12.2, §12.3) — Today additions: the First-48 countdown banner (§12.2), the milestone
// pin strip (§12.3 "queued extras render as pinned milestone cards"), and links into the Learn/Grow
// surfaces this package ships (reachability — every WP07 surface is reachable from Today, the
// default landing surface, always).

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import styles from '../today.module.css';
import type { MilestonesZoneData, ZoneResult } from '@/services/mission-control/types';
import { useT } from '@/app/locale-context';
import ComposerHandoffSheet from '@/app/community/components/ComposerHandoffSheet';
import { resolveFirstTouchDraftId } from '@/app/community/components/resolve-first-touch-draft';

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
  // T-57 R3a (M8) — First-48 "contact now" one-tap opens the Composer Handoff Sheet for the
  // pre-cleared first-touch draft to that A-list name (§12.2). Resolves the draftId the composer
  // route needs from the contactId the goal carries; the sheet re-asserts CFE clearance fail-closed.
  const [composer, setComposer] = useState<{ draftId: string; contactName: string } | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [noDraftFor, setNoDraftFor] = useState<string | null>(null);

  const loadFirst48 = useCallback(() => {
    fetch('/api/gamification/first-48')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: FirstFortyEightState) => setFirst48(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadFirst48();
  }, [loadFirst48]);

  async function handleContactNow(goal: FirstFortyEightGoal) {
    setNoDraftFor(null);
    setResolvingId(goal.contactId);
    const draftId = await resolveFirstTouchDraftId(goal.contactId);
    setResolvingId(null);
    if (draftId) setComposer({ draftId, contactName: goal.displayName });
    else setNoDraftFor(goal.contactId);
  }

  return (
    <>
      {first48?.active && (
        <section className={styles.zoneCard} data-zone="first-48">
          <span className="badge">{t('today.wp07Panel.first48Badge')}</span>
          <p style={{ marginTop: 8 }}>{t(PHASE_COPY_KEY[first48.phase ?? 'ON_TIME'])}</p>
          <div className="grid-3" style={{ marginTop: 12 }}>
            {/* T-R46 WCAG AA fix (T-59 QC auth-gated probe): was `var(--muted)` — the legacy
                globals.css scaffold alias, pinned to a THEME-INVARIANT ramp value (--soil-550,
                5.1:1 on a light canvas) that never flips for dark theme (see that file's own
                header comment). This zone's own `.zoneCard` background DOES flip to a dark
                surface, so the fixed muted gray measured only 2.51:1 there in dark theme.
                `--text-secondary` is the theme-aware equivalent (resolves to the same --soil-550
                in light, --muted-inverse in dark) and meets AA against both. */}
            {first48.goals.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>{t('today.wp07Panel.first48Empty')}</p>}
            {first48.goals.map((goal) => (
              <div key={goal.contactId} className="card feature">
                <strong>{goal.displayName}</strong>
                <p>{goal.contacted ? t('today.wp07Panel.contactedYes') : t('today.wp07Panel.contactedNo')}</p>
                {!goal.contacted && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ marginTop: 8 }}
                    onClick={() => handleContactNow(goal)}
                    aria-label={t('first48.contactNowAria', { name: goal.displayName })}
                    disabled={resolvingId === goal.contactId}
                  >
                    {resolvingId === goal.contactId ? t('first48.resolving') : t('first48.contactNow')}
                  </button>
                )}
                {noDraftFor === goal.contactId && (
                  <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>{t('first48.noDraftReady')}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <ComposerHandoffSheet
        open={composer !== null}
        draftId={composer?.draftId ?? null}
        contactName={composer?.contactName ?? ''}
        onClose={() => setComposer(null)}
        onConfirmed={loadFirst48}
      />

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
