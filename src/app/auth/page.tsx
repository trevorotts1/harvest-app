'use client';

import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const industries = [
  'Financial services',
  'Restaurant',
  'Food service',
  'Education',
  'Consulting',
  'Franchise',
  'Real estate',
  'Health & wellness',
  'Beauty / personal care',
  'Retail / e-commerce',
  'Professional services',
  'Nonprofit / community organization',
  'Other',
];

const franchiseTypes = [
  'Food service franchise',
  'Financial services franchise',
  'Tax preparation franchise',
  'Retail franchise',
  'Fitness / wellness franchise',
  'Home services franchise',
  'Other franchise',
];

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [industry, setIndustry] = useState('Financial services');
  const [businessModel, setBusinessModel] = useState('Downline / team-based organization');
  const [franchiseType, setFranchiseType] = useState('Financial services franchise');
  const [organizationName, setOrganizationName] = useState('');

  // Login mode (T-04): wired to Auth.js's real Credentials sign-in, replacing the demo stub. The
  // register wizard below is unchanged — registration (WP01 territory) still POSTs to
  // /api/auth/register (src/app/api/auth/register/route.ts) then continues to /onboarding; a
  // successful registration does not itself start a session, so sign-in after registering still
  // goes through this same login form.
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginPending, setLoginPending] = useState(false);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(null);
    setLoginPending(true);
    try {
      const result = await signIn('credentials', {
        email: loginEmail,
        password: loginPassword,
        redirect: false,
      });
      if (result?.error) {
        // Generic message regardless of failure reason (§16.4: never reveal whether an email
        // exists) — NextAuth's CredentialsProvider `authorize()` already returns `null` uniformly
        // for "no such user" and "wrong password"; this mirrors that at the UI layer too.
        setLoginError('Invalid email or password.');
      } else if (result?.ok) {
        // T-R28 (uiux AC-2-1 "Today is the default landing surface; every login lands on Today").
        // This used to push straight to the pre-rebuild demo scaffold (hardcoded mock arrays,
        // `#fragment` nav, no links to the five real destinations) — the retired route is now
        // harmless even so, having been converted to a pure server redirect, but a fresh login
        // should land directly on the real surface, not bounce through a retired stub.
        router.push('/today');
      }
    } finally {
      setLoginPending(false);
    }
  };

  const isFranchise = industry === 'Franchise' || businessModel === 'Franchise owner';
  const isPrimerica = useMemo(
    () => organizationName.trim().toLowerCase().includes('primerica'),
    [organizationName],
  );

  return (
    <main className="form-page">
      <section className="card form-card" aria-labelledby="auth-title">
        <aside className="form-aside">
          <Link href="/" className="brand"><span className="brand-mark">H</span><span>The Harvest</span></Link>
          <h1 id="auth-title" style={{ fontSize: '3rem', marginTop: 48 }}>Enter the command center.</h1>
          {/* T-52 WCAG AA fix: was `color: 'rgba(255,255,255,.72)'` — a translucent
              white on the flat `--bg-deep` (`.form-aside`) fill. Swapped to the real
              design-system "secondary text on an inverse surface" token
              (`--muted-inverse`, 7.0:1 on `--grove-950`) — opaque, AA-passing, and
              consistent with `.side-link` / `.visual-root span` (globals.css), the
              other two carried exemptions this fix resolves. Redirect logic above
              (handleLogin / router.push) is untouched — this line only. */}
          <p style={{ color: 'var(--muted-inverse)', lineHeight: 1.6 }}>
            The demo classifies the business first, then reveals only the fields that match that business structure.
          </p>
        </aside>

        <div className="form-body">
          <span className="badge">Demo access</span>
          <h2 style={{ marginTop: 14 }}>{mode === 'register' ? 'Create your demo profile' : 'Welcome back'}</h2>
          <div className="actions" style={{ marginTop: 0, marginBottom: 22 }}>
            <button className={`btn ${mode === 'register' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('register')}>Register</button>
            <button className={`btn ${mode === 'login' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('login')}>Login</button>
          </div>

          {mode === 'login' ? (
            <form onSubmit={handleLogin}>
              <div className="field">
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  required
                />
              </div>
              {loginError ? (
                <div className="notice" role="alert">{loginError}</div>
              ) : null}
              <div className="actions">
                <button className="btn btn-primary" type="submit" disabled={loginPending}>
                  {loginPending ? 'Signing in…' : 'Sign in'}
                </button>
                <Link className="btn btn-secondary" href="/today">Skip to Today</Link>
              </div>
            </form>
          ) : (
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

            <div className="wizard-block" aria-label="Business and industry wizard">
              <span className="badge">Business / Industry wizard</span>
              <div className="field">
                <label htmlFor="industry">What is the business industry?</label>
                <select id="industry" name="industry" value={industry} onChange={(event) => setIndustry(event.target.value)}>
                  {industries.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="businessModel">Which structure best describes it?</label>
                <select id="businessModel" name="businessModel" value={businessModel} onChange={(event) => setBusinessModel(event.target.value)}>
                  <option>Downline / team-based organization</option>
                  <option>Franchise owner</option>
                  <option>Independent professional practice</option>
                  <option>Local service business</option>
                  <option>Consulting firm</option>
                  <option>School / education program</option>
                  <option>Corporate team</option>
                </select>
              </div>

              {isFranchise ? (
                <div className="field">
                  <label htmlFor="franchiseType">What type of franchise?</label>
                  <select id="franchiseType" name="franchiseType" value={franchiseType} onChange={(event) => setFranchiseType(event.target.value)}>
                    {franchiseTypes.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>
              ) : null}

              <div className="field">
                <label htmlFor="organizationName">Name of business or organization</label>
                <input
                  id="organizationName"
                  name="organizationName"
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  placeholder="Example: business, franchise, school, firm, or organization name"
                />
              </div>

              {isPrimerica ? (
                <div className="primerica-fields">
                  <div className="field">
                    <label htmlFor="primericaLevel">Primerica level</label>
                    <select id="primericaLevel" name="primericaLevel" defaultValue="REP">
                      <option value="SNSD">SNSD (Senior National Sales Director)</option>
                      <option value="NSD">NSD (National Sales Director)</option>
                      <option value="SVP">SVP (Senior Vice President)</option>
                      <option value="RVP">RVP (Regional Vice President)</option>
                      <option value="RL">RL (Regional Leader)</option>
                      <option value="DL">DL (Division Leader)</option>
                      <option value="DISTRICT">District (District Leader)</option>
                      <option value="SR_REP">Sr. Rep (Senior Representative)</option>
                      <option value="REP">Rep (Representative)</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="solutionNumber">What is your solution number?</label>
                    <input id="solutionNumber" name="solutionNumber" placeholder="Enter your Primerica solution number" />
                  </div>
                  <div className="field">
                    <label htmlFor="supportRelationship">Who can you identify for pairing?</label>
                    <select id="supportRelationship" name="supportRelationship" defaultValue="IMMEDIATE_UPLINE">
                      <option value="IMMEDIATE_UPLINE">My immediate upline</option>
                      <option value="FIELD_TRAINER">My field trainer</option>
                      <option value="RVP">My RVP</option>
                      <option value="UNKNOWN">I do not know yet</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="uplineName">Name of upline, field trainer, or RVP</label>
                    <input id="uplineName" name="uplineName" placeholder="Name of the person this account should connect to" />
                  </div>
                  <div className="field">
                    <label htmlFor="knowsUplineSolutionId">Do you know their solution ID?</label>
                    <select id="knowsUplineSolutionId" name="knowsUplineSolutionId" defaultValue="UNKNOWN">
                      <option value="YES">Yes</option>
                      <option value="NO">No</option>
                      <option value="UNKNOWN">Not sure</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="uplineSolutionId">Upline solution ID</label>
                    <input id="uplineSolutionId" name="uplineSolutionId" placeholder="If known, enter it so Harvest can pair accounts when both are on-platform" />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="notice">Business-specific fields appear only after the business type or organization name makes them relevant. No real message, payment, or external account action happens in this demo.</div>
            <div className="actions">
              <button className="btn btn-primary" type="submit">Continue to onboarding</button>
              <Link className="btn btn-secondary" href="/today">Skip to Today</Link>
            </div>
          </form>
          )}
        </div>
      </section>
    </main>
  );
}
