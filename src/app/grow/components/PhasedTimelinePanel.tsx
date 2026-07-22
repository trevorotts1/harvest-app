// WP08 §13.3/§13.6-3 — the phased timeline panel: activity-gated (never calendar-gated) checklists,
// with the Days 8-30 licensing-phase hard block surfaced explicitly (§5.5 "hard-blocked at the CFE
// regardless of score").

'use client';

import { useState } from 'react';
import Link from 'next/link';

import type { PhasedTimelineResult } from '@/types/taprooting';
import styles from '../grow.module.css';
import { useT } from '@/app/locale-context';
import { licensingStateLabel } from '@/lib/i18n/licensing-display';

// T-57 RG9 (i18n; master-spec §17.5, uiux §6.2) — `phase.label`/`item.label` arrive as hardcoded
// English from `phase-timeline.ts` (e.g. "Days 1-7: Launch", "IBA filed / POL registered"), so a
// Spanish rep on /grow saw them untranslated. Map the stable `phase.key`/`item.key` to per-value
// catalog keys here (the service's English `label` stays only an internal identifier/fallback), with
// a generic localized fallback so a future key never renders a raw token — same mapper pattern as
// team-token-display.ts.
const PHASE_LABEL_KEY: Record<string, string> = {
  launch: 'grow.phasedTimeline.phase.launch',
  licensing: 'grow.phasedTimeline.phase.licensing',
};
const ITEM_LABEL_KEY: Record<string, string> = {
  iba_filed: 'grow.phasedTimeline.item.ibaFiled',
  phone_list_uploaded: 'grow.phasedTimeline.item.phoneListUploaded',
  harvest_method_completed: 'grow.phasedTimeline.item.harvestMethodCompleted',
  first_intro_sent: 'grow.phasedTimeline.item.firstIntroSent',
  ten_identified: 'grow.phasedTimeline.item.tenIdentified',
  opportunity_invites_sent: 'grow.phasedTimeline.item.opportunityInvitesSent',
  intensity_selected: 'grow.phasedTimeline.item.intensitySelected',
  countdown_running: 'grow.phasedTimeline.item.countdownRunning',
  pfsu_enrolled: 'grow.phasedTimeline.item.pfsuEnrolled',
  prelicensing_completion_nudged: 'grow.phasedTimeline.item.prelicensingCompletion',
  exam_scheduled: 'grow.phasedTimeline.item.examScheduled',
  objection_tree_reviewed: 'grow.phasedTimeline.item.objectionTreeReviewed',
  team_calendar_live: 'grow.phasedTimeline.item.teamCalendarLive',
  licensed: 'grow.phasedTimeline.item.licensed',
};

export interface PhasedTimelinePanelProps {
  timeline: PhasedTimelineResult;
  onMarkAttested: (phase: 'launch' | 'licensing', itemKey: string) => Promise<boolean>;
  onPreviewInsuranceBlock: () => Promise<{ released: boolean; hardBlockActive: boolean; licensingState: string }>;
}

export default function PhasedTimelinePanel({ timeline, onMarkAttested, onPreviewInsuranceBlock }: PhasedTimelinePanelProps) {
  const t = useT();
  const [previewResult, setPreviewResult] = useState<{ released: boolean; hardBlockActive: boolean; licensingState: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (timeline.phases.length === 0) {
    return null; // Universal branch — the phased Primerica timeline is fully invisible (§17.1).
  }

  const handleMark = async (phase: 'launch' | 'licensing', itemKey: string) => {
    setBusyKey(itemKey);
    try {
      await onMarkAttested(phase, itemKey);
    } finally {
      setBusyKey(null);
    }
  };

  // T-57 R3c-1 (BLOCKER-E1, uiux §5.4 "Entry: ... from the phased timeline (Primerica days 1–7)").
  // Scoped to the `launch` phase specifically (the spec's own "days 1-7" framing) and only while it
  // isn't already complete — once the rep has finished days 1-7 this entry point has served its
  // purpose (the ritual itself stays reachable from Grow's own unconditional entry point).
  const launchPhase = timeline.phases.find((p) => p.key === 'launch');
  const showRitualEntry = !!launchPhase && !launchPhase.complete;

  return (
    <section className={styles.card} aria-label={t('grow.phasedTimeline.ariaLabel')}>
      <span className={styles.badge}>{t('grow.phasedTimeline.badge')}</span>
      {showRitualEntry && (
        <p>
          {t('grow.phasedTimeline.warmMarketRitualBody')}{' '}
          <Link href="/ritual/warm-market" className={styles.iconButton}>
            {t('grow.phasedTimeline.warmMarketRitualCta')}
          </Link>
        </p>
      )}
      {timeline.phases.map((phase) => (
        <div key={phase.key}>
          <div className={styles.phaseHeader}>
            <h3>{t(PHASE_LABEL_KEY[phase.key] ?? 'grow.phasedTimeline.phaseGeneric')}</h3>
            <span className={styles.badge}>
              {t(
                phase.complete
                  ? 'grow.phasedTimeline.phaseStatus.complete'
                  : phase.unlocked
                    ? 'grow.phasedTimeline.phaseStatus.inProgress'
                    : 'grow.phasedTimeline.phaseStatus.locked'
              )}
            </span>
          </div>
          {!phase.unlocked && <p className={styles.lockedNote}>{t('grow.phasedTimeline.lockedNote')}</p>}
          <ul className={styles.checklist}>
            {phase.items.map((item) => (
              <li key={item.key} className={styles.checklistItem}>
                <span aria-hidden="true">{item.done ? '✓' : '○'}</span>
                <span className={item.done ? styles.checklistDone : undefined}>
                  {t(ITEM_LABEL_KEY[item.key] ?? 'grow.phasedTimeline.itemGeneric')}
                </span>
                {!item.done && item.detectionMode === 'attested' && phase.unlocked && (
                  <button
                    type="button"
                    className={styles.iconButton}
                    disabled={busyKey === item.key}
                    onClick={() => handleMark(phase.key, item.key)}
                  >
                    {t('grow.phasedTimeline.markDoneCta')}
                  </button>
                )}
                {item.detectionMode === 'auto' && !item.done && <span className={styles.lockedNote}>{t('grow.phasedTimeline.detectedAutoNote')}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {timeline.insuranceHardBlockActive && (
        <div className={styles.blockedBanner} role="alert">
          {/* T-57 RG7 (i18n) — was raw `{ state: timeline.licensingState }`: the raw `LicensingState`
              enum token (UNLICENSED/…) interpolated into an otherwise-translated compliance message.
              `licensingStateLabel` localizes the token before interpolation. */}
          {t('grow.phasedTimeline.hardBlockTemplate', { state: licensingStateLabel(t, timeline.licensingState) })}
        </div>
      )}

      <div className={styles.formRow}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={async () => setPreviewResult(await onPreviewInsuranceBlock())}
        >
          {t('grow.phasedTimeline.previewCta')}
        </button>
        {previewResult && (
          <p role="status">
            {previewResult.released
              ? t('grow.phasedTimeline.releasedStatus')
              : t('grow.phasedTimeline.blockedStatusTemplate', { state: licensingStateLabel(t, previewResult.licensingState) })}
          </p>
        )}
      </div>
    </section>
  );
}
