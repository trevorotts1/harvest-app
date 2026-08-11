'use client';

import Link from 'next/link';
import { getSession, signIn } from 'next-auth/react';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useT } from '@/app/locale-context';
import { landsOnTeamView } from '@/components/AppShell/navConfig';
import StatusMessage from '@/components/StatusMessage';
import { sponsorStepSkippedForRole } from '@/services/onboarding/wp01/pairing-policy';
import { Role } from '@prisma/client';

import { registerAndSignIn, type RegisterFields } from './register-client';

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
  // R-01 (refinements catalog 2026-07-28) — the registrant's selected Primerica level, mirroring
  // the wizard's controlled select so the pairing fields can key off it. An RVP is NEVER required
  // to name an upline (name or solution ID all optional) and is told on-screen they are not being
  // paired with anyone; levels BELOW RVP keep the normal required pairing capture. The raw select
  // value (uncontrolled, defaultValue="REP") is also read from FormData at submit, exactly as
  // before — this state exists only for the conditional UI.
  const [primericaLevel, setPrimericaLevel] = useState('REP');

  // Login mode (T-04): wired to Auth.js's real Credentials sign-in, replacing the demo stub.
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginPending, setLoginPending] = useState(false);

  // T-R39: the register wizard now REALLY creates an account. It used to be a plain GET-navigating
  // form (its `action` attribute pointed straight at /onboarding) carrying hardcoded demo defaults
  // (name="Spaulding Demo", email="demo@theharvest.local") that never touched the network, despite
  // a since-removed comment here claiming it "still POSTs to /api/auth/register". No account was
  // ever created, so a real new person could never sign in — and `/api/onboarding/step`'s
  // `withRole` gate (src/lib/auth/with-role.ts) requires a real authenticated session, so they
  // could not reach onboarding at all either. `handleRegister` below POSTs
  // /api/auth/register (src/app/api/auth/register/route.ts) to create the User row with a real
  // bcrypt hash, THEN calls `signIn('credentials', ...)` to establish the session, and ONLY THEN
  // navigates to /onboarding — see `registerAndSignIn` (register-client.ts) for the fail-closed
  // orchestration (a failure at either step reports an honest error and never navigates).
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerPending, setRegisterPending] = useState(false);

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

  const handleRegister = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (registerPending) return; // double-submit guard — a second click mid-flight is a no-op
    setRegisterError(null);
    setRegisterPending(true);

    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    const role = String(data.get('role') ?? 'REP');
    const solutionNumber = String(data.get('solutionNumber') ?? '').trim();

    const fields: RegisterFields = {
      name,
      email,
      password,
      // R-07: the Rep/Upline/RVP level selector is now carried through registration instead of
      // being dropped — the route persists it (previously every registrant was stored as REP).
      // Type-narrowed from the raw select value (which defaults to REP and can only yield one of
      // the three option values) to the client's self-selectable-role union.
      role: (role === 'UPLINE' || role === 'RVP' ? role : 'REP') as RegisterFields['role'],
      orgType: isPrimerica ? 'PRIMERICA' : 'EXTERNAL',
      solutionNumber,
    };

    try {
      const outcome = await registerAndSignIn(fields, (signInEmail, signInPassword) =>
        signIn('credentials', { email: signInEmail, password: signInPassword, redirect: false })
      );
      if (outcome.outcome === 'error') {
        setRegisterError(t(outcome.catalogKey));
        return; // NEVER navigate to /onboarding unless the account + session both truly exist
      }
      router.push('/onboarding');
    } finally {
      setRegisterPending(false);
    }
  };

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
          <form onSubmit={handleRegister}>
            <div className="field">
              <label htmlFor="name">{t('auth.nameLabel')}</label>
              <input id="name" name="name" autoComplete="name" required />
            </div>
            <div className="field">
              <label htmlFor="email">{t('auth.emailLabel')}</label>
              <input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="field">
              <label htmlFor="password">{t('auth.passwordLabel')}</label>
              <input id="password" name="password" type="password" autoComplete="new-password" required />
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
                    {/* R-01 — controlled so the pairing block below can key off the selected level
                        (an RVP is never required to name an upline). `name="primericaLevel"` is kept
                        so the submit handler still reads the raw value from FormData, exactly as
                        before this fix. */}
                    <select
                      id="primericaLevel"
                      name="primericaLevel"
                      value={primericaLevel}
                      onChange={(event) => setPrimericaLevel(event.target.value)}
                    >
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
                  {/* R-01 — the RVP pairing branch keys off the ROLE-KEYED policy
                      (`sponsorStepSkippedForRole(Role.RVP)`) — the exact same decision the
                      onboarding flow's sponsor-step skip uses, so the registration wizard and the
                      onboarding flow can never disagree about whether an RVP is paired. */}
                  {sponsorStepSkippedForRole(Role.RVP) && primericaLevel === 'RVP' ? (
                    // R-01 — RVP: "do NOT auto-pair them with anyone; do NOT require an immediate
                    // upline (name or upline solution ID all OPTIONAL / skippable); state clearly
                    // on-screen that as an RVP they are not being paired with anyone; upline
                    // linkage stays OPTIONAL (an RVP MAY name their SVP/promoter if that person is
                    // on the platform) but that upline does not 'step in' or supervise."
                    <div className="notice">
                      <p>{t('auth.primerica.rvpNoPairingBody')}</p>
                      <p>{t('auth.primerica.rvpUplineOptional')}</p>
                    </div>
                  ) : (
                    // Levels BELOW RVP keep the normal required upline pairing — unchanged.
                    <>
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
                    </>
                  )}
                </div>
              ) : null}
            </div>

            {registerError ? <StatusMessage>{registerError}</StatusMessage> : null}
            <div className="notice">{t('auth.demoDisclosureNotice')}</div>
            <div className="actions">
              <button className="btn btn-primary" type="submit" disabled={registerPending}>
                {registerPending ? t('auth.registeringCta') : t('auth.continueToOnboarding')}
              </button>
              <Link className="btn btn-secondary" href="/today">{t('auth.skipToToday')}</Link>
            </div>
          </form>
          )}
        </div>
      </section>
    </main>
  );
}
