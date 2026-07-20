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

/** §10.2 sequence types — the closed doctrine-safe set (mirrors sequence-cadence.ts's SequenceType). */
const SEQUENCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'FAST_TRACK', label: 'Fast Track (5 days, 3 touches)' },
  { value: 'STANDARD', label: 'Standard (14 days, 4 touches)' },
  { value: 'NURTURE', label: 'Nurture (30 days, gentle)' },
  { value: 'RE_ENGAGEMENT', label: 'Re-engagement (light, custom)' },
];

export interface SequenceEnrollPanelProps {
  contactId: string;
}

export default function SequenceEnrollPanel({ contactId }: SequenceEnrollPanelProps) {
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
        setStatus('Could not start this sequence. Try again.');
        return;
      }
      setStatus('Sequence started — each touch is prepared for your approval before it can send.');
    } catch {
      setStatus('Could not start this sequence. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.repActionPanel} aria-label="Start an outreach sequence">
      <h2 className={styles.repActionTitle}>Start a sequence</h2>
      <p className={styles.repActionNote}>
        A doctrine-safe cadence — warm open, honest social proof, a soft ask. Every touch waits for your
        approval and clears compliance before it can send.
      </p>
      <div className={styles.repActionRow}>
        <label className={styles.repActionLabel} htmlFor={`seq-type-${contactId}`}>
          Cadence
        </label>
        <select
          id={`seq-type-${contactId}`}
          className={styles.repActionSelect}
          value={sequenceType}
          onChange={(e) => setSequenceType(e.target.value)}
          disabled={busy}
        >
          {SEQUENCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" className={styles.repActionButton} onClick={start} disabled={busy}>
          {busy ? 'Starting…' : 'Start sequence'}
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
