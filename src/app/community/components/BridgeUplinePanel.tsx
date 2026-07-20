// T-40R (WP05 GATE remediation, master-spec §10.5/§10.6; uiux §5.7 "bridge my upline") — the rep's
// "bridge my upline into this conversation" affordance. Posts to the session-gated, org-gated POST
// /api/messaging/handoff/trigger, which resolves the rep's upline, generates the doctrine-safe
// edification script, and bridges the upline (INVITED). If the upline does not join within 24h, the
// hourly return sweep hands the thread back with a coached next step (§10.9-8). On success this shows
// the returned edification copy the rep can use (only when it cleared the doctrine-vocabulary floor).
//
// Presentational + a single fetch; tokens only via the CSS module (no raw hex, no opacity on text).

'use client';

import { useState } from 'react';

import styles from '../conversation.module.css';

const REASON_OPTIONS: { value: string; label: string }[] = [
  { value: 'BUYING_SIGNAL', label: 'They are showing real interest' },
  { value: 'HARD_QUESTION', label: 'A question I cannot answer well' },
  { value: 'MANUAL', label: 'I would just like the introduction' },
];

export interface BridgeUplinePanelProps {
  contactId: string;
}

export default function BridgeUplinePanel({ contactId }: BridgeUplinePanelProps) {
  const [reason, setReason] = useState<string>('BUYING_SIGNAL');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [smsBridge, setSmsBridge] = useState<string | null>(null);

  async function bridge() {
    setBusy(true);
    setStatus(null);
    setSmsBridge(null);
    try {
      const res = await fetch('/api/messaging/handoff/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contactId, reason }),
      });
      if (res.status === 409) {
        setStatus('You do not have an upline on file to bridge in.');
        return;
      }
      if (!res.ok) {
        setStatus('Could not bridge your upline. Try again.');
        return;
      }
      const body = await res.json();
      setStatus('Your upline has been invited into this conversation.');
      if (body.edification?.sms) setSmsBridge(body.edification.sms as string);
    } catch {
      setStatus('Could not bridge your upline. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.repActionPanel} aria-label="Bridge my upline">
      <h2 className={styles.repActionTitle}>Bridge my upline</h2>
      <p className={styles.repActionNote}>
        Warmly introduce your upline into this thread. If they cannot join within 24 hours, it returns
        to you with a coached next step.
      </p>
      <div className={styles.repActionRow}>
        <label className={styles.repActionLabel} htmlFor={`bridge-reason-${contactId}`}>
          Why
        </label>
        <select
          id={`bridge-reason-${contactId}`}
          className={styles.repActionSelect}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        >
          {REASON_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" className={styles.repActionButton} onClick={bridge} disabled={busy}>
          {busy ? 'Bridging…' : 'Bridge my upline'}
        </button>
      </div>
      {status && (
        <p className={styles.repActionStatus} role="status">
          {status}
        </p>
      )}
      {smsBridge && (
        <p className={styles.repActionBridgeCopy}>
          <span className={styles.repActionBridgeLabel}>Intro you can send</span> {smsBridge}
        </p>
      )}
    </section>
  );
}
