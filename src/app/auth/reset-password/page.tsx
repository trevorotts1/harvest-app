'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';

import { useT } from '@/app/locale-context';

/**
 * Password-reset completion (T-R76, §16.4/§18.10): consumes the single-use token from the email
 * link (?email=…&token=…) and submits the new password to POST /api/auth/password-reset/confirm.
 * That route screens the new password against known-breached passwords, bumps security_version
 * (revoking every prior session), and FAILS CLOSED on an invalid/expired token — so this page only
 * ever shows the outcome the route reported.
 *
 * `useSearchParams` requires a Suspense boundary in a client page (Next.js build rule), and the
 * same hydration guard as /auth applies: no submit before the client bundle is interactive.
 */
function ResetPasswordForm() {
  const t = useT();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';
  const token = searchParams.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mounted, setMounted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => setMounted(true), []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(t('auth.resetMismatch'));
      return;
    }
    setPending(true);
    try {
      const res = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, newPassword }),
      });
      const body = (await res.json().catch(() => ({}))) as { reset?: boolean; error?: string };
      if (res.ok && body.reset) {
        setDone(true);
      } else {
        setError(body.error ?? t('auth.resetGenericError'));
      }
    } catch {
      setError(t('auth.resetGenericError'));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="form-page">
      <section className="card form-card" aria-labelledby="reset-title">
        <aside className="form-aside">
          <Link href="/" className="brand"><span className="brand-mark">H</span><span>{t('auth.brandName')}</span></Link>
          <h1 id="reset-title" style={{ fontSize: '2.4rem', marginTop: 48 }}>{t('auth.resetHeading')}</h1>
          <p style={{ color: 'var(--muted-inverse)', lineHeight: 1.6 }}>{t('auth.resetSubtitle')}</p>
        </aside>
        <div className="form-body">
          <span className="badge">{t('auth.demoAccessBadge')}</span>
          <h2 style={{ marginTop: 14 }}>{t('auth.resetCardTitle')}</h2>

          {done ? (
            <div className="notice" role="status">{t('auth.resetDone')}</div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="reset-email">{t('auth.emailLabel')}</label>
                <input id="reset-email" name="email" type="email" value={email} readOnly />
              </div>
              <div className="field">
                <label htmlFor="reset-password">{t('auth.resetNewLabel')}</label>
                <input
                  id="reset-password"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="reset-confirm">{t('auth.resetConfirmLabel')}</label>
                <input
                  id="reset-confirm"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </div>
              {error ? (
                <div className="notice notice-danger" role="alert">{error}</div>
              ) : null}
              <div className="actions">
                <button className="btn btn-primary" type="submit" disabled={pending || !mounted || !token || !email}>
                  {pending ? t('auth.resetSaving') : t('auth.resetCta')}
                </button>
                <Link className="btn btn-secondary" href="/auth">{t('auth.backToAuth')}</Link>
              </div>
            </form>
          )}
          {done ? (
            <div className="actions">
              <Link className="btn btn-secondary" href="/auth">{t('auth.backToAuth')}</Link>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
