// T-45 (WP09 — master-spec §14; uiux §5.9 "Entry: Team rail item") — the /team shell: a persistent
// tab strip over the upline/RVP dashboard, team calendar, and Sponsor Cockpit. `/team` is already a
// gated downstream page (src/lib/auth/onboarding-gate-edge.ts's GATED_DOWNSTREAM_PAGE_PREFIXES
// already lists it) — this layout only adds the navigation chrome; each page underneath still
// authorizes itself against the real session server-side.
//
// T-R22R (re-integration of T-R22 onto this tab strip, master-spec §10.6) — adds the "Pending
// Bridges" tab: the upline-facing surface to see and accept a three-way handoff bridge. T-R22
// originally mounted this at the bare `/team` page before WP09 landed and took that route for the
// dashboard below; it now lives at /team/bridges as a sibling tab instead.

'use client';

import Link from 'next/link';

import { useT } from '@/app/locale-context';

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <main className="app-frame">
      <aside className="sidebar">
        <Link href="/today" className="brand"><span className="brand-mark">H</span><span>{t('auth.brandName')}</span></Link>
        <nav aria-label={t('nav.teamAria')}>
          <Link className="side-link" href="/today">{t('team.layout.todayLink')}</Link>
          <Link className="side-link" href="/team">{t('nav.team')}</Link>
          <Link className="side-link" href="/team/bridges">{t('team.layout.pendingBridgesLink')}</Link>
          <Link className="side-link" href="/team/calendar">{t('team.layout.calendarLink')}</Link>
          <Link className="side-link" href="/team/cockpit">{t('team.layout.cockpitLink')}</Link>
        </nav>
      </aside>
      <section className="main">{children}</section>
    </main>
  );
}
