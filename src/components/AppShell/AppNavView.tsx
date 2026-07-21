'use client';

// T-57 R2 (uiux §2.1/§2.2/§2.3/§2.5) — the PRESENTATIONAL persistent navigation. Deliberately pure
// (every input is a prop: the active path, the viewer's role, and `t`) with NO router/session hooks
// of its own, so `AppShell` (the container) owns all the environment reads and this view can be
// rendered deterministically in a single `renderToStaticMarkup` pass by the unit tests — the same
// convention every other UI-proof test in this repo follows (jest.config.js: `testEnvironment:
// 'node'`, no jsdom).
//
// A11y (uiux §2.5): the whole thing is a single `nav` landmark; each destination is a focusable
// link in DOM order; the active destination carries `aria-current="page"`; the accessible name of
// each link is its own label text (kept in the a11y tree at every breakpoint — the icon-only
// tablet rail hides the label VISUALLY only, uiux §2.2). Labels are localized via `t()` (EN+ES).

import Link from 'next/link';
import type { Role } from '@prisma/client';

import NavIcon from './NavIcon';
import { APPROVAL_INBOX, DESTINATIONS, TEAM_ITEM, canSeeTeam, isActivePath, type NavItem } from './navConfig';
import styles from './AppShell.module.css';

export interface AppNavViewProps {
  pathname: string;
  role?: Role | string | null;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export default function AppNavView({ pathname, role, t }: AppNavViewProps) {
  const showTeam = canSeeTeam(role);

  const renderLink = (item: NavItem, extraClass = '') => {
    const active = isActivePath(pathname, item.href);
    const label = t(item.labelKey);
    return (
      <Link
        href={item.href}
        className={`${styles.navLink} ${extraClass}`.trim()}
        aria-current={active ? 'page' : undefined}
        title={label}
        data-nav={item.key}
        onClick={() => {
          // uiux AC-2-2: re-tapping the active destination scrolls to top (no-op in SSR/node render —
          // the handler is never invoked by renderToStaticMarkup, so this stays test-safe).
          if (active && typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      >
        <span className={styles.navGlyph} aria-hidden="true">
          <NavIcon icon={item.icon} />
        </span>
        <span className={styles.navLabel}>{label}</span>
      </Link>
    );
  };

  return (
    <nav className={styles.nav} aria-label={t('nav.primaryAria')}>
      {/* Brand mark pinned at the top of the rail (uiux §2.2); hidden on the mobile tab bar. */}
      <Link href="/today" className={styles.brand} data-nav="brand">
        <span className={styles.brandMark} aria-hidden="true">
          H
        </span>
        <span className={styles.brandName}>{t('auth.brandName')}</span>
      </Link>

      <ul className={styles.destinations}>
        {DESTINATIONS.map((d) => (
          <li key={d.key} className={styles.destinationItem}>
            {renderLink(d)}
          </li>
        ))}
      </ul>

      {/* Pinned beneath the five destinations (uiux §2.2/§2.3): the Approval Inbox, and — for
          upline-class roles only (AC-2-8) — the Team surface. Both are rail-only; on mobile the
          Approval Inbox lives in the Today header and Team folds into Today. */}
      <div className={styles.railPinned}>
        {renderLink(APPROVAL_INBOX, styles.railOnly)}
        {showTeam ? renderLink(TEAM_ITEM, styles.railOnly) : null}
      </div>
    </nav>
  );
}
