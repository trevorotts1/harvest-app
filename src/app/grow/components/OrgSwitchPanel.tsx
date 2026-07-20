// WP08 §13.5/§18.7 — the org-type switch control. No "Me"/Settings page exists yet in this
// codebase for this to live on (grep confirms it — `src/app/me` does not exist), and the switch is
// a WP08-load-bearing, QC-provable capability (§13.6-5's critical failure condition), so it is
// surfaced here rather than left unreachable. Step-up MFA is required (§16.4/§18.10) — this panel
// completes the FULL, previously-unreachable MFA lifecycle inline (enroll -> verify -> step-up ->
// switch) using ONLY the existing WP11 `/api/auth/mfa/*` routes (never a second, parallel MFA
// implementation) since no page anywhere in this app consumed them before this unit.

'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';

import styles from '../grow.module.css';

export interface OrgSwitchPanelProps {
  currentOrgType: 'PRIMERICA' | 'EXTERNAL';
  onSwitched: () => void;
}

type Stage = 'idle' | 'need_enroll' | 'need_verify' | 'need_step_up' | 'busy' | 'error';

export default function OrgSwitchPanel({ currentOrgType, onSwitched }: OrgSwitchPanelProps) {
  const { update } = useSession();
  const [stage, setStage] = useState<Stage>('idle');
  const [code, setCode] = useState('');
  const [otpauthUri, setOtpauthUri] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const target = currentOrgType === 'PRIMERICA' ? 'EXTERNAL' : 'PRIMERICA';

  const attemptSwitch = async (): Promise<boolean> => {
    const res = await fetch('/api/settings/org-switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toOrgType: target }),
    });
    if (res.ok) {
      setMessage(`Switched to ${target === 'PRIMERICA' ? 'Primerica' : 'Independent'}. Gated state is wiped for this session; nothing was deleted.`);
      setStage('idle');
      onSwitched();
      return true;
    }
    const body = await res.json().catch(() => ({}));
    if (body.code === 'MFA_ENROLLMENT_REQUIRED') {
      setStage('need_enroll');
      return false;
    }
    if (body.code === 'STEP_UP_REQUIRED') {
      setStage('need_step_up');
      return false;
    }
    setMessage(body.error ?? 'Could not switch organization type.');
    setStage('error');
    return false;
  };

  const startEnroll = async () => {
    setStage('busy');
    const res = await fetch('/api/auth/mfa/enroll', { method: 'POST' });
    if (!res.ok) {
      setMessage('Could not start MFA enrollment.');
      setStage('error');
      return;
    }
    const body = await res.json();
    setOtpauthUri(body.otpauthUri ?? null);
    setStage('need_verify');
  };

  const submitVerify = async () => {
    setStage('busy');
    const res = await fetch('/api/auth/mfa/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: code }),
    });
    if (!res.ok) {
      setMessage('That code did not verify — check your authenticator app and try again.');
      setStage('need_verify');
      return;
    }
    setCode('');
    await attemptSwitch();
  };

  const submitStepUp = async () => {
    setStage('busy');
    const res = await fetch('/api/auth/mfa/step-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: code }),
    });
    if (!res.ok) {
      setMessage('That code did not verify — check your authenticator app and try again.');
      setStage('need_step_up');
      return;
    }
    const body = await res.json();
    setCode('');
    await update({ mfaVerifiedAt: body.mfaVerifiedAt });
    await attemptSwitch();
  };

  return (
    <section className={styles.card} aria-label="Organization type">
      <span className={styles.badge}>Organization type</span>
      <p>
        Current: <strong>{currentOrgType === 'PRIMERICA' ? 'Primerica' : 'Independent'}</strong>
      </p>
      {message && <p role="status">{message}</p>}

      {stage === 'idle' && (
        <div className={styles.formRow}>
          <button type="button" className={styles.iconButton} onClick={() => { setStage('busy'); attemptSwitch(); }}>
            Switch to {target === 'PRIMERICA' ? 'Primerica' : 'Independent'}
          </button>
        </div>
      )}

      {stage === 'need_enroll' && (
        <div className={styles.formRow}>
          <p>A security check is required before switching. Set up an authenticator first.</p>
          <button type="button" className={styles.iconButton} onClick={startEnroll}>
            Start security check-up
          </button>
        </div>
      )}

      {(stage === 'need_verify' || stage === 'need_step_up') && (
        <div className={styles.formRow}>
          {otpauthUri && stage === 'need_verify' && <p>Scan this in your authenticator app: {otpauthUri}</p>}
          <label htmlFor="taproot-mfa-code">6-digit code</label>
          <input id="taproot-mfa-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} />
          <button type="button" className={styles.iconButton} onClick={stage === 'need_verify' ? submitVerify : submitStepUp}>
            Confirm
          </button>
        </div>
      )}

      {stage === 'busy' && <p role="status">Working…</p>}
    </section>
  );
}
