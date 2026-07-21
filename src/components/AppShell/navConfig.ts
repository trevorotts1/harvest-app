// T-57 R2 (uiux §2.1/§2.2/§2.3) — the single source of truth for the persistent navigation shell's
// destinations, role gating, and per-route visibility. Kept as a plain `.ts` module (no JSX) so
// both the presentational `AppNavView` and the unit tests import the SAME config — the five
// destinations, their order, and the role predicates can never silently drift between what ships
// and what's asserted.

import type { Role } from '@prisma/client';

export type NavIconKey = 'today' | 'community' | 'grow' | 'learn' | 'me' | 'team' | 'inbox';

export interface NavItem {
  key: string;
  href: string;
  /** i18n catalog key for the visible + accessible label. */
  labelKey: string;
  icon: NavIconKey;
}

/**
 * The FIVE primary destinations (uiux §2.1) — identical names and order on every platform. "Naming
 * is doctrine": the second tab is the community, never "Contacts"/"CRM"; Today is always first and
 * is the default landing surface.
 */
export const DESTINATIONS: readonly NavItem[] = [
  { key: 'today', href: '/today', labelKey: 'nav.today', icon: 'today' },
  { key: 'community', href: '/community', labelKey: 'nav.community', icon: 'community' },
  { key: 'grow', href: '/grow', labelKey: 'nav.grow', icon: 'grow' },
  { key: 'learn', href: '/learn', labelKey: 'nav.learn', icon: 'learn' },
  { key: 'me', href: '/me', labelKey: 'nav.me', icon: 'me' },
];

/** The persistent, pinned Approval Inbox affordance (uiux §2.3 item 1) — a pinned rail item on
 *  desktop; on mobile the Today header carries its own inbox button (AnchorHeader), so this pin is
 *  rail-only. */
export const APPROVAL_INBOX: NavItem = {
  key: 'inbox',
  href: '/inbox',
  labelKey: 'nav.approvalInbox',
  icon: 'inbox',
};

/** Team is a role-gated sixth destination (uiux §2.3 item 3 / AC-2-8): the upline aggregate
 *  surface. It renders as a sixth desktop rail item; rep-only users never see it. */
export const TEAM_ITEM: NavItem = {
  key: 'team',
  href: '/team',
  labelKey: 'nav.team',
  icon: 'team',
};

/**
 * uiux AC-2-8 + §2.3 item 3: "Upline/RVP users get the Team surface ...; rep-only users never see
 * it." Every upline-class role (UPLINE, RVP, DUAL, ADMIN) sees Team; a plain REP — and, fail-closed,
 * any unknown/missing role — does not. This is a UX affordance only; every `/team` page still
 * authorizes itself server-side (RBAC + gated-downstream prefix), so hiding the link never stands in
 * for the real access check.
 */
export function canSeeTeam(role: Role | string | undefined | null): boolean {
  return role === 'UPLINE' || role === 'RVP' || role === 'DUAL' || role === 'ADMIN';
}

/**
 * uiux §2.3 item 3 / §2.4: "pure-upline roles land on the team view of Today by default". A pure
 * UPLINE or RVP lands on `/today?persona=team`; a DUAL role defaults to its rep ("My Business")
 * persona (`/today`), and REP/ADMIN land on plain Today.
 */
export function landsOnTeamView(role: Role | string | undefined | null): boolean {
  return role === 'UPLINE' || role === 'RVP';
}

/**
 * T-57 R3b (M9, uiux §2.3 item 2 / AC-2-4): the persona switcher ("My Business" / "My Team") is
 * DUAL-only. Every other role — including the upline-class roles `canSeeTeam` also covers — never
 * sees it: a pure UPLINE/RVP has no second persona to switch into (they already land on the team
 * view of Today by default, `landsOnTeamView`), and REP/ADMIN have no team persona at all.
 * Fail-closed: an unrecognized/missing role returns `false`, same posture as `canSeeTeam`.
 */
export function isDualPersonaUser(role: Role | string | undefined | null): boolean {
  return role === 'DUAL';
}

/**
 * Which routes render WITHOUT the shell (uiux §2.2): the marketing landing (its own nav), identity
 * capture (`/auth`), the retired demo scaffold + dev token gallery, and the full-screen focus
 * surfaces the spec explicitly names — "the bar hides on full-screen rituals (§5.4), the Shift focus
 * mode (§5.3), and the onboarding flow."
 */
const SHELL_HIDDEN_PREFIXES = ['/auth', '/onboarding', '/shift', '/ritual', '/dashboard', '/design-tokens'];

export function showsNavShell(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (pathname === '/') return false; // marketing landing carries its own <nav>
  return !SHELL_HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Active-destination test (drives `aria-current="page"`, uiux §2.5): exact match, or a nested
 *  sub-route so `/me` stays active on `/me/accessibility`, `/today` on `/today/momentum`, etc. */
export function isActivePath(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
