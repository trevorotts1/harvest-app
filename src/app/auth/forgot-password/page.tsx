'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useT } from '@/app/locale-context';

/**
 * Forgot-password entry (T-R76, completes §16.4/§18.10 UX): a small, unauthenticated page that
 * submits the account email to POST /api/auth/password-reset/request. That route is
 * non-enumerating by design — it answers identically whether or not the email is registered — so
 * this page always shows the same success message: no way to probe which addresses exist.
 *
 * Hydration guard (same rationale as /auth): while `mounted` is false the submit button is
 * disabled, so a pre-hydration click can never fire a native GET that would put the email in the
 * URL query string.
 */
export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [mounted, setMounted] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => setMounted(true), []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      // Generic success regardless of the response body — the route is non-enumerating.
      setSubmitted(true);
    } catch {
      setSubmitted(true); // still generic; a network failure must not leak existence either
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="form-page">
      <section className="card form-card" aria-labelledby="forgot-title">
        <aside className="form-aside">
          <Link href="/" className="brand"><span className="brand-mark">H</span><span>{t('auth.brandName')}</span></Link>
          <h1 id="forgot-title" style={{ fontSize: '2.4rem', marginTop: 48 }}>{t('auth.forgotHeading')}</h1>
          <p style={{ color: 'var(--muted-inverse)', lineHeight: 1.6 }}>{t('auth.forgotSubtitle')}</p>
        </aside>
        <div className="form-body">
          <span className="badge">{t('auth.demoAccessBadge')}</span>
          <h2 style={{ marginTop: 14 }}>{t('auth.forgotCardTitle')}</h2>

          {submitted ? (
            <div className="notice" role="status">{t('auth.forgotSent')}</div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="forgot-email">{t('auth.emailLabel')}</label>
                <input
                  id="forgot-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="actions">
                <button className="btn btn-primary" type="submit" disabled={pending || !mounted}>
                  {pending ? t('auth.forgotSending') : t('auth.forgotCta')}
                </button>
                <Link className="btn btn-secondary" href="/auth">{t('auth.backToAuth')}</Link>
              </div>
            </form>
          )}
          {submitted ? (
            <div className="actions">
              <Link className="btn btn-secondary" href="/auth">{t('auth.backToAuth')}</Link>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
