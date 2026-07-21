'use client';

import Link from 'next/link';
import { getSession, signIn } from 'next-auth/react';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useT } from '@/app/locale-context';
import { landsOnTeamView } from '@/components/AppShell/navConfig';

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
  const t = useT();
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
        setLoginError(t('auth.invalidCredentials'));
      } else if (result?.ok) {
        // uiux AC-2-1: "Today is the default landing surface; every login lands on Today." MAJOR-M1 /
        // §2.3 item 3 / §2.4: a PURE upline (UPLINE/RVP) instead lands on the team view of Today
        // (`/today?persona=team`); DUAL defaults to its rep persona and REP/ADMIN to plain Today.
        // The role is read from the SERVER session (`getSession()` hits the server-computed
        // /api/auth/session) — never from client-supplied input — so the landing decision is
        // server-authoritative and cannot be spoofed.
        const session = await getSession();
        router.push(landsOnTeamView(session?.user?.role) ? '/today?persona=team' : '/today');
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
          <Link href="/" className="brand"><span className="brand-mark">H</span><span>{t('auth.brandName')}</span></Link>
          <h1 id="auth-title" style={{ fontSize: '3rem', marginTop: 48 }}>{t('auth.title')}</h1>
          {/* T-52 WCAG AA fix: was `color: 'rgba(255,255,255,.72)'` — a translucent
              white on the flat `--bg-deep` (`.form-aside`) fill. Swapped to the real
              design-system "secondary text on an inverse surface" token
              (`--muted-inverse`, 7.0:1 on `--grove-950`) — opaque, AA-passing, and
              consistent with `.side-link` / `.visual-root span` (globals.css), the
              other two carried exemptions this fix resolves. Redirect logic above
              (handleLogin / router.push) is untouched — this line only. */}
          <p style={{ color: 'var(--muted-inverse)', lineHeight: 1.6 }}>
            {t('auth.subtitle')}
          </p>
        </aside>

        <div className="form-body">
          <span className="badge">{t('auth.demoAccessBadge')}</span>
          <h2 style={{ marginTop: 14 }}>{mode === 'register' ? t('auth.registerHeading') : t('auth.loginHeading')}</h2>
          <div className="actions" style={{ marginTop: 0, marginBottom: 22 }}>
            <button className={`btn ${mode === 'register' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('register')}>{t('auth.registerTab')}</button>
            <button className={`btn ${mode === 'login' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('login')}>{t('auth.loginTab')}</button>
          </div>

          {mode === 'login' ? (
            <form onSubmit={handleLogin}>
              <div className="field">
                <label htmlFor="login-email">{t('auth.emailLabel')}</label>
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
                <label htmlFor="login-password">{t('auth.passwordLabel')}</label>
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
                  {loginPending ? t('auth.signingInCta') : t('auth.signInCta')}
                </button>
                <Link className="btn btn-secondary" href="/today">{t('auth.skipToToday')}</Link>
              </div>
            </form>
          ) : (
          <form action="/onboarding">
            <div className="field">
              <label htmlFor="name">{t('auth.nameLabel')}</label>
              <input id="name" name="name" defaultValue="Spaulding Demo" />
            </div>
            <div className="field">
              <label htmlFor="email">{t('auth.emailLabel')}</label>
              <input id="email" name="email" type="email" defaultValue="demo@theharvest.local" />
            </div>
            <div className="field">
              <label htmlFor="role">{t('auth.roleLabel')}</label>
              <select id="role" name="role" defaultValue="REP">
                <option value="REP">{t('auth.roleOptionRep')}</option>
                <option value="UPLINE">{t('auth.roleOptionUpline')}</option>
                <option value="RVP">RVP</option>
              </select>
            </div>

            <div className="wizard-block" aria-label={t('auth.wizard.ariaLabel')}>
              <span className="badge">{t('auth.wizard.badge')}</span>
              <div className="field">
                <label htmlFor="industry">{t('auth.wizard.industryQuestion')}</label>
                <select id="industry" name="industry" value={industry} onChange={(event) => setIndustry(event.target.value)}>
                  {industries.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="businessModel">{t('auth.wizard.businessModelQuestion')}</label>
                <select id="businessModel" name="businessModel" value={businessModel} onChange={(event) => setBusinessModel(event.target.value)}>
                  <option>{t('auth.wizard.businessModel.downline')}</option>
                  <option>{t('auth.wizard.businessModel.franchise')}</option>
                  <option>{t('auth.wizard.businessModel.independent')}</option>
                  <option>{t('auth.wizard.businessModel.localService')}</option>
                  <option>{t('auth.wizard.businessModel.consulting')}</option>
                  <option>{t('auth.wizard.businessModel.school')}</option>
                  <option>{t('auth.wizard.businessModel.corporate')}</option>
                </select>
              </div>

              {isFranchise ? (
                <div className="field">
                  <label htmlFor="franchiseType">{t('auth.wizard.franchiseTypeQuestion')}</label>
                  <select id="franchiseType" name="franchiseType" value={franchiseType} onChange={(event) => setFranchiseType(event.target.value)}>
                    {franchiseTypes.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>
              ) : null}

              <div className="field">
                <label htmlFor="organizationName">{t('auth.wizard.organizationNameLabel')}</label>
                <input
                  id="organizationName"
                  name="organizationName"
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  placeholder={t('auth.wizard.organizationNamePlaceholder')}
                />
              </div>

              {isPrimerica ? (
                <div className="primerica-fields">
                  <div className="field">
                    <label htmlFor="primericaLevel">{t('auth.primerica.levelLabel')}</label>
                    <select id="primericaLevel" name="primericaLevel" defaultValue="REP">
                      <option value="SNSD">{t('auth.primerica.level.snsd')}</option>
                      <option value="NSD">{t('auth.primerica.level.nsd')}</option>
                      <option value="SVP">{t('auth.primerica.level.svp')}</option>
                      <option value="RVP">{t('auth.primerica.level.rvp')}</option>
                      <option value="RL">{t('auth.primerica.level.rl')}</option>
                      <option value="DL">{t('auth.primerica.level.dl')}</option>
                      <option value="DISTRICT">{t('auth.primerica.level.district')}</option>
                      <option value="SR_REP">{t('auth.primerica.level.srRep')}</option>
                      <option value="REP">{t('auth.primerica.level.rep')}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="solutionNumber">{t('auth.primerica.solutionNumberLabel')}</label>
                    <input id="solutionNumber" name="solutionNumber" placeholder={t('auth.primerica.solutionNumberPlaceholder')} />
                  </div>
                  <div className="field">
                    <label htmlFor="supportRelationship">{t('auth.primerica.pairingQuestion')}</label>
                    <select id="supportRelationship" name="supportRelationship" defaultValue="IMMEDIATE_UPLINE">
                      <option value="IMMEDIATE_UPLINE">{t('auth.primerica.pairing.upline')}</option>
                      <option value="FIELD_TRAINER">{t('auth.primerica.pairing.fieldTrainer')}</option>
                      <option value="RVP">{t('auth.primerica.pairing.rvp')}</option>
                      <option value="UNKNOWN">{t('auth.primerica.pairing.unknown')}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="uplineName">{t('auth.primerica.uplineNameLabel')}</label>
                    <input id="uplineName" name="uplineName" placeholder={t('auth.primerica.uplineNamePlaceholder')} />
                  </div>
                  <div className="field">
                    <label htmlFor="knowsUplineSolutionId">{t('auth.primerica.knowsSolutionIdQuestion')}</label>
                    <select id="knowsUplineSolutionId" name="knowsUplineSolutionId" defaultValue="UNKNOWN">
                      <option value="YES">{t('common.yes')}</option>
                      <option value="NO">{t('common.no')}</option>
                      <option value="UNKNOWN">{t('auth.primerica.notSure')}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="uplineSolutionId">{t('auth.primerica.uplineSolutionIdLabel')}</label>
                    <input id="uplineSolutionId" name="uplineSolutionId" placeholder={t('auth.primerica.uplineSolutionIdPlaceholder')} />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="notice">{t('auth.demoDisclosureNotice')}</div>
            <div className="actions">
              <button className="btn btn-primary" type="submit">{t('auth.continueToOnboarding')}</button>
              <Link className="btn btn-secondary" href="/today">{t('auth.skipToToday')}</Link>
            </div>
          </form>
          )}
        </div>
      </section>
    </main>
  );
}
