'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

const steps = [
  {
    title: 'Business / Industry',
    copy: 'Classify the business first, then ask only the follow-up questions that fit that structure.',
  },
  {
    title: 'Seven Whys',
    copy: 'Drive beneath the surface goal until the real reason is clear enough to guide daily behavior.',
  },
  {
    title: 'Warm market consent',
    copy: 'Confirm relationship-first contact organization and compliance-safe agent review.',
  },
  {
    title: 'Daily intensity',
    copy: 'Choose how strongly Harvest should interact with you while protecting the 2 Hour CEO constraint.',
  },
  {
    title: 'Downline Maxxer visualization',
    copy: 'Picture the downline business you are building so Mission Control can connect activity to the larger scoreboard.',
  },
];

const defaultWhys = [
  'I want to build a stronger business with consistent daily activity.',
  '',
  '',
  '',
  '',
  '',
  '',
];

const intensityLevels = [
  {
    value: 'LOW',
    label: 'Low — Quiet support',
    description: 'Light reminders, fewer nudges, and a slower pace. Best when you want Harvest to stay calm in the background.',
  },
  {
    value: 'MEDIUM',
    label: 'Medium — Standard 2 Hour CEO rhythm',
    description: 'Daily briefing, priority actions, and follow-up prompts. Best for steady business-building without pressure.',
  },
  {
    value: 'HIGH',
    label: 'High — Active accountability',
    description: 'Stronger nudges, faster escalation, and more direct reminders when actions stall. Best during a launch or promotion push.',
  },
];

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

