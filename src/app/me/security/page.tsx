'use client';

// T-57 R3b (E-M10 + §16.4 sign-out-everywhere) — Me -> Security.
//
// Two independent controls, each wired to a REAL, already-shipped backend contract:
//
// 1. MFA ENROLLMENT (E-M10, master-spec §16.4/§18.10). Before this build, the only place in the
//    app that ever called `/api/auth/mfa/enroll` -> `/api/auth/mfa/verify` was
//    `src/app/grow/components/OrgSwitchPanel.tsx` (WP08's org-switch side door) — reachable only by
//    a Primerica<->independent org switch. An upline/RVP who never switches orgs (MFA is REQUIRED
//    for upline/rvp/admin, §16.4) had NO way to enroll at all. This page reuses the exact same two
//    routes (never a second MFA implementation) with a plain, direct enroll -> verify flow (no
//    gated business action to retry afterward — enrollment IS the action here, unlike OrgSwitchPanel
//    / data-rights' `useStepUpAction` hook, which exists specifically to retry an underlying gated
//    request once MFA clears). Recovery codes — returned once by `/enroll`, never shown by
//    OrgSwitchPanel or data-rights' StepUpPrompt today — ARE displayed here with an explicit
//    "save these now" notice, since this enrollment path has no other route back to them.
//
// 2. SIGN OUT EVERYWHERE (§16.4 "a session-revocation control ('sign out everywhere') on the Me
//    surface"). `/api/auth/session/revoke-all` requires the CURRENT PASSWORD, not a step-up MFA
//    challenge (see that route's own header comment: step-up would be circular — a compromised
//    session's whole point is that its own MFA state can't be trusted as the gate for revoking
//    itself). This page's form matches that real contract exactly — a password field, not a TOTP
//    code — and, on success, also ends the CURRENT session client-side (`signOut`) so the rep is
//    not left looking at a page that claims "signed out everywhere" while still signed in here.

import { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';

import { useT } from '@/app/locale-context';
import styles from './security.module.css';

type MfaStage = 'loading' | 'off' | 'enrolling_verify' | 'on' | 'error';
type RevokeStage = 'idle' | 'busy' | 'done' | 'error';

interface EnrollResponse {
  otpauthUri: string;
  secret: string;
  recoveryCodes: string[];
}

export default function SecurityPage() {
  const t = useT();

  // ── MFA enrollment ──────────────────────────────────────────────────────
  const [mfaStage, setMfaStage] = useState<MfaStage>('loading');
  const [enrollment, setEnrollment] = useState<EnrollResponse | null>(null);
  const [code, setCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/mfa/status');
        if (res.ok) {
          const body = (await res.json()) as { enrolled: boolean };
          setMfaStage(body.enrolled ? 'on' : 'off');
        } else {
          setMfaStage('off');
        }
      } catch {
        setMfaStage('off');
      }
    })();
  }, []);

  async function startEnroll() {
    setMfaError(null);
    const res = await fetch('/api/auth/mfa/enroll', { method: 'POST' });
    if (!res.ok) {
      setMfaError(t('me.security.mfa.enrollFailed'));
      setMfaStage('error');
      return;
    }
    const body = (await res.json()) as EnrollResponse;
    setEnrollment(body);
    setMfaStage('enrolling_verify');
  }

  async function submitVerify() {
    setMfaError(null);
    const res = await fetch('/api/auth/mfa/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: code }),
    });
    if (!res.ok) {
      setMfaError(t('me.security.mfa.verifyFailed'));
      return; // stay on enrolling_verify — the rep can retry the code
    }
    setCode('');
    setMfaStage('on');
    // Recovery codes / otpauthUri intentionally kept on screen through this render (the success
    // banner below still reminds the rep to have saved them) — cleared on next navigation/mount.
  }

  // ── Sign out everywhere ─────────────────────────────────────────────────
  const [password, setPassword] = useState('');
  const [revokeStage, setRevokeStage] = useState<RevokeStage>('idle');
  const [revokeError, setRevokeError] = useState<string | null>(null);

  async function signOutEverywhere() {
    setRevokeStage('busy');
    setRevokeError(null);
    try {
      const res = await fetch('/api/auth/session/revoke-all', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      setPassword('');
      if (res.status === 401) {
        setRevokeError(t('me.security.signOutEverywhere.incorrectPassword'));
        setRevokeStage('error');
        return;
      }
      if (!res.ok) {
        setRevokeError(t('me.security.signOutEverywhere.failedGeneric'));
        setRevokeStage('error');
        return;
      }
      setRevokeStage('done');
      await signOut({ callbackUrl: '/auth' });
    } catch {
      setRevokeError(t('me.security.signOutEverywhere.failedGeneric'));
      setRevokeStage('error');
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>{t('me.security.heading')}</h1>
        <p className={styles.subhead}>{t('me.security.subhead')}</p>
      </header>

      {/* ── MFA enrollment (E-M10) ── */}
      <section className={styles.card} aria-label={t('me.security.mfa.sectionTitle')}>
        <h2 className={styles.sectionTitle}>{t('me.security.mfa.sectionTitle')}</h2>
        <p className={styles.sectionDesc}>{t('me.security.mfa.body')}</p>

        {mfaStage === 'loading' && <p className={styles.loading}>{t('me.security.mfa.loading')}</p>}

        {mfaStage === 'on' && (
          <div className={styles.statusRow}>
            <span className={styles.statusDotOn} aria-hidden="true" />
            <span>{t('me.security.mfa.statusOn')}</span>
          </div>
        )}

        {(mfaStage === 'off' || mfaStage === 'error') && (
          <div className={styles.btnRow}>
            <div className={styles.statusRow}>
              <span className={styles.statusDotOff} aria-hidden="true" />
              <span>{t('me.security.mfa.statusOff')}</span>
            </div>
            {mfaError && (
              <p className={`${styles.notice} ${styles.noticeFailed}`} role="alert">
                {mfaError}
              </p>
            )}
            <button type="button" className={styles.actionBtn} onClick={() => void startEnroll()}>
              {t('me.security.mfa.startEnrollCta')}
            </button>
          </div>
        )}

        {mfaStage === 'enrolling_verify' && enrollment && (
          <div className={styles.btnRow} style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <p className={styles.body}>{t('me.security.mfa.scanInstructions')}</p>
            <p className={styles.otpauthBox}>{enrollment.otpauthUri}</p>

            <p className={styles.body}>{t('me.security.mfa.recoveryCodesIntro')}</p>
            <ul className={styles.recoveryCodeList} aria-label={t('me.security.mfa.recoveryCodesIntro')}>
              {enrollment.recoveryCodes.map((rc) => (
                <li key={rc}>{rc}</li>
              ))}
            </ul>

            <div>
              <label className={styles.fieldLabel} htmlFor="security-mfa-code">
                {t('me.security.mfa.codeLabel')}
              </label>
              <input
                id="security-mfa-code"
                className={styles.codeInput}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
              />
            </div>
            {mfaError && (
              <p className={`${styles.notice} ${styles.noticeFailed}`} role="alert">
                {mfaError}
              </p>
            )}
            <div className={styles.btnRow}>
              <button type="button" className={styles.actionBtn} onClick={() => void submitVerify()}>
                {t('me.security.mfa.confirmCta')}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Sign out everywhere (§16.4) ── */}
      <section className={styles.card} aria-label={t('me.security.signOutEverywhere.sectionTitle')}>
        <h2 className={styles.sectionTitle}>{t('me.security.signOutEverywhere.sectionTitle')}</h2>
        <p className={styles.sectionDesc}>{t('me.security.signOutEverywhere.body')}</p>

        {revokeStage === 'done' ? (
          <p className={styles.noticeSuccess} role="status">
            {t('me.security.signOutEverywhere.done')}
          </p>
        ) : (
          <div className={styles.btnRow} style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <div>
              <label className={styles.fieldLabel} htmlFor="security-revoke-password">
                {t('me.security.signOutEverywhere.passwordLabel')}
              </label>
              <input
                id="security-revoke-password"
                type="password"
                className={styles.passwordInput}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {revokeError && <p className={`${styles.notice} ${styles.noticeFailed}`} role="status">{revokeError}</p>}
            <div className={styles.btnRow}>
              <button
                type="button"
                className={styles.dangerBtn}
                disabled={revokeStage === 'busy' || password.length === 0}
                onClick={() => void signOutEverywhere()}
              >
                {revokeStage === 'busy' ? t('me.security.signOutEverywhere.working') : t('me.security.signOutEverywhere.cta')}
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
