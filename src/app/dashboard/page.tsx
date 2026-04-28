import Link from 'next/link';

const actions = [
  { title: 'Approve first-touch draft', contact: 'Maya Johnson', agent: 'Prospecting', minutes: 2 },
  { title: 'Review response and suggest appointment window', contact: 'Derrick Miles', agent: 'Appointment', minutes: 3 },
  { title: 'Send compliance-safe nurture check-in', contact: 'Tasha Green', agent: 'Nurture', minutes: 2 },
];

const laws = [
  { name: 'Grow Downline', score: 78 },
  { name: 'Engage Base', score: 84 },
  { name: 'Increase Wealth', score: 71 },
];

export default function DashboardPage() {
  return (
    <main className="app-frame">
      <aside className="sidebar">
        <Link href="/" className="brand"><span className="brand-mark">H</span><span>The Harvest</span></Link>
        <nav aria-label="Dashboard navigation">
          <a className="side-link active" href="#briefing">Mission Control</a>
          <a className="side-link" href="#queue">Action Queue</a>
          <a className="side-link" href="#warm-market">Warm Market</a>
          <a className="side-link" href="#compliance">Compliance</a>
        </nav>
      </aside>

      <section className="main">
        <header className="topbar">
          <div>
            <span className="badge">Demo dashboard</span>
            <h1 style={{ fontSize: '3.4rem', margin: '12px 0 0' }}>Good morning. Keep it focused.</h1>
          </div>
          <Link className="btn btn-secondary" href="/onboarding">Edit profile</Link>
        </header>

        <div className="dashboard-grid">
          <div className="stack">
            <section className="card panel" id="briefing">
              <span className="badge">Daily briefing</span>
              <h2 style={{ marginTop: 12 }}>3 approvals, 1 appointment window, 0 compliance blocks.</h2>
              <p>
                Your highest-value path today is to approve two relationship-first drafts and confirm one calendar window.
                No outbound message leaves the system without review.
              </p>
            </section>

            <section className="card panel" id="queue">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
                <div>
                  <span className="badge">Action queue</span>
                  <h3 style={{ marginTop: 12 }}>Today’s next best actions</h3>
                </div>
                <span className="badge">7 min total</span>
              </div>
              {actions.map((action, index) => (
                <div className="action-row" key={action.title}>
                  <span className="priority">{index + 1}</span>
                  <div>
                    <strong>{action.title}</strong><br />
                    <span style={{ color: 'var(--muted)' }}>{action.contact} · {action.agent} Agent</span>
                  </div>
                  <span className="badge">{action.minutes} min</span>
                </div>
              ))}
            </section>
          </div>

          <div className="stack">
            <section className="card panel" id="warm-market">
              <span className="badge">Warm market</span>
              <div className="metric-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
                <div className="metric"><strong>126</strong><span>organized contacts</span></div>
                <div className="metric"><strong>18</strong><span>A-list relationships</span></div>
                <div className="metric"><strong>9</strong><span>active conversations</span></div>
                <div className="metric"><strong>2</strong><span>calendar-ready</span></div>
              </div>
            </section>

            <section className="card panel">
              <span className="badge">Three Laws</span>
              <div className="stack" style={{ marginTop: 18 }}>
                {laws.map((law) => (
                  <div key={law.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <strong>{law.name}</strong><span>{law.score}</span>
                    </div>
                    <div className="progress"><span style={{ width: `${law.score}%` }} /></div>
                  </div>
                ))}
              </div>
            </section>

            <section className="card panel" id="compliance">
              <span className="badge">Compliance safe</span>
              <h3 style={{ marginTop: 12 }}>Fail-closed delivery</h3>
              <p>Drafts can be prepared, but delivery remains blocked if the compliance filter is unavailable or returns a block.</p>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
