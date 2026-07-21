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
import { useT } from '@/app/locale-context';

const REASON_OPTION_KEYS: { value: string; labelKey: string }[] = [
  { value: 'BUYING_SIGNAL', labelKey: 'community.bridgeUpline.reasonOptions.buyingSignal' },
  { value: 'HARD_QUESTION', labelKey: 'community.bridgeUpline.reasonOptions.hardQuestion' },
  { value: 'MANUAL', labelKey: 'community.bridgeUpline.reasonOptions.manual' },
];

export interface BridgeUplinePanelProps {
  contactId: string;
}

export default function BridgeUplinePanel({ contactId }: BridgeUplinePanelProps) {
  const t = useT();
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
        setStatus(t('community.bridgeUpline.noUplineStatus'));
        return;
      }
      if (!res.ok) {
        setStatus(t('community.bridgeUpline.failedGenericStatus'));
        return;
      }
      const body = await res.json();
      setStatus(t('community.bridgeUpline.successStatus'));
      if (body.edification?.sms) setSmsBridge(body.edification.sms as string);
    } catch {
      setStatus(t('community.bridgeUpline.failedGenericStatus'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.repActionPanel} aria-label={t('community.bridgeUpline.title')}>
      <h2 className={styles.repActionTitle}>{t('community.bridgeUpline.title')}</h2>
      <p className={styles.repActionNote}>
        {t('community.bridgeUpline.intro')}
      </p>
      <div className={styles.repActionRow}>
        <label className={styles.repActionLabel} htmlFor={`bridge-reason-${contactId}`}>
          {t('community.bridgeUpline.whyLabel')}
        </label>
        <select
          id={`bridge-reason-${contactId}`}
          className={styles.repActionSelect}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        >
          {REASON_OPTION_KEYS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
        <button type="button" className={styles.repActionButton} onClick={bridge} disabled={busy}>
          {busy ? t('community.bridgeUpline.bridgingCta') : t('community.bridgeUpline.title')}
        </button>
      </div>
      {status && (
        <p className={styles.repActionStatus} role="status">
          {status}
        </p>
      )}
      {smsBridge && (
        <p className={styles.repActionBridgeCopy}>
          <span className={styles.repActionBridgeLabel}>{t('community.bridgeUpline.introLabel')}</span> {smsBridge}
        </p>
      )}
    </section>
  );
}
