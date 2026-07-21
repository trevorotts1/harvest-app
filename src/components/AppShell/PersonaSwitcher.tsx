// T-57 R3b (M9, master-spec §2.3.2/AC-2-4, uiux §2.3 item 2) — the DUAL-role persona switcher: "My
// Business" / "My Team", a pinned two-segment pill. DUAL-only, fail-closed: any role other than the
// literal 'DUAL' string (including undefined/null/an unrecognized value) renders nothing — a rep,
// upline, RVP, or admin never sees this control (AC-2-4's own text: "never blends data" starts with
// never showing the control to a user who has no second persona to switch into).
//
// Deliberately PURE (all inputs are props, no router/session hooks of its own) — same convention
// `AppNavView` (this directory) already established, so both are single-pass
// `renderToStaticMarkup`-testable. `AppShell` (the container) supplies `role` from the server-issued
// session and `activePersona` from a post-mount read of `window.location.search` (mirroring
// `today/page.tsx`'s own `?persona=team` detection — no `useSearchParams()`, so this introduces no
// new Suspense-boundary requirement at the layout level, which wraps every page in the app).
//
// Navigates via real `<Link>`s to the exact query-param contract `today/page.tsx` (R2) already
// reads (`/today` vs `/today?persona=team`) rather than a client-only state flip, so the switch
// survives a reload/share/back-button and Today's own team-view banner+link picks it up for free.
// `aria-current` (not `aria-pressed`) marks the active segment — these are real navigational links
// to distinct URLs, not stateful toggle buttons, so this mirrors `AppNavView`'s own
// `aria-current="page"` convention for "which of several linked destinations is active" rather than
// forcing button semantics onto an anchor.
//
// SCOPE NOTE (honestly stated, not silently overclaimed): this wires reachability into the REAL,
// already-shipped `?persona=team` mechanism `today/page.tsx` built (a banner + a link to `/team`).
// It does not — and no current surface in this codebase does — maintain fully independent,
// separately-fetched "My Business" vs "My Team" data per screen; every zone still queries the same
// rep-scoped APIs regardless of persona. Full per-persona surface/data separation (§2.3.2's "state
// preserved per persona, never blended") is a materially larger feature than restoring reachability
// to an absent control and is flagged as follow-up, not silently declared done here.

import Link from 'next/link';
import type { Role } from '@prisma/client';

import styles from './AppShell.module.css';

export type Persona = 'business' | 'team';

export interface PersonaSwitcherProps {
  role?: Role | string | null;
  activePersona: Persona;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export default function PersonaSwitcher({ role, activePersona, t }: PersonaSwitcherProps) {
  if (role !== 'DUAL') return null;

  return (
    <div className={styles.personaSwitcher} role="group" aria-label={t('me.persona.switcherAria')}>
      <Link
        href="/today"
        aria-current={activePersona === 'business' ? 'page' : undefined}
        className={`${styles.personaSegment} ${activePersona === 'business' ? styles.personaSegmentActive : ''}`.trim()}
        data-persona="business"
      >
        {t('me.persona.myBusiness')}
      </Link>
      <Link
        href="/today?persona=team"
        aria-current={activePersona === 'team' ? 'page' : undefined}
        className={`${styles.personaSegment} ${activePersona === 'team' ? styles.personaSegmentActive : ''}`.trim()}
        data-persona="team"
      >
        {t('me.persona.myTeam')}
      </Link>
    </div>
  );
}