const primericaLevels = [
  'VP / RVP',
  'Regional Leader',
  'District Leader',
  'Representative',
];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [industry, setIndustry] = useState('Financial services');
  const [businessModel, setBusinessModel] = useState('Downline / team-based organization');
  const [franchiseType, setFranchiseType] = useState('Financial services franchise');
  const [organizationName, setOrganizationName] = useState('Primerica');
  const [primericaLevel, setPrimericaLevel] = useState('Representative');
  const [solutionNumber, setSolutionNumber] = useState('');
  const [upline, setUpline] = useState('');
  const [whys, setWhys] = useState(defaultWhys);
  const [consent, setConsent] = useState('I consent to relationship-first contact organization, agent draft review, and compliance-safe delivery blocks.');
  const [intensity, setIntensity] = useState('MEDIUM');
  const [monthlyGoal, setMonthlyGoal] = useState('$5,000/month');
  const [teamGoal, setTeamGoal] = useState('Build a stable, duplicatable team of 12 active builders.');
  const [promotionTarget, setPromotionTarget] = useState('Reach the next leadership milestone in 90 days.');

  const current = steps[step];
  const isLast = step === steps.length - 1;
  const selectedIntensity = useMemo(
    () => intensityLevels.find((level) => level.value === intensity) || intensityLevels[1],
    [intensity],
  );
  const deepestWhy = [...whys].reverse().find((why) => why.trim().length > 0) || whys[0];
  const isFranchise = industry === 'Franchise' || businessModel === 'Franchise owner';
  const isPrimerica = organizationName.trim().toLowerCase().includes('primerica');

  return (
    <main className="form-page">
      <section className="card form-card" aria-labelledby="onboarding-title">
        <aside className="form-aside">
          <Link href="/" className="brand"><span className="brand-mark">H</span><span>The Harvest</span></Link>
          <h1 id="onboarding-title" style={{ fontSize: '3rem', marginTop: 48 }}>Set the operating system.</h1>
          <p style={{ color: 'rgba(255,255,255,.72)', lineHeight: 1.6 }}>
            Five demo steps create the profile Mission Control needs: industry, business structure, deep why,
            consent, intensity, and downline vision.
          </p>
        </aside>

        <div className="form-body">
          <span className="badge">Step {step + 1} of {steps.length}</span>
          <div className="stepper" aria-hidden="true">
            {steps.map((item, index) => <span key={item.title} className={`step-dot ${index <= step ? 'active' : ''}`} />)}
          </div>
          <h2>{current.title}</h2>
          <p className="lede" style={{ fontSize: '1rem' }}>{current.copy}</p>

          {step === 0 ? (
            <div className="stack compact-stack">
              <div className="field">
                <label htmlFor="industry">What is the business industry?</label>
                <select id="industry" value={industry} onChange={(event) => setIndustry(event.target.value)}>
                  {industries.map((item) => <option key={item}>{item}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="businessModel">Which structure best describes it?</label>
                <select id="businessModel" value={businessModel} onChange={(event) => setBusinessModel(event.target.value)}>
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
                  <select id="franchiseType" value={franchiseType} onChange={(event) => setFranchiseType(event.target.value)}>
                    {franchiseTypes.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </div>
              ) : null}
              <div className="field">
                <label htmlFor="organizationName">Name of business or organization</label>
                <input
                  id="organizationName"
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  placeholder="Example: business, franchise, school, firm, or organization name"
                />
              </div>
              {isPrimerica ? (
                <div className="primerica-fields">
                  <div className="field">
                    <label htmlFor="primericaLevel">Okay, what is your level?</label>
                    <select id="primericaLevel" value={primericaLevel} onChange={(event) => setPrimericaLevel(event.target.value)}>
                      {primericaLevels.map((level) => <option key={level}>{level}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="solutionNumber">Solution number</label>
                    <input
                      id="solutionNumber"
                      value={solutionNumber}
                      onChange={(event) => setSolutionNumber(event.target.value)}
                      placeholder="Unique identifier used to link the organization relationship"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="upline">Associated upline, field trainer, or RVP</label>
                    <input id="upline" value={upline} onChange={(event) => setUpline(event.target.value)} placeholder="Name of the person this account should connect to" />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="why-stack">
              {whys.map((why, index) => (
                <div className="field why-row" key={`why-${index + 1}`}>
                  <label htmlFor={`why-${index + 1}`}>Why {index + 1}</label>
                  <textarea
                    id={`why-${index + 1}`}
                    rows={index === 0 ? 2 : 3}
                    value={why}
                    placeholder={index === 0 ? 'What do you want?' : `Why does answer ${index} matter?`}
                    onChange={(event) => {
                      const next = [...whys];
                      next[index] = event.target.value;
                      setWhys(next);
                    }}
                  />
                </div>
              ))}
              <div className="notice">Deepest why detected: {deepestWhy}</div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="field">
              <label htmlFor="consent">Consent statement</label>
              <textarea id="consent" rows={6} value={consent} onChange={(event) => setConsent(event.target.value)} />
            </div>
          ) : null}

          {step === 3 ? (
            <div className="stack compact-stack">
              <div className="field">
                <label htmlFor="intensity">Daily intensity level</label>
                <select id="intensity" value={intensity} onChange={(event) => setIntensity(event.target.value)}>
                  {intensityLevels.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
                </select>
              </div>
              <div className="notice">
                <strong>{selectedIntensity.label}</strong><br />
                {selectedIntensity.description}
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="stack compact-stack">
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="monthlyGoal">Target monthly outcome</label>
                  <input id="monthlyGoal" value={monthlyGoal} onChange={(event) => setMonthlyGoal(event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="promotionTarget">Promotion target</label>
                  <input id="promotionTarget" value={promotionTarget} onChange={(event) => setPromotionTarget(event.target.value)} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="teamGoal">Downline vision</label>
                <textarea id="teamGoal" rows={4} value={teamGoal} onChange={(event) => setTeamGoal(event.target.value)} />
              </div>
              <div className="downline-visual" aria-label="Downline Maxxer visualization preview">
                <div className="visual-node visual-root">
                  <strong>{isPrimerica ? primericaLevel : 'You'}</strong>
                  <span>{organizationName || industry}</span>
                </div>
                <div className="visual-branches">
                  <div className="visual-node"><strong>Personal Base</strong><span>Warm market contacts</span></div>
                  <div className="visual-node"><strong>Builder Team</strong><span>{teamGoal}</span></div>
                  <div className="visual-node"><strong>Leadership Path</strong><span>{promotionTarget}</span></div>
                </div>
                <div className="notice">Downline Maxxer target: {monthlyGoal} tied to {selectedIntensity.label.toLowerCase()}.</div>
              </div>
            </div>
          ) : null}

          <div className="notice">Business-specific logic activates only after the user identifies the industry, business structure, and organization name.</div>
          <div className="actions">
            <button className="btn btn-secondary" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</button>
            {isLast ? (
              <Link className="btn btn-primary" href="/dashboard">Open Mission Control</Link>
            ) : (
              <button className="btn btn-primary" onClick={() => setStep((value) => Math.min(steps.length - 1, value + 1))}>Continue</button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
