// WP08 §13.3/§13.6-3 — the phased timeline panel: activity-gated (never calendar-gated) checklists,
// with the Days 8-30 licensing-phase hard block surfaced explicitly (§5.5 "hard-blocked at the CFE
// regardless of score").

'use client';

import { useState } from 'react';

import type { PhasedTimelineResult } from '@/types/taprooting';
import styles from '../grow.module.css';
import { useT } from '@/app/locale-context';

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

  return (
    <section className={styles.card} aria-label={t('grow.phasedTimeline.ariaLabel')}>
      <span className={styles.badge}>{t('grow.phasedTimeline.badge')}</span>
      {timeline.phases.map((phase) => (
        <div key={phase.key}>
          <div className={styles.phaseHeader}>
            <h3>{phase.label}</h3>
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
                <span className={item.done ? styles.checklistDone : undefined}>{item.label}</span>
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
          {t('grow.phasedTimeline.hardBlockTemplate', { state: timeline.licensingState })}
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
              : t('grow.phasedTimeline.blockedStatusTemplate', { state: previewResult.licensingState })}
          </p>
        )}
      </div>
    </section>
  );
}
