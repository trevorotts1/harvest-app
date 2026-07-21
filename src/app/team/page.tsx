// T-45 (WP09 §14.4; uiux §5.9) — the upline/RVP dashboard. Outcomes + pace only — no per-task
// activity feed, no screen-time metric, no leaderboard (anti-surveillance doctrine, AC-5.9-1/2).
// Zero-team renders the recruit-your-first coaching state (uiux AC-5.9-8), never a blank screen.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface RosterRow {
  userId: string;
  name: string;
  paceIcon: 'leaf-check' | 'flag-caution' | 'moon-rest';
  paceLabel: string;
  momentumBand: string;
  lastActiveAt: string | null;
}

interface DashboardData {
  hasTeam: boolean;
  roster: RosterRow[];
  needsYouNow: { handoffId: string; repUserId: string; triggerReason: string; invitedAt: string }[];
  downlineLeak: { userId: string; daysSinceFieldActivity: number }[];
  fieldTrainerRatio: { appointmentsRun: number; completed: number; noShows: number; closeRate: number };
  teamAvailability: { bucketStart: string; busyCount: number; teamSize: number }[];
}

const PACE_GLYPH: Record<RosterRow['paceIcon'], string> = { 'leaf-check': '🌿', 'flag-caution': '🚩', 'moon-rest': '🌙' };

type LoadState = { kind: 'loading' } | { kind: 'ready'; data: DashboardData } | { kind: 'forbidden' } | { kind: 'failed' };

export default function TeamDashboardPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [sort, setSort] = useState<'name' | 'pace' | 'momentum'>('name');

  const load = useCallback(async (sortBy: string) => {
    try {
      const res = await fetch(`/api/team/dashboard?sort=${sortBy}`);
      if (res.status === 403) {
        setState({ kind: 'forbidden' });
        return;
      }
      if (!res.ok) {
        setState({ kind: 'failed' });
        return;
      }
      const data = (await res.json()) as DashboardData;
      setState({ kind: 'ready', data });
    } catch {
      setState({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    load(sort);
  }, [load, sort]);

  if (state.kind === 'loading') {
    return <div className="card panel"><p>Gathering your team&apos;s report…</p></div>;
  }
  if (state.kind === 'forbidden') {
    return (
      <div className="card panel">
        <span className="badge">Team view</span>
        <h2>This view is for team leads</h2>
        <p>Reps see their own Today view. If you sponsor someone, check the Sponsor Cockpit instead.</p>
        <Link className="btn btn-secondary" href="/team/cockpit">Go to Sponsor Cockpit</Link>
      </div>
    );
  }
  if (state.kind === 'failed') {
    return (
      <div className="card panel">
        <p>We couldn&apos;t load your team dashboard right now — your data is safe.</p>
        <button type="button" className="btn btn-secondary" onClick={() => load(sort)}>Retry</button>
      </div>
    );
  }

  const { data } = state;

  if (!data.hasTeam) {
    return (
      <div className="card panel">
        <span className="badge">Team</span>
        <h2>Your team starts with one.</h2>
        <p>Invite your first downline member to see their pace and outcomes here.</p>
        <Link className="btn btn-primary" href="/community">Start the invitation flow</Link>
      </div>
    );
  }

  return (
    <div className="stack">
      {/* T-09 (§5.5 AC-3b) — reachable affordance into the upline's CFE FLAG adjudication queue. */}
      <section className="card panel">
        <span className="badge">Compliance review</span>
        <p style={{ marginTop: 8 }}>Flagged drafts from your team awaiting your review.</p>
        <Link className="btn btn-secondary" href="/team/compliance-review">Open compliance review</Link>
      </section>

      {data.needsYouNow.length > 0 && (
        <section className="card panel">
          <span className="badge">Needs you now</span>
          <div className="stack" style={{ marginTop: 12 }}>
            {data.needsYouNow.map((item) => (
              <div key={item.handoffId} className="action-row">
                <span className="priority">!</span>
                <div>
                  <strong>{item.triggerReason.replace(/_/g, ' ').toLowerCase()}</strong>
                  <br />
                  <span style={{ color: 'var(--muted)' }}>A downline rep needs you in a three-way today.</span>
                </div>
                <Link className="btn btn-primary" href={`/team/rep/${item.repUserId}`}>Join the three-way</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span className="badge">Roster</span>
            <h2 style={{ marginTop: 8 }}>Pace and outcomes — never a ranking</h2>
          </div>
          <label>
            Sort by{' '}
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="name">Name</option>
              <option value="pace">Pace</option>
              <option value="momentum">Momentum</option>
            </select>
          </label>
        </div>
        <table style={{ width: '100%', marginTop: 16, borderCollapse: 'collapse' }}>
          <caption className="visually-hidden">Team roster with pace status and momentum band</caption>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: 'left' }}>Rep</th>
              <th scope="col" style={{ textAlign: 'left' }}>Pace</th>
              <th scope="col" style={{ textAlign: 'left' }}>Momentum</th>
              <th scope="col" style={{ textAlign: 'left' }}></th>
            </tr>
          </thead>
          <tbody>
            {data.roster.map((row) => (
              <tr key={row.userId} style={{ borderTop: '1px solid var(--line)' }}>
                <th scope="row" style={{ textAlign: 'left', fontWeight: 600, padding: '10px 0' }}>{row.name}</th>
                <td>{PACE_GLYPH[row.paceIcon]} {row.paceLabel}</td>
                <td>{row.momentumBand === 'no_data' ? 'Learning your community' : row.momentumBand}</td>
                <td><Link href={`/team/rep/${row.userId}`}>View</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {data.downlineLeak.length > 0 && (
        <section className="card panel">
          <span className="badge">Downline Leak</span>
          <p>{data.downlineLeak.length} rep(s) haven&apos;t been in the field for a while — a quiet coaching nudge, not a warning.</p>
        </section>
      )}

      <section className="card panel">
        <span className="badge">Your Field Trainer&apos;s Ratio</span>
        <div className="metric-grid" style={{ marginTop: 16 }}>
          <div className="metric"><strong>{data.fieldTrainerRatio.appointmentsRun}</strong><span>appointments run</span></div>
          <div className="metric"><strong>{data.fieldTrainerRatio.completed}</strong><span>completed</span></div>
          <div className="metric"><strong>{data.fieldTrainerRatio.noShows}</strong><span>no-shows (owned honestly)</span></div>
        </div>
      </section>
    </div>
  );
}
