'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

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
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [industry, setIndustry] = useState('Financial services');
  const [businessModel, setBusinessModel] = useState('Downline / team-based organization');
  const [franchiseType, setFranchiseType] = useState('Financial services franchise');
  const [organizationName, setOrganizationName] = useState('');

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
          <p style={{ color: 'rgba(255,255,255,.72)', lineHeight: 1.6 }}>
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
              <Link className="btn btn-secondary" href="/dashboard">Skip to dashboard</Link>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
