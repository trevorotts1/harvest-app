// T-45 (WP09 §14.4; uiux §5.9) — the upline/RVP dashboard. Outcomes + pace only — no per-task
// activity feed, no screen-time metric, no leaderboard (anti-surveillance doctrine, AC-5.9-1/2).
// Zero-team renders the recruit-your-first coaching state (uiux AC-5.9-8), never a blank screen.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { useT } from '@/app/locale-context';

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
  const t = useT();
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
    return <div className="card panel"><p>{t('team.dashboard.loadingReport')}</p></div>;
  }
  if (state.kind === 'forbidden') {
    return (
      <div className="card panel">
        <span className="badge">{t('team.dashboard.forbidden.badge')}</span>
        <h2>{t('team.dashboard.forbidden.heading')}</h2>
        <p>{t('team.dashboard.forbidden.body')}</p>
        <Link className="btn btn-secondary" href="/team/cockpit">{t('team.dashboard.forbidden.cta')}</Link>
      </div>
    );
  }
  if (state.kind === 'failed') {
    return (
      <div className="card panel">
        <p>{t('team.dashboard.loadFailed')}</p>
        <button type="button" className="btn btn-secondary" onClick={() => load(sort)}>{t('common.retry')}</button>
      </div>
    );
  }

  const { data } = state;

  if (!data.hasTeam) {
    return (
      <div className="card panel">
        <span className="badge">{t('team.dashboard.emptyBadge')}</span>
        <h2>{t('team.dashboard.emptyHeading')}</h2>
        <p>{t('team.dashboard.emptyBody')}</p>
        <Link className="btn btn-primary" href="/community">{t('team.dashboard.emptyCta')}</Link>
      </div>
    );
  }

  return (
    <div className="stack">
      {/* T-09 (§5.5 AC-3b) — reachable affordance into the upline's CFE FLAG adjudication queue. */}
      <section className="card panel">
        <span className="badge">{t('team.complianceLink.badge')}</span>
        <p style={{ marginTop: 8 }}>{t('team.complianceLink.body')}</p>
        <Link className="btn btn-secondary" href="/team/compliance-review">{t('team.complianceLink.cta')}</Link>
      </section>

      {data.needsYouNow.length > 0 && (
        <section className="card panel">
          <span className="badge">{t('team.dashboard.needsYouNowBadge')}</span>
          <div className="stack" style={{ marginTop: 12 }}>
            {data.needsYouNow.map((item) => (
              <div key={item.handoffId} className="action-row">
                <span className="priority">!</span>
                <div>
                  <strong>{item.triggerReason.replace(/_/g, ' ').toLowerCase()}</strong>
                  <br />
                  <span style={{ color: 'var(--muted)' }}>{t('team.dashboard.needsYouNowItemBody')}</span>
                </div>
                <Link className="btn btn-primary" href={`/team/rep/${item.repUserId}`}>{t('team.dashboard.joinThreeWayCta')}</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span className="badge">{t('team.dashboard.rosterBadge')}</span>
            <h2 style={{ marginTop: 8 }}>{t('team.dashboard.rosterHeading')}</h2>
          </div>
          <label>
            {t('team.dashboard.sortByLabel')}{' '}
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="name">{t('team.dashboard.sortOption.name')}</option>
              <option value="pace">{t('team.dashboard.sortOption.pace')}</option>
              <option value="momentum">{t('team.dashboard.sortOption.momentum')}</option>
            </select>
          </label>
        </div>
        {/* T-57 R1c (C3) — below the 860px nav breakpoint the bare table overflows the viewport
            (globals.css table{min-width:560px}, no wrapper); `.table-wrap` (globals.css, already
            used at dashboard/contact-upload-demo.tsx:144) contains the horizontal scroll to this
            card instead of the page, at every width — no media query needed. */}
        <div className="table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <caption className="visually-hidden">{t('team.dashboard.rosterCaption')}</caption>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: 'left' }}>{t('team.dashboard.tableHeader.rep')}</th>
                <th scope="col" style={{ textAlign: 'left' }}>{t('team.dashboard.tableHeader.pace')}</th>
                <th scope="col" style={{ textAlign: 'left' }}>{t('team.dashboard.tableHeader.momentum')}</th>
                <th scope="col" style={{ textAlign: 'left' }}></th>
              </tr>
            </thead>
            <tbody>
              {data.roster.map((row) => (
                <tr key={row.userId} style={{ borderTop: '1px solid var(--line)' }}>
                  <th scope="row" style={{ textAlign: 'left', fontWeight: 600, padding: '10px 0' }}>{row.name}</th>
                  <td>{PACE_GLYPH[row.paceIcon]} {row.paceLabel}</td>
                  <td>{row.momentumBand === 'no_data' ? t('team.dashboard.noDataMomentum') : row.momentumBand}</td>
                  <td><Link href={`/team/rep/${row.userId}`}>{t('team.dashboard.viewCta')}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.downlineLeak.length > 0 && (
        <section className="card panel">
          <span className="badge">{t('team.dashboard.downlineLeakBadge')}</span>
          <p>{t('team.dashboard.downlineLeakBody', { count: data.downlineLeak.length })}</p>
        </section>
      )}

      <section className="card panel">
        <span className="badge">{t('team.dashboard.fieldTrainerRatioBadge')}</span>
        <div className="metric-grid" style={{ marginTop: 16 }}>
          <div className="metric"><strong>{data.fieldTrainerRatio.appointmentsRun}</strong><span>{t('team.dashboard.metric.appointmentsRun')}</span></div>
          <div className="metric"><strong>{data.fieldTrainerRatio.completed}</strong><span>{t('team.dashboard.metric.completed')}</span></div>
          <div className="metric"><strong>{data.fieldTrainerRatio.noShows}</strong><span>{t('team.dashboard.metric.noShows')}</span></div>
        </div>
      </section>
    </div>
  );
}
