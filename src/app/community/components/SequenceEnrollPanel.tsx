// T-40R (WP05 GATE remediation, master-spec §10.2; uiux §5.7) — the rep-facing "start a sequence"
// affordance on the contact conversation surface. Before T-40R a rep could never enroll a contact in a
// cadence (the enroll service had no reachable caller). This posts to the session-gated, ownership-
// checked POST /api/messaging/sequence; the sequence only SCHEDULES steps — the hourly cadence cron
// fires each later touch THROUGH the fully-gated send seam, so nothing here sends un-gated.
//
// Presentational + a single fetch; tokens only via the CSS module (no raw hex, no opacity on text).

'use client';

import { useState } from 'react';

import styles from '../conversation.module.css';
import { useT } from '@/app/locale-context';

/** §10.2 sequence types — the closed doctrine-safe set (mirrors sequence-cadence.ts's SequenceType). */
const SEQUENCE_OPTION_KEYS: { value: string; labelKey: string }[] = [
  { value: 'FAST_TRACK', labelKey: 'community.sequenceEnroll.sequenceOptions.fastTrack' },
  { value: 'STANDARD', labelKey: 'community.sequenceEnroll.sequenceOptions.standard' },
  { value: 'NURTURE', labelKey: 'community.sequenceEnroll.sequenceOptions.nurture' },
  { value: 'RE_ENGAGEMENT', labelKey: 'community.sequenceEnroll.sequenceOptions.reEngagement' },
];

export interface SequenceEnrollPanelProps {
  contactId: string;
}

export default function SequenceEnrollPanel({ contactId }: SequenceEnrollPanelProps) {
  const t = useT();
  const [sequenceType, setSequenceType] = useState<string>('STANDARD');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/messaging/sequence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contactId, sequenceType }),
      });
      if (!res.ok) {
        setStatus(t('community.sequenceEnroll.failedGenericStatus'));
        return;
      }
      setStatus(t('community.sequenceEnroll.successStatus'));
    } catch {
      setStatus(t('community.sequenceEnroll.failedGenericStatus'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.repActionPanel} aria-label={t('community.sequenceEnroll.ariaLabel')}>
      <h2 className={styles.repActionTitle}>{t('community.sequenceEnroll.title')}</h2>
      <p className={styles.repActionNote}>
        {t('community.sequenceEnroll.note')}
      </p>
      <div className={styles.repActionRow}>
        <label className={styles.repActionLabel} htmlFor={`seq-type-${contactId}`}>
          {t('community.sequenceEnroll.cadenceLabel')}
        </label>
        <select
          id={`seq-type-${contactId}`}
          className={styles.repActionSelect}
          value={sequenceType}
          onChange={(e) => setSequenceType(e.target.value)}
          disabled={busy}
        >
          {SEQUENCE_OPTION_KEYS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
        <button type="button" className={styles.repActionButton} onClick={start} disabled={busy}>
          {busy ? t('community.sequenceEnroll.startingCta') : t('community.sequenceEnroll.startCta')}
        </button>
      </div>
      {status && (
        <p className={styles.repActionStatus} role="status">
          {status}
        </p>
      )}
    </section>
  );
}
