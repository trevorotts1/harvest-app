import Link from 'next/link';

export default function LandingPage() {
  return (
    <main>
      <nav className="shell nav" aria-label="Primary navigation">
        <Link href="/" className="brand" aria-label="The Harvest home">
          <span className="brand-mark">H</span>
          <span>The Harvest</span>
        </Link>
        <div className="nav-links">
          <a href="#method">Method</a>
          <a href="#mission-control">Mission Control</a>
          <Link href="/auth">Start demo</Link>
        </div>
      </nav>

      <section className="shell hero">
        <div>
          <p className="eyebrow">The 2 Hour CEO Business Agent</p>
          <h1>Build the base without burning out.</h1>
          <p className="lede">
            The Harvest turns warm-market activity into a calm daily command center: who to reach,
            what to approve, what needs attention, and what stays blocked until compliance clears it.
          </p>
          <div className="actions">
            <Link className="btn btn-primary" href="/auth">Open the demo</Link>
            <Link className="btn btn-secondary" href="/dashboard">View dashboard</Link>
          </div>
          <div className="metric-grid" aria-label="Demo highlights">
            <div className="metric"><strong>30</strong><span>minute daily operating window</span></div>
            <div className="metric"><strong>3</strong><span>laws monitored every day</span></div>
            <div className="metric"><strong>0</strong><span>messages sent without review</span></div>
          </div>
        </div>

        <div className="card hero-card" id="mission-control">
          <div className="score-ring">
            <div>
              <span className="badge">Mission Control preview</span>
              <h2 style={{ marginTop: 22 }}>Today’s harvest score: 82</h2>
              <p style={{ color: 'rgba(255,255,255,0.78)', lineHeight: 1.6 }}>
                Three high-trust contacts, two nurture moments, one appointment window. Nothing noisy.
              </p>
            </div>
            <div className="grid-3">
              <div><strong>7</strong><br /><span>Queued actions</span></div>
              <div><strong>4</strong><br /><span>Warm contacts</span></div>
              <div><strong>1</strong><br /><span>Needs approval</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="shell section" id="method">
        <div className="grid-3">
          <article className="card feature">
            <span className="badge">1 · Focus</span>
            <h3>Warm-market first</h3>
            <p>Contacts are organized by relationship, recency, trust, and stage — not treated like a cold list.</p>
          </article>
          <article className="card feature">
            <span className="badge">2 · Guardrails</span>
            <h3>Compliance before delivery</h3>
            <p>Agent drafts stay drafts until the compliance filter says they are safe to approve or send.</p>
          </article>
          <article className="card feature">
            <span className="badge">3 · Momentum</span>
            <h3>Small daily command loop</h3>
            <p>The app shows the few actions that matter today so the rep can build without living inside a CRM.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
