'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('register');

  return (
    <main className="form-page">
      <section className="card form-card" aria-labelledby="auth-title">
        <aside className="form-aside">
          <Link href="/" className="brand"><span className="brand-mark">H</span><span>The Harvest</span></Link>
          <h1 id="auth-title" style={{ fontSize: '3rem', marginTop: 48 }}>Enter the command center.</h1>
          <p style={{ color: 'rgba(255,255,255,.72)', lineHeight: 1.6 }}>
            This demo uses local form state so you can move through the product flow without waiting on production auth.
          </p>
        </aside>

        <div className="form-body">
          <span className="badge">Demo access</span>
          <h2 style={{ marginTop: 14 }}>{mode === 'register' ? 'Create your demo profile' : 'Welcome back'}</h2>
          <div className="actions" style={{ marginTop: 0, marginBottom: 22 }}>
            <button className={`btn ${mode === 'register' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('register')}>Register</button>
            <button className={`btn ${mode === 'login' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('login')}>Login</button>
          </div>

          <form action="/onboarding">
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" defaultValue="Spaulding Demo" />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" defaultValue="demo@theharvest.local" />
            </div>
            <div className="field">
              <label htmlFor="role">Role</label>
              <select id="role" name="role" defaultValue="REP">
                <option value="REP">Rep/User</option>
                <option value="UPLINE">Upline</option>
                <option value="RVP">RVP</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="downlineBusiness">Downline business / company</label>
              <select id="downlineBusiness" name="downlineBusiness" defaultValue="PRIMERICA">
                <option value="PRIMERICA">Primerica</option>
                <option value="OTHER_FINANCIAL_SERVICES">Other financial services organization</option>
                <option value="OTHER_NETWORK_MARKETING">Other network marketing / downline business</option>
                <option value="INDEPENDENT">Independent / not company-linked</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="solutionNumber">Primerica solution number / business identifier</label>
              <input id="solutionNumber" name="solutionNumber" placeholder="Used to link rep, upline, field trainer, or RVP" />
            </div>
            <div className="field">
              <label htmlFor="uplineName">Associated upline or RVP</label>
              <input id="uplineName" name="uplineName" placeholder="Name of upline, field trainer, or RVP" />
            </div>
            <div className="notice">The downline business and solution number identify whether this profile belongs to Primerica or another company structure. No real message, payment, or external account action happens in this demo.</div>
            <div className="actions">
              <button className="btn btn-primary" type="submit">Continue to onboarding</button>
              <Link className="btn btn-secondary" href="/dashboard">Skip to dashboard</Link>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
