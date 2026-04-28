'use client';

import Link from 'next/link';
import { useState } from 'react';

const steps = [
  { title: 'Your role', copy: 'Choose how Harvest should shape visibility, nudges, and team context.', field: 'I am building as a Rep with upline support.' },
  { title: 'Seven Whys', copy: 'Anchor the daily command center to the reason you are building, not just the task list.', field: 'I am building durable freedom for my family and my team.' },
  { title: 'Warm market consent', copy: 'Harvest keeps outreach relationship-first and blocks delivery until consent/compliance are clear.', field: 'I consent to demo contact organization and agent draft review.' },
  { title: 'Daily intensity', copy: 'Set the operating pace so the app protects the 2 Hour CEO constraint.', field: '30 minutes daily, focused actions only.' },
];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <main className="form-page">
      <section className="card form-card" aria-labelledby="onboarding-title">
        <aside className="form-aside">
          <Link href="/" className="brand"><span className="brand-mark">H</span><span>The Harvest</span></Link>
          <h1 id="onboarding-title" style={{ fontSize: '3rem', marginTop: 48 }}>Set the operating system.</h1>
          <p style={{ color: 'rgba(255,255,255,.72)', lineHeight: 1.6 }}>
            Four demo steps create the minimum profile needed for Mission Control to brief the day.
          </p>
        </aside>

        <div className="form-body">
          <span className="badge">Step {step + 1} of {steps.length}</span>
          <div className="stepper" aria-hidden="true">
            {steps.map((item, index) => <span key={item.title} className={`step-dot ${index <= step ? 'active' : ''}`} />)}
          </div>
          <h2>{current.title}</h2>
          <p className="lede" style={{ fontSize: '1rem' }}>{current.copy}</p>
          <div className="field">
            <label htmlFor="response">Demo response</label>
            <textarea id="response" rows={5} defaultValue={current.field} />
          </div>
          <div className="notice">Primerica-specific fields stay hidden unless the profile is explicitly organization-linked.</div>
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
